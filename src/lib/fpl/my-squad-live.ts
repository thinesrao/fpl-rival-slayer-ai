// Composer for the live "Pitch" tab — the user's own current squad with
// per-player live points, fixture status, captain multiplier, provisional
// bonus, and autosub preview.
//
// Reuses bs + picks + live + fixtures + entry history (all cached). Computes:
//   - per-player live points (incl. captain × multiplier)
//   - provisional bonus per fixture (top BPS → 3/2/1, ties shared) for matches
//     whose official `bonus` hasn't locked yet
//   - autosub preview: blanked starters get replaced by bench players in
//     autosub priority order, respecting min-formation rules (1 GK, 3 DEF, 1 FWD)
//   - rank trajectory from the manager's history.current array

import type { FplBootstrap, FplFixture, ManagerSquad, Position } from "@/lib/types";
import { getBootstrap, getEntryHistory, getFixtures, getLive, getPicks } from "./client";
import type { FplLive, FplLiveElement } from "./client";

const POS_BY_ID: Record<number, Position> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

export type FixtureStatus = "upcoming" | "live" | "finished";

export interface LivePlayer {
  playerId: number;
  code: number; // FPL element.code — drives the PL CDN player-photo URL
  webName: string;
  teamShort: string;
  teamCode: number;
  elementType: 1 | 2 | 3 | 4;
  position: Position;
  isStarter: boolean;
  isCaptain: boolean;
  isVice: boolean;
  multiplier: number; // 0 (bench) | 1 (starter) | 2 (captain) | 3 (TC active)
  benchSlot: number | null; // 1..3 for outfield subs, 4 for GK sub, null for starters
  livePoints: number; // base actual from live
  pointsWithMultiplier: number; // livePoints × multiplier (after autosub adjustment)
  minutes: number;
  bonus: number; // FPL-final bonus (0 until ~1h post-match)
  provisionalBonus: number; // computed from BPS; -1 if not applicable
  bps: number;
  fixtureStatus: FixtureStatus;
  fixtureOpponent: string;
  fixtureKickoffIso: string | null;
  fixtureFdr: number;
  autosubbedIn: boolean;
  autosubbedOut: boolean;
}

export interface LiveMetrics {
  gwGrossPoints: number;
  transferCost: number;
  gwNetPoints: number;
  transfersMade: number;
  freeTransfers: number;
  liveRank: number | null;
  gwRank: number | null;
  rankTrajectory: Array<{ gw: number; overallRank: number }>;
}

export interface MySquadLive {
  gw: number;
  metrics: LiveMetrics;
  starters: LivePlayer[];
  bench: LivePlayer[];
}

function fixtureStatusAt(f: FplFixture, now: number): FixtureStatus {
  if (f.finished) return "finished";
  if (!f.kickoff_time) return "upcoming";
  return new Date(f.kickoff_time).getTime() <= now ? "live" : "upcoming";
}

interface TeamFixture {
  fixture: FplFixture;
  isHome: boolean;
  opponentTeamId: number;
}

function findTeamFixture(teamId: number, fixtures: FplFixture[]): TeamFixture | null {
  // For DGW we just take the first chronologically; per-fixture stats split is
  // out of scope (the Pitch view shows aggregate live points for the GW anyway).
  const matching = fixtures
    .filter((f) => f.team_h === teamId || f.team_a === teamId)
    .sort((a, b) => {
      const ta = a.kickoff_time ? new Date(a.kickoff_time).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.kickoff_time ? new Date(b.kickoff_time).getTime() : Number.POSITIVE_INFINITY;
      return ta - tb;
    });
  if (matching.length === 0) return null;
  const f = matching[0];
  const isHome = f.team_h === teamId;
  return { fixture: f, isHome, opponentTeamId: isHome ? f.team_a : f.team_h };
}

interface ProvisionalBonus {
  bonusByPlayerId: Map<number, number>;
}

