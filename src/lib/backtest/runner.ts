// Scores a set of held-out gameweeks and compares against three baselines.
//
// Only 2025-26 is used: it is the sole archived season sharing 2026-27's
// scoring rules, so it alone can validate the points mapping.

import { RULE_CURRENT_SEASON } from "@/lib/backtest/corpus";
import { decomposeActualPoints } from "@/lib/backtest/decompose";
import { calibrationBuckets, evaluate, type MetricResult } from "@/lib/backtest/evaluate";
import { groupByPlayer, toPanelRows } from "@/lib/backtest/panel";
import type { PanelRow } from "@/lib/backtest/types";
import { MIN_HISTORY_ROUNDS, buildFeatures } from "@/lib/projections/features";
import { scorePlayer } from "@/lib/projections/scoring";
import type { Position } from "@/lib/types";

/** Gameweeks carrying FPL's xP and at least three prior rounds of history. */
export const HOLDOUT_ROUNDS: readonly number[] = [4, 5, 6, 8, 9, 24, 29, 38];

const SEASON_ROUNDS = Array.from({ length: 38 }, (_, i) => i + 1);

export function fitRounds(): number[] {
  return SEASON_ROUNDS.filter((r) => !HOLDOUT_ROUNDS.includes(r));
}

export type RoundLoader = (round: number) => Promise<Array<Record<string, string>> | null>;

export interface Prediction {
  round: number;
  playerId: number;
  position: Position;
  started: boolean;
  ourXp: number;
  fplXp: number | null;
  actual: number;
  sampleRounds: number;
}

export interface SegmentReport {
  model: MetricResult;
  fplXp: MetricResult;
  mean: MetricResult;
}

export interface BacktestReport {
  season: string;
  roundsRequested: number[];
  roundsEvaluated: number[];
  gaps: number[];
  predictions: Prediction[];
  all: SegmentReport;
  starters: SegmentReport;
  byPosition: Record<string, MetricResult>;
  calibration: ReturnType<typeof calibrationBuckets>;
}

async function loadHistory(
  loader: RoundLoader,
  upToRound: number,
): Promise<Map<number, PanelRow[]>> {
  const rows: PanelRow[] = [];
  for (let r = 1; r < upToRound; r++) {
    const raw = await loader(r);
    if (raw) rows.push(...toPanelRows(raw, RULE_CURRENT_SEASON, r));
  }
  return groupByPlayer(rows);
}

/** Rolling expected goals conceded per 90 for each opponent, prior rounds only. */
function opponentXgc(history: Map<number, PanelRow[]>): Map<number, number> {
  const totals = new Map<number, { xgc: number; minutes: number }>();
  for (const rows of history.values()) {
    for (const row of rows) {
      const t = totals.get(row.opponentTeam) ?? { xgc: 0, minutes: 0 };
      t.xgc += row.expectedGoalsConceded;
      t.minutes += row.minutes;
      totals.set(row.opponentTeam, t);
    }
  }
  const out = new Map<number, number>();
  for (const [team, t] of totals) {
    out.set(team, t.minutes > 0 ? (t.xgc / t.minutes) * 90 : 1.2);
  }
  return out;
}

function segment(rows: Prediction[]): SegmentReport {
  const actual = rows.map((r) => r.actual);
  const meanActual = actual.length ? actual.reduce((s, v) => s + v, 0) / actual.length : 0;
  const withFpl = rows.filter((r) => r.fplXp !== null);
  return {
    model: evaluate(rows.map((r) => r.ourXp), actual),
    fplXp: evaluate(withFpl.map((r) => r.fplXp as number), withFpl.map((r) => r.actual)),
    // Predict-the-mean has zero variance, so evaluate() reports it as degenerate
    // by design. RMSE against it is reported through the report's own summary.
    mean: evaluate(actual.map(() => meanActual), actual),
  };
}

export async function runBacktest(opts: {
  rounds: number[];
  loader: RoundLoader;
  window?: number;
}): Promise<BacktestReport> {
  const predictions: Prediction[] = [];
  const evaluated: number[] = [];
  const gaps: number[] = [];

  for (const round of opts.rounds) {
    const raw = await opts.loader(round);
    if (!raw) {
      gaps.push(round);
      continue;
    }
    evaluated.push(round);

    const history = await loadHistory(opts.loader, round);
    const xgc = opponentXgc(history);
    const actualRows = toPanelRows(raw, RULE_CURRENT_SEASON, round);

    for (const actualRow of actualRows) {
      const prior = (history.get(actualRow.playerId) ?? []).filter((r) => r.round < round);
      if (prior.length < MIN_HISTORY_ROUNDS) continue;

      const features = buildFeatures(prior, round, {
        fdr: 3,
        isHome: actualRow.wasHome,
        fixtureCount: 1,
        opponentXgcPer90: xgc.get(actualRow.opponentTeam) ?? 1.2,
      }, { window: opts.window });

      predictions.push({
        round,
        playerId: actualRow.playerId,
        position: actualRow.position,
        started: actualRow.starts > 0,
        ourXp: scorePlayer(features).xPoints,
        fplXp: actualRow.fplXp,
        actual: decomposeActualPoints(actualRow).total,
        sampleRounds: features.sampleRounds,
      });
    }
  }

  if (evaluated.length === 0) {
    throw new Error(`backtest: no rounds could be loaded from ${opts.rounds.join(", ")}`);
  }

  const starters = predictions.filter((p) => p.started);
  const byPosition: Record<string, MetricResult> = {};
  for (const pos of ["GKP", "DEF", "MID", "FWD"] as const) {
    const subset = starters.filter((p) => p.position === pos);
    byPosition[pos] = evaluate(subset.map((p) => p.ourXp), subset.map((p) => p.actual));
  }

  return {
    season: RULE_CURRENT_SEASON,
    roundsRequested: opts.rounds,
    roundsEvaluated: evaluated,
    gaps,
    predictions,
    all: segment(predictions),
    starters: segment(starters),
    byPosition,
    calibration: calibrationBuckets(
      starters.map((p) => p.ourXp),
      starters.map((p) => p.actual),
      10,
    ),
  };
}
