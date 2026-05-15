// Pre-validated transfer option menu for the AI Coach.
//
// Architecture: the AI is bad at arithmetic (live FPL prices, position
// constraints, the 3-per-team cap) and bad at probability sims. Our model is
// good at both. So we INVERT the responsibility:
//
//   1. Server generates a ranked menu of legal, affordable transfer options,
//      each pre-scored by overtake-probability impact per rival.
//   2. AI picks from the menu (its strengths: news context, captain logic,
//      narrative). It cannot invent transfers — every recommendation must
//      reference an OPT-XX id from this list.
//   3. Server resolves the AI's option_id back to the canonical OUT/IN,
//      sidestepping any name typos or price hallucinations.
//
// Reuses `rankReplacements` (candidate pool, already budget+pos aware) and
// `simulateSwap` (legality check + projection + overtake delta).

import { rankReplacements } from "./candidates";
import { simulateSwap } from "./whatif";
import type {
  FplBootstrap,
  FplElement,
  FplFixture,
  ManagerSquad,
  OvertakeOdds,
  Position,
  SquadProjection,
  SquadSlot,
} from "@/lib/types";

export type OptionCategory = "best-xp" | "differential" | "injury-fix";

export interface TransferOption {
  id: string; // "OPT-01", "OPT-02", ...
  category: OptionCategory;
  outPlayerId: number;
  outWebName: string;
  outTeamShort: string;
  outCost: number; // tenths of £m
  outXp: number;
  outPosition: Position;
  inPlayerId: number;
  inWebName: string;
  inTeamShort: string;
  inCost: number;
  inXp: number;
  netGainXi: number; // change in starting-XI total (incl. captain mult if relevant)
  postBank: number; // tenths of £m remaining after this swap
  overtakeImpact: Array<{
    rivalEntryId: number;
    rivalName: string;
    before: number; // 0..1
    after: number;
    delta: number; // -1..1 (after - before)
  }>;
  /** Cumulative overtake-delta across all rivals — primary ranking key. */
  overtakeSum: number;
  notes: string[];
}

interface CandidatePair {
  outSlot: SquadSlot;
  inEl: FplElement;
  category: OptionCategory;
}

interface GenerateArgs {
  ctx: { user: ManagerSquad; rivals: ManagerSquad[]; leagueName: string };
  userProjection: SquadProjection;
  rivalProjections: SquadProjection[];
  baselineOvertake: OvertakeOdds[];
  bank: number;
  bs: FplBootstrap;
  fixtures: FplFixture[];
  gw: number;
  limit?: number;
}

