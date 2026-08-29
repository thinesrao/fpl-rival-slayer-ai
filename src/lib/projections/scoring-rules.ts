// FPL scoring constants, shared by the model (which predicts points) and the
// decomposition (which explains observed points). Defined once so the two can
// never disagree.

import type { Position } from "@/lib/types";

export const GOAL_POINTS: Record<Position, number> = { GKP: 6, DEF: 6, MID: 5, FWD: 4 };
export const CLEAN_SHEET_POINTS: Record<Position, number> = { GKP: 4, DEF: 4, MID: 1, FWD: 0 };
export const ASSIST_POINTS = 3;

/** Defensive-contribution count at which 2 points are awarded. Null = never. */
export const DC_THRESHOLD: Record<Position, number | null> = {
  GKP: null,
  DEF: 10,
  MID: 12,
  FWD: 12,
};

export const DC_POINTS = 2;
