// Per-player "luck" index for the previous GW.
//
// FPL doesn't expose per-match xG/xA, but it does expose season-cumulative
// per-90 rates. We approximate the GW expectation as `xG90 × minutes/90`,
// then convert the (actual − expected) gap into points using the FPL goal/
// assist values for the player's position.
//
// luckPts is *additive* across the XI to produce an overall luck index:
//   positive → over-performed expectation (lucky)
//   negative → under-performed expectation (unlucky)
//
// The metric is intentionally approximate. Treat it as a rough variance proxy,
// not a precise xG model.

import type {
  FplBootstrap,
  FplElement,
  ManagerSquad,
  Position,
} from "@/lib/types";
import type { FplLive } from "@/lib/fpl/client";

const GOAL_PTS: Record<Position, number> = { GKP: 6, DEF: 6, MID: 5, FWD: 4 };
const ASSIST_PTS = 3;
const POS_BY_ID: Record<number, Position> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

export interface PlayerLuck {
  playerId: number;
  webName: string;
  position: Position;
  minutes: number;
  goalsActual: number;
  assistsActual: number;
  xGExpected: number;
  xAExpected: number;
  luckPtsGoals: number;
  luckPtsAssists: number;
  luckPts: number;
  multiplier: number;
}

export interface LuckSummary {
  luckIndex: number; // sum of luckPts across the starting XI (captain × multiplier)
  perPlayer: PlayerLuck[];
  topLucky: PlayerLuck[]; // top 3 over-performers
  topUnlucky: PlayerLuck[]; // top 3 under-performers
}

export function computeLuck(
  squad: ManagerSquad,
  finalMultByPlayer: Map<number, number>,
  live: FplLive,
  bs: FplBootstrap,
): LuckSummary {
  const elementsById = new Map(bs.elements.map((e) => [e.id, e]));
  const liveById = new Map(live.elements.map((e) => [e.id, e]));

  const perPlayer: PlayerLuck[] = [];
  for (const slot of squad.picks) {
    const mult = finalMultByPlayer.get(slot.player.id) ?? 0;
    if (mult === 0) continue; // skip bench
    const el: FplElement | undefined = elementsById.get(slot.player.id);
    const liveEl = liveById.get(slot.player.id);
    if (!el || !liveEl) continue;
    const minutes = liveEl.stats.minutes ?? 0;
    if (minutes <= 0) continue;
    const minutesFactor = minutes / 90;
    const xGExpected = el.expected_goals_per_90 * minutesFactor;
    const xAExpected = el.expected_assists_per_90 * minutesFactor;
    const goalsActual = liveEl.stats.goals_scored ?? 0;
    const assistsActual = liveEl.stats.assists ?? 0;
    const pos = POS_BY_ID[el.element_type] ?? slot.position;
    const luckPtsGoals = (goalsActual - xGExpected) * GOAL_PTS[pos];
    const luckPtsAssists = (assistsActual - xAExpected) * ASSIST_PTS;
    const luckPts = (luckPtsGoals + luckPtsAssists) * mult;
    perPlayer.push({
      playerId: slot.player.id,
      webName: slot.player.web_name,
      position: pos,
      minutes,
      goalsActual,
      assistsActual,
      xGExpected: Number(xGExpected.toFixed(2)),
      xAExpected: Number(xAExpected.toFixed(2)),
      luckPtsGoals: Number(luckPtsGoals.toFixed(2)),
      luckPtsAssists: Number(luckPtsAssists.toFixed(2)),
      luckPts: Number(luckPts.toFixed(2)),
      multiplier: mult,
    });
  }

  const luckIndex = Number(perPlayer.reduce((acc, p) => acc + p.luckPts, 0).toFixed(2));
  const sorted = [...perPlayer].sort((a, b) => b.luckPts - a.luckPts);
  const topLucky = sorted.filter((p) => p.luckPts > 0).slice(0, 3);
  const topUnlucky = [...sorted].reverse().filter((p) => p.luckPts < 0).slice(0, 3);

  return { luckIndex, perPlayer, topLucky, topUnlucky };
}
