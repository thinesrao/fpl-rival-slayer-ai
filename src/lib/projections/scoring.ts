// The expected-points model. This is the single scoring path: the live app and
// the backtest harness both call it, so the harness validates shipped code.
//
// Fixes, each covered by a named regression test in scoring.test.ts:
//   1. Play probability is applied exactly once (it used to be squared).
//   2. There is no form term (it double-counted output already in xg90/xa90/bps90).
//   3. Bonus comes from a per-90 BPS rate, not a season-cumulative ICT index.
//   4. Fixture difficulty enters once, through opponentXgcPer90.
//
// Coefficients marked TUNED are fitted in Task 9 against 2025-26 and must not be
// hand-adjusted without re-running the backtest.

import type { Position } from "@/lib/types";
import type { PlayerFeatures } from "@/lib/projections/features";
import {
  ASSIST_POINTS,
  CLEAN_SHEET_POINTS,
  DC_POINTS,
  DC_THRESHOLD,
  GOAL_POINTS,
} from "@/lib/projections/scoring-rules";

/** TUNED. Maps a per-90 BPS rate onto expected bonus points, capped at the real max of 3. */
const BONUS_PER_BPS90 = 0.06;
const MAX_BONUS = 3;

/** TUNED. Poisson rate parameter converting opponent xGC/90 into P(clean sheet). */
const CLEAN_SHEET_BASE = 1.0;

export interface ScoreComponents {
  appearance: number;
  goals: number;
  assists: number;
  cleanSheet: number;
  bonus: number;
  defensiveContribution: number;
}

export interface ScoredPlayer {
  xPoints: number;
  components: ScoreComponents;
  /** Expected minutes for a single fixture, 0..90. */
  expectedMinutes: number;
  /** P(the player features at all). Applied once to the whole score. */
  playProbability: number;
}

/**
 * P(clean sheet) from the opponent's rolling expected goals conceded per 90,
 * as the zero bucket of a Poisson with that rate. This is the only place
 * fixture difficulty enters the model.
 */
export function cleanSheetProbability(opponentXgcPer90: number): number {
  const rate = Math.max(0, opponentXgcPer90) * CLEAN_SHEET_BASE;
  return Math.exp(-rate);
}

/**
 * P(defensive-contribution count reaches the positional threshold).
 *
 * The award is a threshold crossing, not a linear scale, so this is the upper
 * tail of a Poisson whose rate is the player's per-90 count scaled to expected
 * minutes. Computed as 1 - P(X < threshold).
 */
export function dcProbability(
  dcPer90: number,
  position: Position,
  expectedMinutes: number,
): number {
  const threshold = DC_THRESHOLD[position];
  if (threshold === null || expectedMinutes <= 0) return 0;

  const rate = Math.max(0, dcPer90) * (expectedMinutes / 90);
  if (rate <= 0) return 0;

  // Poisson CDF below the threshold, computed iteratively to avoid factorials.
  let term = Math.exp(-rate);
  let cdf = term;
  for (let k = 1; k < threshold; k++) {
    term = (term * rate) / k;
    cdf += term;
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}

export function scorePlayer(f: PlayerFeatures): ScoredPlayer {
  const zero: ScoreComponents = {
    appearance: 0,
    goals: 0,
    assists: 0,
    cleanSheet: 0,
    bonus: 0,
    defensiveContribution: 0,
  };

  if (f.fixtureCount <= 0) {
    return { xPoints: 0, components: zero, expectedMinutes: 0, playProbability: 0 };
  }

  // Applied exactly once, at the end. Never folded into the per-term scaling.
  const playProbability = Math.max(0, Math.min(1, f.availability * f.startRate));
  const expectedMinutes = Math.max(0, Math.min(90, f.minutesPerStart));
  const minutesShare = expectedMinutes / 90;

  const perFixture: ScoreComponents = {
    appearance: expectedMinutes >= 60 ? 2 : expectedMinutes > 0 ? 1 : 0,
    goals: f.xg90 * minutesShare * GOAL_POINTS[f.position],
    assists: f.xa90 * minutesShare * ASSIST_POINTS,
    cleanSheet:
      CLEAN_SHEET_POINTS[f.position] > 0 && expectedMinutes >= 60
        ? cleanSheetProbability(f.opponentXgcPer90) * CLEAN_SHEET_POINTS[f.position]
        : 0,
    bonus: Math.min(MAX_BONUS, Math.max(0, f.bps90) * BONUS_PER_BPS90 * minutesShare),
    defensiveContribution:
      dcProbability(f.dcPer90, f.position, expectedMinutes) * DC_POINTS,
  };

  const components: ScoreComponents = {
    appearance: perFixture.appearance * f.fixtureCount,
    goals: perFixture.goals * f.fixtureCount,
    assists: perFixture.assists * f.fixtureCount,
    cleanSheet: perFixture.cleanSheet * f.fixtureCount,
    bonus: perFixture.bonus * f.fixtureCount,
    defensiveContribution: perFixture.defensiveContribution * f.fixtureCount,
  };

  const sum = Object.values(components).reduce((s, v) => s + v, 0);
  const xPoints = Math.max(0, sum * playProbability);

  return { xPoints, components, expectedMinutes, playProbability };
}