export function generateTransferOptions(args: GenerateArgs): TransferOption[] {
  const { ctx, userProjection, rivalProjections, baselineOvertake, bank, bs, fixtures, gw } = args;
  const teamsById = new Map(bs.teams.map((t) => [t.id, t]));
  const ownedIds = new Set(ctx.user.picks.map((s) => s.player.id));
  const rivalUnion = new Set<number>();
  ctx.rivals.forEach((r) => r.picks.forEach((s) => rivalUnion.add(s.player.id)));

  const teamCountsExcluding = (outId: number): Map<number, number> => {
    const m = new Map<number, number>();
    for (const s of ctx.user.picks) {
      if (s.player.id === outId) continue;
      m.set(s.player.team, (m.get(s.player.team) ?? 0) + 1);
    }
    return m;
  };

  // -------- Source A: per-OUT best xP upgrades (top 3 per owned player) --
  const pairs: CandidatePair[] = [];
  const seen = new Set<string>();
  const add = (p: CandidatePair) => {
    const k = `${p.outSlot.player.id}-${p.inEl.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push(p);
  };

  for (const outSlot of ctx.user.picks) {
    const reps = rankReplacements({
      outPlayer: outSlot.player,
      bank,
      ownedIds,
      teamCounts: teamCountsExcluding(outSlot.player.id),
      bs,
      fixtures,
      gw,
      limit: 3,
    });
    for (const c of reps) {
      const inEl = bs.elements.find((e) => e.id === c.playerId);
      if (inEl) add({ outSlot, inEl, category: "best-xp" });
    }
  }

  // -------- Source B: differentials (IN not owned by any rival) -----------
  for (const outSlot of ctx.user.picks) {
    const reps = rankReplacements({
      outPlayer: outSlot.player,
      bank,
      ownedIds,
      teamCounts: teamCountsExcluding(outSlot.player.id),
      bs,
      fixtures,
      gw,
      limit: 12,
    });
    const diffs = reps.filter((c) => !rivalUnion.has(c.playerId)).slice(0, 2);
    for (const c of diffs) {
      const inEl = bs.elements.find((e) => e.id === c.playerId);
      if (inEl) add({ outSlot, inEl, category: "differential" });
    }
  }

  // -------- Source C: injury / availability fixes ------------------------
  const sketchy = ctx.user.picks.filter(
    (s) =>
      s.player.status !== "a" ||
      (s.player.chance_of_playing_next_round !== null && s.player.chance_of_playing_next_round < 75),
  );
  for (const outSlot of sketchy) {
    const reps = rankReplacements({
      outPlayer: outSlot.player,
      bank,
      ownedIds,
      teamCounts: teamCountsExcluding(outSlot.player.id),
      bs,
      fixtures,
      gw,
      limit: 2,
    });
    for (const c of reps) {
      const inEl = bs.elements.find((e) => e.id === c.playerId);
      if (inEl) add({ outSlot, inEl, category: "injury-fix" });
    }
  }

  // -------- Score each pair with simulateSwap (legality + overtake delta) --
  const scored = pairs
    .map((p) => {
      const result = simulateSwap({
        ctx: { user: ctx.user, rivals: ctx.rivals, leagueName: ctx.leagueName },
        userSquad: ctx.user,
        userProjection,
        rivalProjections,
        baselineOvertake,
        bank,
        outId: p.outSlot.player.id,
        inId: p.inEl.id,
        bs,
        fixtures,
        gw,
      });
      if (!result.legality.ok) return null;
      const impact = (result.overtakeDelta ?? []).map((d) => ({
        rivalEntryId: d.rivalEntryId,
        rivalName: d.rivalName,
        before: d.before,
        after: d.after,
        delta: d.delta,
      }));
      const overtakeSum = impact.reduce((acc, o) => acc + o.delta, 0);
      return { pair: p, result, impact, overtakeSum };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Primary key = overtake delta; ties broken by XI xP gain.
  scored.sort((a, b) => {
    const oDiff = b.overtakeSum - a.overtakeSum;
    if (Math.abs(oDiff) > 0.01) return oDiff;
    return b.result.xPDeltaXi - a.result.xPDeltaXi;
  });

  const limit = args.limit ?? 15;
  return scored.slice(0, limit).map((s, i) => {
    const team = teamsById.get(s.pair.inEl.team);
    const outProj = userProjection.perPlayer.find((pp) => pp.playerId === s.pair.outSlot.player.id);
    const inProj = s.result.newSquadProjection?.perPlayer.find(
      (pp) => pp.playerId === s.pair.inEl.id,
    );
    const notes: string[] = [];
    if (s.pair.category === "injury-fix") notes.push("injury fix");
    if (s.pair.category === "differential") notes.push("rival-differential");
    if (s.overtakeSum > 0.05) notes.push(`+${(s.overtakeSum * 100).toFixed(0)}pp overtake`);
    return {
      id: `OPT-${String(i + 1).padStart(2, "0")}`,
      category: s.pair.category,
      outPlayerId: s.pair.outSlot.player.id,
      outWebName: s.pair.outSlot.player.web_name,
      outTeamShort: s.pair.outSlot.team.short_name,
      outCost: s.pair.outSlot.player.now_cost,
      outXp: Number((outProj?.xPoints ?? 0).toFixed(1)),
      outPosition: s.pair.outSlot.position,
      inPlayerId: s.pair.inEl.id,
      inWebName: s.pair.inEl.web_name,
      inTeamShort: team?.short_name ?? "?",
      inCost: s.pair.inEl.now_cost,
      inXp: Number((inProj?.xPoints ?? 0).toFixed(1)),
      netGainXi: Number(s.result.xPDeltaXi.toFixed(1)),
      postBank: s.result.budgetAfter,
      overtakeImpact: s.impact,
      overtakeSum: Number(s.overtakeSum.toFixed(3)),
      notes,
    };
  });
}
