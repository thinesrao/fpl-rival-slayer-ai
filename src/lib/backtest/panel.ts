// Turns raw archive records into typed rows.
//
// The caller's round wins over the file's `round` column: a mislabelled row
// would otherwise place a future observation into an earlier round and defeat
// the leakage guard in features.ts.

import type { Position } from "@/lib/types";
import type { Season } from "@/lib/backtest/corpus";
import type { PanelRow } from "@/lib/backtest/types";

function num(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function toPosition(raw: string | undefined): Position {
  switch (raw) {
    case "GK":
    case "GKP":
      return "GKP";
    case "DEF":
      return "DEF";
    case "MID":
      return "MID";
    case "FWD":
      return "FWD";
    default:
      throw new Error(`unknown position in corpus: ${String(raw)}`);
  }
}

export function toPanelRows(
  raw: Array<Record<string, string>>,
  season: Season,
  round: number,
): PanelRow[] {
  return raw.map((r) => {
    const xp = num(r.xP);
    return {
      season,
      round,
      playerId: num(r.element),
      webName: r.name ?? "",
      position: toPosition(r.position),
      teamName: r.team ?? "",
      opponentTeam: num(r.opponent_team),
      wasHome: (r.was_home ?? "").toLowerCase() === "true",
      minutes: num(r.minutes),
      starts: num(r.starts),
      totalPoints: num(r.total_points),
      goalsScored: num(r.goals_scored),
      assists: num(r.assists),
      cleanSheets: num(r.clean_sheets),
      goalsConceded: num(r.goals_conceded),
      ownGoals: num(r.own_goals),
      penaltiesSaved: num(r.penalties_saved),
      penaltiesMissed: num(r.penalties_missed),
      yellowCards: num(r.yellow_cards),
      redCards: num(r.red_cards),
      saves: num(r.saves),
      bonus: num(r.bonus),
      bps: num(r.bps),
      expectedGoals: num(r.expected_goals),
      expectedAssists: num(r.expected_assists),
      expectedGoalsConceded: num(r.expected_goals_conceded),
      defensiveContribution: num(r.defensive_contribution),
      value: num(r.value),
      fplXp: xp === 0 ? null : xp,
    };
  });
}

export function groupByPlayer(rows: PanelRow[]): Map<number, PanelRow[]> {
  const grouped = new Map<number, PanelRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.playerId);
    if (list) list.push(row);
    else grouped.set(row.playerId, [row]);
  }
  for (const list of grouped.values()) list.sort((a, b) => a.round - b.round);
  return grouped;
}
