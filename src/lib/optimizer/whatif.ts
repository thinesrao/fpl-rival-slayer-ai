// What-If swap simulator: given a candidate OUT→IN transfer, reconstructs
// the user's squad with the swap applied, re-runs the projection, and
// re-computes overtake odds against the *current* rival projections.
//
// Returns enough metadata for the UI to render a clear delta card without
// having to recompute anything client-side.

import { projectSquad } from "@/lib/projections/model";
import { computeOvertakeOdds } from "@/lib/projections/overtake";
import type {
  FplBootstrap,
  FplElement,
  FplFixture,
  ManagerSquad,
  OvertakeOdds,
  RivalContext,
  SquadProjection,
  SquadSlot,
} from "@/lib/types";

const POS_BY_ID: Record<number, "GKP" | "DEF" | "MID" | "FWD"> = {
  1: "GKP",
  2: "DEF",
  3: "MID",
  4: "FWD",
};

export interface SwapLegality {
  ok: boolean;
  reason?: string;
}

export interface SwapResult {
  legality: SwapLegality;
  newSquadProjection?: SquadProjection;
  newOvertake?: OvertakeOdds[];
  budgetAfter: number; // tenths of £m left in the bank after the swap
  xPDeltaXi: number; // new starting-XI xP minus old
  overtakeDelta?: Array<{
    rivalEntryId: number;
    rivalName: string;
    before: number;
    after: number;
    delta: number;
  }>;
  out: { id: number; webName: string; xPoints: number };
  in: { id: number; webName: string; xPoints: number };
}

interface SimulateSwapArgs {
  ctx: RivalContext;
  userSquad: ManagerSquad;
  userProjection: SquadProjection;
  rivalProjections: SquadProjection[];
  baselineOvertake: OvertakeOdds[];
  bank: number;
  outId: number;
  inId: number;
  bs: FplBootstrap;
  fixtures: FplFixture[];
  gw: number;
}

export function simulateSwap(args: SimulateSwapArgs): SwapResult {
  const {
    ctx,
    userSquad,
    userProjection,
    rivalProjections,
    baselineOvertake,
    bank,
    outId,
    inId,
    bs,
    fixtures,
    gw,
  } = args;

  const teamsById = new Map(bs.teams.map((t) => [t.id, t]));
  const outSlot = userSquad.picks.find((s) => s.player.id === outId);
  const inPlayer: FplElement | undefined = bs.elements.find((e) => e.id === inId);
  const baselineXi = userProjection.startingXIPoints;

  if (!outSlot) {
    return failure(
      "Player you're swapping out isn't in the squad.",
      outId,
      inId,
      inPlayer,
      userProjection,
      bank,
      baselineXi,
    );
  }
  if (!inPlayer) {
    return failure("Replacement player not found in FPL pool.", outId, inId, inPlayer, userProjection, bank, baselineXi);
  }
  if (outSlot.player.element_type !== inPlayer.element_type) {
    return failure(
      `Position mismatch (${POS_BY_ID[outSlot.player.element_type]} → ${POS_BY_ID[inPlayer.element_type]}).`,
      outId,
      inId,
      inPlayer,
      userProjection,
      bank,
      baselineXi,
    );
  }
  if (userSquad.picks.some((s) => s.player.id === inId)) {
    return failure("You already own this player.", outId, inId, inPlayer, userProjection, bank, baselineXi);
  }
  const budgetAfter = bank + outSlot.player.now_cost - inPlayer.now_cost;
  if (budgetAfter < 0) {
    return failure(
      `Over budget by £${(-budgetAfter / 10).toFixed(1)}m.`,
      outId,
      inId,
      inPlayer,
      userProjection,
      bank,
      baselineXi,
    );
  }
  // 3-per-team check: count how many squad members are on the IN team AFTER removing the OUT player.
  const teamCount =
    userSquad.picks.filter((s) => s.player.id !== outId && s.player.team === inPlayer.team).length;
  if (teamCount >= 3) {
    return failure(
      `Would put 4 players from ${teamsById.get(inPlayer.team)?.short_name ?? "that club"} in the squad (max 3).`,
      outId,
      inId,
      inPlayer,
      userProjection,
      bank,
      baselineXi,
    );
  }

  // Build the patched squad.
  const inTeam = teamsById.get(inPlayer.team);
  if (!inTeam) {
    return failure("Replacement team not found.", outId, inId, inPlayer, userProjection, bank, baselineXi);
  }
  const inSlot: SquadSlot = {
    pick: { ...outSlot.pick, element: inPlayer.id },
    player: inPlayer,
    team: inTeam,
    position: POS_BY_ID[inPlayer.element_type],
  };
  const patched: ManagerSquad = {
    ...userSquad,
    picks: userSquad.picks.map((s) => (s.player.id === outId ? inSlot : s)),
    starters: userSquad.starters.map((s) => (s.player.id === outId ? inSlot : s)),
    bench: userSquad.bench.map((s) => (s.player.id === outId ? inSlot : s)),
    captain: userSquad.captain?.player.id === outId ? inSlot : userSquad.captain,
    viceCaptain: userSquad.viceCaptain?.player.id === outId ? inSlot : userSquad.viceCaptain,
  };

  const newProjection = projectSquad(patched, fixtures, gw, bs);
  const newOvertake = computeOvertakeOdds({ ...ctx, user: patched }, newProjection, rivalProjections);

  const outProj = userProjection.perPlayer.find((p) => p.playerId === outId);
  const inProj = newProjection.perPlayer.find((p) => p.playerId === inId);

  const overtakeDelta = newOvertake.map((o) => {
    const before = baselineOvertake.find((b) => b.rivalEntryId === o.rivalEntryId);
    return {
      rivalEntryId: o.rivalEntryId,
      rivalName: o.rivalName,
      before: before?.overtakeProbability ?? 0,
      after: o.overtakeProbability,
      delta: Number(((o.overtakeProbability - (before?.overtakeProbability ?? 0))).toFixed(3)),
    };
  });

  return {
    legality: { ok: true },
    newSquadProjection: newProjection,
    newOvertake,
    budgetAfter,
    xPDeltaXi: Number((newProjection.startingXIPoints - baselineXi).toFixed(2)),
    overtakeDelta,
    out: { id: outId, webName: outSlot.player.web_name, xPoints: outProj?.xPoints ?? 0 },
    in: { id: inId, webName: inPlayer.web_name, xPoints: inProj?.xPoints ?? 0 },
  };
}

function failure(
  reason: string,
  outId: number,
  inId: number,
  inPlayer: FplElement | undefined,
  userProjection: SquadProjection,
  bank: number,
  baselineXi: number,
): SwapResult {
  void baselineXi;
  void userProjection;
  return {
    legality: { ok: false, reason },
    budgetAfter: bank,
    xPDeltaXi: 0,
    out: { id: outId, webName: "", xPoints: 0 },
    in: { id: inId, webName: inPlayer?.web_name ?? "", xPoints: 0 },
  };
}
