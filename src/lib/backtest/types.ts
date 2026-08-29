import type { Position } from "@/lib/types";
import type { Season } from "@/lib/backtest/corpus";

/** One player's observed record for one gameweek. */
export interface PanelRow {
  season: Season;
  round: number;
  playerId: number;
  webName: string;
  position: Position;
  teamName: string;
  opponentTeam: number;
  wasHome: boolean;
  minutes: number;
  starts: number;
  totalPoints: number;
  goalsScored: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  ownGoals: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  bonus: number;
  bps: number;
  expectedGoals: number;
  expectedAssists: number;
  expectedGoalsConceded: number;
  defensiveContribution: number;
  value: number;
  /** FPL's own expected points, or null when the column is absent/zero. */
  fplXp: number | null;
}