function computeProvisionalBonusPerFixture(
  fixtures: FplFixture[],
  live: FplLive,
  bs: FplBootstrap,
): ProvisionalBonus {
  const liveById = new Map(live.elements.map((e) => [e.id, e]));
  const teamOf = new Map(bs.elements.map((e) => [e.id, e.team]));
  const bonusByPlayerId = new Map<number, number>();

  for (const f of fixtures) {
    if (f.finished && // already finished — FPL has likely awarded final bonus
      live.elements.some((e) => {
        const t = teamOf.get(e.id);
        return (t === f.team_h || t === f.team_a) && (e.stats.bonus ?? 0) > 0;
      })
    ) {
      // Official bonus is locked for this fixture — skip provisional.
      continue;
    }
    // Players who played > 0 mins for either side
    const fixturePlayers: Array<{ id: number; bps: number }> = [];
    for (const el of bs.elements) {
      if (el.team !== f.team_h && el.team !== f.team_a) continue;
      const liveEl = liveById.get(el.id);
      if (!liveEl) continue;
      if ((liveEl.stats.minutes ?? 0) <= 0) continue;
      fixturePlayers.push({ id: el.id, bps: liveEl.stats.bps ?? 0 });
    }
    if (fixturePlayers.length === 0) continue;
    fixturePlayers.sort((a, b) => b.bps - a.bps);

    // Award 3/2/1 with ties: walk distinct BPS values, award by tier.
    const distinctBps: number[] = [];
    for (const p of fixturePlayers) {
      if (distinctBps[distinctBps.length - 1] !== p.bps) distinctBps.push(p.bps);
    }
    const tiers = [3, 2, 1];
    distinctBps.slice(0, 3).forEach((bps, idx) => {
      const award = tiers[idx];
      for (const p of fixturePlayers) {
        if (p.bps === bps && p.bps > 0) bonusByPlayerId.set(p.id, award);
      }
    });
  }
  return { bonusByPlayerId };
}

interface AutosubArgs {
  starters: LivePlayer[];
  bench: LivePlayer[]; // ordered by FPL bench position (1..3 outfield, GK)
}

interface AutosubResult {
  starters: LivePlayer[];
  bench: LivePlayer[];
}

/** Apply FPL autosub rules. A starter with 0 minutes AND a finished fixture
 *  is replaced by the first bench player whose fixture has also concluded
 *  AND who keeps the formation legal (≥1 GK, ≥3 DEF, ≥1 FWD).
 *  GK autosubs only with the bench GK. */
function applyAutosubs(args: AutosubArgs): AutosubResult {
  const starters = args.starters.map((p) => ({ ...p }));
  const bench = args.bench.map((p) => ({ ...p }));

  const minByPos: Record<Position, number> = { GKP: 1, DEF: 3, MID: 0, FWD: 1 };
  const countPos = (xs: LivePlayer[]) => {
    const c: Record<Position, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const p of xs) c[p.position]++;
    return c;
  };

  const canSwap = (out: LivePlayer, candidate: LivePlayer): boolean => {
    // GK can only swap with GK.
    if (out.position === "GKP" || candidate.position === "GKP") {
      return out.position === "GKP" && candidate.position === "GKP";
    }
    // Outfield: applying the swap must keep formation legal.
    const newStarters = starters.map((s) =>
      s.playerId === out.playerId ? { ...s, position: candidate.position } : s,
    );
    const counts = countPos(newStarters);
    return counts.DEF >= minByPos.DEF && counts.FWD >= minByPos.FWD && counts.GKP >= minByPos.GKP;
  };

  for (const starter of starters) {
    if (starter.minutes > 0 || starter.fixtureStatus !== "finished") continue;

    // Walk bench in autosub priority (slot 1..3, then GK).
    const benchOrder = [...bench].sort((a, b) => (a.benchSlot ?? 99) - (b.benchSlot ?? 99));
    for (const sub of benchOrder) {
      if (sub.minutes <= 0) continue;
      if (sub.fixtureStatus !== "finished") continue;
      if (sub.autosubbedIn) continue;
      if (!canSwap(starter, sub)) continue;

      starter.autosubbedOut = true;
      starter.pointsWithMultiplier = 0;
      sub.autosubbedIn = true;
      // The sub takes the slot with multiplier 1 (captain multiplier doesn't
      // transfer; if the captain blanked and vice played, FPL transfers
      // the captain to the vice — handled separately below).
      sub.pointsWithMultiplier = sub.livePoints * 1;
      break;
    }
  }

  // Captain → vice fallback: if captain blanked and vice played, vice gets
  // captain's multiplier.
  const captain = starters.find((p) => p.isCaptain);
  const vice = starters.find((p) => p.isVice) ?? bench.find((p) => p.isVice);
  if (captain && captain.minutes === 0 && captain.fixtureStatus === "finished" && vice && vice.minutes > 0) {
    // Strip captain multiplier from current captain.
    captain.pointsWithMultiplier = 0;
    captain.multiplier = 0;
    // Apply ×2 to vice.
    vice.multiplier = 2;
    vice.pointsWithMultiplier = vice.livePoints * 2;
  }

  return { starters, bench };
}

