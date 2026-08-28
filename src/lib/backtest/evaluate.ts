// Scoring metrics for the backtest.
//
// Degenerate inputs return an explicit failure rather than NaN. During design a
// measurement pass reported NaN correlations and an RMSE worse than predicting
// the mean; the cause was an all-zero prediction column, which makes Spearman's
// denominator collapse. A NaN that reaches a report reads as a number.

export type MetricResult =
  | { ok: true; rmse: number; mae: number; spearman: number; n: number }
  | { ok: false; reason: string; n: number };

function ranks(values: number[]): number[] {
  const indexed = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1][0] === indexed[i][0]) j++;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[indexed[k][1]] = averageRank;
    i = j + 1;
  }
  return out;
}

function hasVariance(values: number[]): boolean {
  return values.some((v) => v !== values[0]);
}

/** Spearman rank correlation, or null when either side is constant. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  if (!hasVariance(a) || !hasVariance(b)) return null;

  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / n;
  const ma = mean(ra);
  const mb = mean(rb);

  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i] - ma;
    const y = rb[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

export function evaluate(predictions: number[], actuals: number[]): MetricResult {
  if (predictions.length !== actuals.length) {
    throw new Error(
      `evaluate: length mismatch (${predictions.length} predictions, ${actuals.length} actuals)`,
    );
  }
  const n = predictions.length;
  if (n === 0) return { ok: false, reason: "empty evaluation set", n: 0 };
  if (!hasVariance(predictions)) {
    return { ok: false, reason: "predictions are constant (zero variance)", n };
  }
  if (!hasVariance(actuals)) {
    return { ok: false, reason: "actuals are constant (zero variance)", n };
  }

  const rho = spearman(predictions, actuals);
  if (rho === null) return { ok: false, reason: "rank correlation undefined", n };

  const rmse = Math.sqrt(
    predictions.reduce((s, p, i) => s + (p - actuals[i]) ** 2, 0) / n,
  );
  const mae = predictions.reduce((s, p, i) => s + Math.abs(p - actuals[i]), 0) / n;

  return { ok: true, rmse, mae, spearman: rho, n };
}

export interface CalibrationBucket {
  lo: number;
  hi: number;
  n: number;
  meanPredicted: number;
  meanActual: number;
}

/** Equal-width buckets over the prediction range. */
export function calibrationBuckets(
  predictions: number[],
  actuals: number[],
  bucketCount = 10,
): CalibrationBucket[] {
  if (predictions.length === 0) return [];

  const lo = Math.min(...predictions);
  const hi = Math.max(...predictions);
  const width = (hi - lo) / bucketCount || 1;

  const buckets: CalibrationBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    lo: lo + i * width,
    hi: lo + (i + 1) * width,
    n: 0,
    meanPredicted: 0,
    meanActual: 0,
  }));

  for (let i = 0; i < predictions.length; i++) {
    const raw = Math.floor((predictions[i] - lo) / width);
    const index = Math.max(0, Math.min(bucketCount - 1, raw));
    const b = buckets[index];
    b.n += 1;
    b.meanPredicted += predictions[i];
    b.meanActual += actuals[i];
  }

  for (const b of buckets) {
    if (b.n > 0) {
      b.meanPredicted /= b.n;
      b.meanActual /= b.n;
    }
  }
  return buckets;
}

/**
 * Fraction of actuals falling inside prediction +/- z * stdev.
 * z defaults to 1.2816, the two-sided 80% Normal quantile.
 */
export function intervalCoverage(
  predictions: number[],
  stdevs: number[],
  actuals: number[],
  z = 1.2816,
): number {
  if (predictions.length === 0) return 0;
  let inside = 0;
  for (let i = 0; i < predictions.length; i++) {
    const half = z * stdevs[i];
    if (actuals[i] >= predictions[i] - half && actuals[i] <= predictions[i] + half) inside++;
  }
  return inside / predictions.length;
}
