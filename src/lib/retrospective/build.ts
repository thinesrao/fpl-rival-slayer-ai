// Build the post-GW retrospective by joining a stored pre-GW snapshot with
// live + final picks data. Surfaces the same comparisons the user actually
// cared about pre-deadline: captain hit/miss, projected XI vs actual, and
// per-rival points gained/lost.

import type { FplLive } from "@/lib/fpl/client";
import type { FplPicksResponse, ManagerSquad, OvertakeOdds, SquadProjection } from "@/lib/types";

interface SnapshotPayload {
  context: { user: ManagerSquad; rivals: ManagerSquad[]; leagueName: string };
  targetGw: number;
  projections: { user: SquadProjection; rivals: SquadProjection[]; overtake: OvertakeOdds[] };
  ai?: {
    recommendation: {
      captain: { pick: string; vice: string };
      transfers: Array<{ out: string; in: string; reason: string }>;
      starting_xi: string[];
    };
  };
}

export interface PlayerRetro {
  playerId: number;
  webName: string;
  predicted: number;
  actual: number;
  delta: number;
  minutes: number;
  played: boolean;
  multiplier: number; // from FINAL picks (post-autosubs FPL counts what actually scored)
}

export interface ManagerRetro {
  entryId: number;
  name: string;
  predictedXI: number;
  actualXI: number;
  delta: number;
  captain: { name: string; minutes: number; actual: number; predictedDelta: number };
  perPlayer: PlayerRetro[];
}

export interface RivalRetro extends ManagerRetro {
  pointsGainedVsRival: number; // user.actualXI - rival.actualXI
  predictedGain: number; // user.predictedXI - rival.predictedXI
}

export interface RetrospectiveResult {
  gw: number;
  leagueName: string;
  user: ManagerRetro;
  rivals: RivalRetro[];
  aiVerdict?: {
    captainPick: string;
    captainActual: number;
    transfersRecommended: number;
    note: string;
  };
}

function liveById(live: FplLive): Map<number, number> {
  // Returns map of playerId → live total_points.
  return new Map(live.elements.map((e) => [e.id, e.stats.total_points]));
}

function liveMinutes(live: FplLive): Map<number, number> {
  return new Map(live.elements.map((e) => [e.id, e.stats.minutes]));
}

function buildManagerRetro(
  squad: ManagerSquad,
  projection: SquadProjection,
  finalPicks: FplPicksResponse,
  live: FplLive,
): ManagerRetro {
  const pts = liveById(live);
  const mins = liveMinutes(live);
  const projByPlayer = new Map(projection.perPlayer.map((p) => [p.playerId, p.xPoints]));

  // FINAL multipliers reflect autosubs and captain changes the manager made.
  const finalMultByPlayer = new Map<number, number>(
    finalPicks.picks.map((p) => [p.element, p.multiplier]),
  );

  const perPlayer: PlayerRetro[] = squad.picks.map((slot) => {
    const id = slot.player.id;
    const actualBase = pts.get(id) ?? 0;
    const multiplier: number = finalMultByPlayer.get(id) ?? 0;
    const predictedBase = projByPlayer.get(id) ?? 0;
    return {
      playerId: id,
      webName: slot.player.web_name,
      predicted: predictedBase,
      actual: actualBase,
      delta: actualBase - predictedBase,
      minutes: mins.get(id) ?? 0,
      played: (mins.get(id) ?? 0) > 0,
      multiplier,
    };
  });

  const actualXI = perPlayer.reduce((acc, p) => acc + p.actual * p.multiplier, 0);
  const predictedXI = projection.startingXIPoints;

  // Captain = the player with multiplier ≥ 2 in the FINAL picks (handles captain swaps).
  const captainPick = finalPicks.picks.find((p) => p.multiplier >= 2);
  const captainSlot = squad.picks.find((s) => s.player.id === captainPick?.element);
  const captainName = captainSlot?.player.web_name ?? "(none)";
  const captainActual = pts.get(captainPick?.element ?? 0) ?? 0;
  const captainPredicted = projByPlayer.get(captainPick?.element ?? 0) ?? 0;

  return {
    entryId: squad.entry.id,
    name: squad.entry.name,
    predictedXI,
    actualXI,
    delta: actualXI - predictedXI,
    captain: {
      name: captainName,
      minutes: mins.get(captainPick?.element ?? 0) ?? 0,
      actual: captainActual * (captainPick?.multiplier ?? 2),
      predictedDelta: captainActual - captainPredicted,
    },
    perPlayer,
  };
}

export function buildRetrospective(
  snapshot: SnapshotPayload,
  userFinalPicks: FplPicksResponse,
  rivalFinalPicks: Array<{ entryId: number; picks: FplPicksResponse }>,
  live: FplLive,
): RetrospectiveResult {
  const user = buildManagerRetro(snapshot.context.user, snapshot.projections.user, userFinalPicks, live);

  const rivals: RivalRetro[] = snapshot.context.rivals.map((squad, i) => {
    const proj = snapshot.projections.rivals[i];
    const picks = rivalFinalPicks.find((r) => r.entryId === squad.entry.id);
    if (!proj || !picks) {
      return {
        entryId: squad.entry.id,
        name: squad.entry.name,
        predictedXI: 0,
        actualXI: 0,
        delta: 0,
        captain: { name: "?", minutes: 0, actual: 0, predictedDelta: 0 },
        perPlayer: [],
        pointsGainedVsRival: 0,
        predictedGain: 0,
      };
    }
    const base = buildManagerRetro(squad, proj, picks.picks, live);
    return {
      ...base,
      pointsGainedVsRival: user.actualXI - base.actualXI,
      predictedGain: user.predictedXI - base.predictedXI,
    };
  });

  let aiVerdict: RetrospectiveResult["aiVerdict"];
  if (snapshot.ai) {
    const rec = snapshot.ai.recommendation;
    const captainSlot = snapshot.context.user.picks.find((s) => s.player.web_name === rec.captain.pick);
    const captainActual = captainSlot
      ? (liveById(live).get(captainSlot.player.id) ?? 0) * 2
      : 0;
    const aiVsActual =
      captainSlot && user.captain.name === rec.captain.pick ? "followed" : "overridden";
    aiVerdict = {
      captainPick: rec.captain.pick,
      captainActual,
      transfersRecommended: rec.transfers.length,
      note: `AI captain pick ${rec.captain.pick} would have scored ${captainActual}; you ${aiVsActual} it.`,
    };
  }

  return {
    gw: snapshot.targetGw,
    leagueName: snapshot.context.leagueName,
    user,
    rivals,
    aiVerdict,
  };
}