interface ResolvePicksArgs {
  squad: ManagerSquad; // hydrated picks
  bs: FplBootstrap;
  live: FplLive;
  fixtures: FplFixture[];
  provisional: ProvisionalBonus;
  now: number;
}

function resolvePicks(args: ResolvePicksArgs): { starters: LivePlayer[]; bench: LivePlayer[] } {
  const { squad, bs, live, fixtures, provisional, now } = args;
  const teamsById = new Map(bs.teams.map((t) => [t.id, t]));
  const liveById = new Map(live.elements.map((e) => [e.id, e]));

  const all: Array<LivePlayer & { _benchPosition: number; _pickPosition: number }> = squad.picks.map((slot) => {
    const liveEl: FplLiveElement | undefined = liveById.get(slot.player.id);
    const team = teamsById.get(slot.player.team);
    const tf = findTeamFixture(slot.player.team, fixtures);
    const fixtureStatus = tf ? fixtureStatusAt(tf.fixture, now) : "upcoming";
    const opponentTeam = tf ? teamsById.get(tf.opponentTeamId) : undefined;
    const fixtureOpponent = tf && opponentTeam ? `${opponentTeam.short_name} (${tf.isHome ? "H" : "A"})` : "BLANK";
    const fixtureFdr = tf
      ? tf.isHome
        ? tf.fixture.team_h_difficulty
        : tf.fixture.team_a_difficulty
      : 3;

    const livePoints = liveEl?.stats.total_points ?? 0;
    const isStarter = slot.pick.multiplier > 0;
    const multiplier = slot.pick.multiplier;
    const provisionalBonus = provisional.bonusByPlayerId.get(slot.player.id) ?? -1;

    return {
      playerId: slot.player.id,
      code: slot.player.code ?? 0,
      webName: slot.player.web_name,
      teamShort: team?.short_name ?? "?",
      teamCode: team?.code ?? 0,
      elementType: (slot.player.element_type as 1 | 2 | 3 | 4) || 3,
      position: POS_BY_ID[slot.player.element_type] ?? "MID",
      isStarter,
      isCaptain: slot.pick.is_captain,
      isVice: slot.pick.is_vice_captain,
      multiplier,
      benchSlot: isStarter ? null : slot.pick.position - 11, // FPL bench positions are 12..15
      livePoints,
      pointsWithMultiplier: livePoints * multiplier,
      minutes: liveEl?.stats.minutes ?? 0,
      bonus: liveEl?.stats.bonus ?? 0,
      provisionalBonus,
      bps: liveEl?.stats.bps ?? 0,
      fixtureStatus,
      fixtureOpponent,
      fixtureKickoffIso: tf?.fixture.kickoff_time ?? null,
      fixtureFdr,
      autosubbedIn: false,
      autosubbedOut: false,
      _benchPosition: slot.pick.position,
      _pickPosition: slot.pick.position,
    };
  });

  const starters = all
    .filter((p) => p.isStarter)
    .sort((a, b) => a.elementType - b.elementType || a._pickPosition - b._pickPosition)
    .map(({ _benchPosition, _pickPosition, ...rest }) => {
      void _benchPosition;
      void _pickPosition;
      return rest;
    });
  const bench = all
    .filter((p) => !p.isStarter)
    .sort((a, b) => a._pickPosition - b._pickPosition)
    .map(({ _benchPosition, _pickPosition, ...rest }) => {
      void _benchPosition;
      void _pickPosition;
      return rest;
    });

  return { starters, bench };
}

