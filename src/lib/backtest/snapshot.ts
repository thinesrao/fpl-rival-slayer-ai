// Captures our own copy of each gameweek, so the benchmark stops depending on
// the archive's patchy xP coverage (11 of 38 gameweeks in 2025-26) and works for
// the current season, which is not archived at all.
//
// Two captures per gameweek:
//   pre     - before the deadline: the features, plus FPL's own ep_next
//   settled - after the gameweek finishes: the actuals

import type { FplLive } from "@/lib/fpl/client";
import type { FplBootstrap } from "@/lib/types";

export interface PreDeadlinePlayer {
  id: number;
  epNext: number;
  xg90: number;
  xa90: number;
  startsPer90: number;
  chanceOfPlaying: number | null;
  elementType: number;
  teamId: number;
}

export interface PreDeadlineSnapshot {
  gw: number;
  capturedAt: string;
  players: PreDeadlinePlayer[];
}

export interface SettledPlayer {
  id: number;
  minutes: number;
  starts: number;
  bps: number;
  bonus: number;
  defensiveContribution: number;
  totalPoints: number;
  expectedGoals: number;
  expectedAssists: number;
}

export interface SettledSnapshot {
  gw: number;
  capturedAt: string;
  players: SettledPlayer[];
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function snapshotKey(kind: "pre" | "settled", gw: number): string {
  return `rs:snapshot:${kind}:${gw}`;
}

export function buildPreDeadlineSnapshot(
  bs: FplBootstrap,
  gw: number,
  capturedAt: string,
): PreDeadlineSnapshot {
  return {
    gw,
    capturedAt,
    players: bs.elements.map((e) => ({
      id: e.id,
      epNext: num(e.ep_next),
      xg90: num(e.expected_goals_per_90),
      xa90: num(e.expected_assists_per_90),
      startsPer90: num(e.starts_per_90),
      chanceOfPlaying:
        e.chance_of_playing_next_round === null || e.chance_of_playing_next_round === undefined
          ? null
          : num(e.chance_of_playing_next_round),
      elementType: e.element_type,
      teamId: e.team,
    })),
  };
}

export function buildSettledSnapshot(
  live: FplLive,
  gw: number,
  capturedAt: string,
): SettledSnapshot {
  return {
    gw,
    capturedAt,
    players: live.elements.map((e) => ({
      id: e.id,
      minutes: num(e.stats.minutes),
      starts: num(e.stats.starts),
      bps: num(e.stats.bps),
      bonus: num(e.stats.bonus),
      defensiveContribution: num(e.stats.defensive_contribution),
      totalPoints: num(e.stats.total_points),
      expectedGoals: num(e.stats.expected_goals),
      expectedAssists: num(e.stats.expected_assists),
    })),
  };
}
