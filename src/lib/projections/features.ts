// Builds the feature vector the scoring model consumes.
//
// The signature is the leakage guard: buildFeatures cannot see the round it is
// predicting, and throws if handed a row from it or later. That makes leakage a
// bug the harness structurally cannot express, rather than one a reviewer has
// to notice.
//
// Rolling rates are rebuilt from per-match observations rather than read from
// FPL's live per-90 and season-cumulative fields, because we control the window
// and the same code can run over history.

import type { Position } from "@/lib/types";
import type { PanelRow } from "@/lib/backtest/types";

/** Fewer prior rounds than this and a projection is not trustworthy. */
export const MIN_HISTORY_ROUNDS = 3;

/** Default rolling window, in rounds. Tuned in Task 9. */
export const DEFAULT_WINDOW = 6;

export class LeakageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeakageError";
  }
}

export interface FixtureContext {
  /** 1 (easy) .. 5 (hard). */
  fdr: number;
  isHome: boolean;
  /** 0 for a blank gameweek, 1 normally, 2+ for a double. */
  fixtureCount: number;
  /** Rolling expected goals conceded per 90 by the opponent. */
  opponentXgcPer90: number;
}

export interface PlayerFeatures {
  playerId: number;
  webName: string;
  position: Position;
  /** Rolling expected goals per 90 minutes, prior rounds only. */
  xg90: number;
  /** Rolling expected assists per 90 minutes, prior rounds only. */
  xa90: number;
  /** Rolling bonus-point-system score per 90. Replaces the cumulative ICT term. */
  bps90: number;
  /** Rolling defensive-contribution count per 90. */
  dcPer90: number;
  /** Fraction of prior rounds in which the player started. */
  startRate: number;
  /** Mean minutes in rounds the player started. */
  minutesPerStart: number;
  /** 0..1 chance of being available. 1 when unknown. */
  availability: number;
  fdr: number;
  isHome: boolean;
  fixtureCount: number;
  opponentXgcPer90: number;
  /** How many prior rounds contributed. Compare against MIN_HISTORY_ROUNDS. */
  sampleRounds: number;
}

export interface BuildFeaturesOptions {
  window?: number;
  availability?: number;
}

function per90(total: number, minutes: number): number {
  if (minutes <= 0) return 0;
  return (total / minutes) * 90;
}

function clampUnit(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * @param history Rows for one player. Must contain no row with `round >= round`.
 * @param round   The round being predicted.
 * @throws {LeakageError} if any row is from `round` or later.
 */
export function buildFeatures(
  history: PanelRow[],
  round: number,
  fixture: FixtureContext,
  opts: BuildFeaturesOptions = {},
): PlayerFeatures {
  for (const row of history) {
    if (row.round >= round) {
      throw new LeakageError(
        `buildFeatures for round ${round} was given a row from round ${row.round}`,
      );
    }
  }

  const window = opts.window ?? DEFAULT_WINDOW;
  const recent = [...history].sort((a, b) => a.round - b.round).slice(-window);

  const minutes = recent.reduce((s, r) => s + r.minutes, 0);
  const started = recent.filter((r) => r.starts > 0);
  const startedMinutes = started.reduce((s, r) => s + r.minutes, 0);

  const first = history[0];

  return {
    playerId: first?.playerId ?? 0,
    webName: first?.webName ?? "",
    position: first?.position ?? "MID",
    xg90: per90(recent.reduce((s, r) => s + r.expectedGoals, 0), minutes),
    xa90: per90(recent.reduce((s, r) => s + r.expectedAssists, 0), minutes),
    bps90: per90(recent.reduce((s, r) => s + r.bps, 0), minutes),
    dcPer90: per90(recent.reduce((s, r) => s + r.defensiveContribution, 0), minutes),
    startRate: recent.length === 0 ? 0 : started.length / recent.length,
    minutesPerStart: started.length === 0 ? 0 : startedMinutes / started.length,
    availability: opts.availability === undefined ? 1 : clampUnit(opts.availability),
    fdr: fixture.fdr,
    isHome: fixture.isHome,
    fixtureCount: fixture.fixtureCount,
    opponentXgcPer90: fixture.opponentXgcPer90,
    sampleRounds: recent.length,
  };
}