interface HydrateSquadArgs {
  picks: import("@/lib/types").FplPicksResponse;
  bs: FplBootstrap;
}

function hydrateManagerSquad(args: HydrateSquadArgs): ManagerSquad {
  const { picks, bs } = args;
  const playersById = new Map(bs.elements.map((p) => [p.id, p]));
  const teamsById = new Map(bs.teams.map((t) => [t.id, t]));
  const slots = picks.picks
    .map((pick) => {
      const player = playersById.get(pick.element);
      if (!player) return null;
      const team = teamsById.get(player.team);
      if (!team) return null;
      return {
        pick,
        player,
        team,
        position: POS_BY_ID[player.element_type] ?? ("MID" as Position),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
  const starters = slots.filter((s) => s.pick.multiplier > 0);
  const bench = slots.filter((s) => s.pick.multiplier === 0);
  return {
    entry: { id: 0, name: "", player_name: "", total: 0, rank: 0 },
    gw: 0,
    picks: slots,
    starters,
    bench,
    captain: slots.find((s) => s.pick.is_captain),
    viceCaptain: slots.find((s) => s.pick.is_vice_captain),
    activeChip: picks.active_chip,
  };
}

export async function buildMySquadLive(teamId: number, gw: number): Promise<MySquadLive> {
  const [bs, picks, live, fixtures, history] = await Promise.all([
    getBootstrap(),
    getPicks(teamId, gw),
    getLive(gw),
    getFixtures(gw),
    getEntryHistory(teamId).catch(() => null),
  ]);

  const squad = hydrateManagerSquad({ picks, bs });
  const provisional = computeProvisionalBonusPerFixture(fixtures, live, bs);
  const { starters, bench } = resolvePicks({
    squad,
    bs,
    live,
    fixtures,
    provisional,
    now: Date.now(),
  });

  const subResult = applyAutosubs({ starters, bench });

  // Metrics
  const gwHistory = history?.current.find((c) => c.event === gw) ?? null;
  const gwGrossPoints = subResult.starters.reduce((acc, p) => acc + p.pointsWithMultiplier, 0);
  const transferCost = gwHistory?.event_transfers_cost ?? 0;
  const trajectory = history
    ? history.current
        .filter((c) => c.event <= gw)
        .slice(-10)
        .map((c) => ({ gw: c.event, overallRank: c.overall_rank }))
        .filter((t) => t.overallRank > 0)
    : [];

  const metrics: LiveMetrics = {
    gwGrossPoints,
    transferCost,
    gwNetPoints: gwGrossPoints - transferCost,
    transfersMade: gwHistory?.event_transfers ?? 0,
    freeTransfers: 1, // base; the Phase G+ freeTransfers calc lives elsewhere — keep simple
    liveRank: gwHistory?.overall_rank ?? null,
    gwRank: gwHistory?.rank ?? null,
    rankTrajectory: trajectory,
  };

  return {
    gw,
    metrics,
    starters: subResult.starters,
    bench: subResult.bench,
  };
}
