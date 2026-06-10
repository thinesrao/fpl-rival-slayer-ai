// The WC26 Fantasy scoring table as data. Official live points always come
// from the feed (stats.roundPoints) — this table exists for UI explanations,
// AI prompt digests, and the value model's position asymmetry.

import type { WcPosition } from "@/lib/wc/fifa/types";

export interface ScoringRule {
  label: string;
  /** Points by position; a single number means "all positions". */
  points: number | Partial<Record<WcPosition, number>>;
  /** e.g. "per 3 saves" — rendering hint for ratio rules. */
  per?: string;
}

export const WC_SCORING: ScoringRule[] = [
  { label: "Appearance (up to 60 min)", points: 1 },
  { label: "Appearance (60+ min)", points: 2 },
  { label: "Goal", points: { GK: 9, DEF: 7, MID: 6, FWD: 5 } },
  { label: "Assist", points: 3 },
  { label: "Clean sheet (60+ min)", points: { GK: 5, DEF: 5, MID: 1 } },
  { label: "Saves", points: { GK: 1 }, per: "every 3 saves" },
  { label: "Penalty save", points: { GK: 3 } },
  { label: "Goals conceded (after the first)", points: { GK: -1, DEF: -1 }, per: "each additional goal" },
  { label: "Tackles won", points: { MID: 1 }, per: "every 3 tackles" },
  { label: "Chances created", points: { MID: 1 }, per: "every 2 chances" },
  { label: "Shots on target", points: { FWD: 1 }, per: "every 2 shots" },
  { label: "Direct free-kick goal (extra)", points: 1 },
  { label: "Penalty won", points: 2 },
  { label: "Penalty conceded", points: -1 },
  { label: "Yellow card", points: -1 },
  { label: "Red card", points: -2 },
  { label: "Own goal", points: -2 },
  { label: "Scouting Bonus (4+ pts at <5% ownership)", points: 2 },
];

export const GOAL_POINTS: Record<WcPosition, number> = { GK: 9, DEF: 7, MID: 6, FWD: 5 };
export const CLEAN_SHEET_POINTS: Record<WcPosition, number> = { GK: 5, DEF: 5, MID: 1, FWD: 0 };

/** Ownership threshold for the Scouting Bonus. */
export const SCOUTING_BONUS_MAX_OWNERSHIP = 5;

/** Compact plain-text scoring digest for AI prompts. */
export function scoringDigest(): string {
  return [
    "SCORING: appearance +1 (<60min) / +2 (60+min); assist +3;",
    "goal: GK +9, DEF +7, MID +6, FWD +5; clean sheet (60+min): GK/DEF +5, MID +1;",
    "GK: +1 per 3 saves, +3 penalty save; GK/DEF: first goal conceded free, then -1 each;",
    "MID: +1 per 3 tackles won, +1 per 2 chances created; FWD: +1 per 2 shots on target;",
    "direct free-kick goal +1 extra; penalty won +2; penalty conceded -1;",
    "yellow -1, red -2, own goal -2; Scouting Bonus +2 (scores 4+ pts while <5% owned).",
    "Captain scores DOUBLE. Player prices are FIXED all tournament (no price changes).",
  ].join(" ");
}
