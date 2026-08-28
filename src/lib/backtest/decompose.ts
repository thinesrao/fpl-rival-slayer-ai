// Splits an observed gameweek score into its scoring components.
//
// Used by the evaluator to attribute error to a component rather than
// reporting one opaque residual, and to verify the defensive-contribution
// thresholds against recorded data rather than against the rulebook.

import type { PanelRow } from "@/lib/backtest/types";
import {
  ASSIST_POINTS,
  CLEAN_SHEET_POINTS,
  DC_POINTS,
  DC_THRESHOLD,
  GOAL_POINTS,
} from "@/lib/projections/scoring-rules";

export interface PointsBreakdown {
  appearance: number;
  goals: number;
  assists: number;
  cleanSheet: number;
  concededPenalty: number;
  saves: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  ownGoals: number;
  cards: number;
  bonus: number;
  defensiveContribution: number;
  total: number;
}

export function decomposeActualPoints(row: PanelRow): PointsBreakdown {
  const played60 = row.minutes >= 60;
  const concedes = row.position === "GKP" || row.position === "DEF";
  const threshold = DC_THRESHOLD[row.position];

  const parts = {
    appearance: row.minutes === 0 ? 0 : played60 ? 2 : 1,
    goals: row.goalsScored * GOAL_POINTS[row.position],
    assists: row.assists * ASSIST_POINTS,
    cleanSheet: played60 && row.cleanSheets > 0 ? CLEAN_SHEET_POINTS[row.position] : 0,
    concededPenalty: concedes ? -Math.floor(row.goalsConceded / 2) : 0,
    saves: Math.floor(row.saves / 3),
    penaltiesSaved: row.penaltiesSaved * 5,
    penaltiesMissed: row.penaltiesMissed * -2,
    ownGoals: row.ownGoals * -2,
    cards: row.yellowCards * -1 + row.redCards * -3,
    bonus: row.bonus,
    defensiveContribution:
      threshold !== null && row.defensiveContribution >= threshold ? DC_POINTS : 0,
  };

  const total = Object.values(parts).reduce((sum, v) => sum + v, 0);
  return { ...parts, total };
}
