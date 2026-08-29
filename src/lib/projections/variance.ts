// Variance for the overtake Monte Carlo, fitted from historical residuals.
//
// Previously this was a hand-picked positional constant scaled by xPoints,
// which meant the published overtake percentage rested on an invented spread.
// Here it is the observed mean squared residual, bucketed by predicted points
// so that high-scoring predictions carry their genuinely wider spread.

import type { Position } from "@/lib/types";

/** Upper edges of the predicted-points buckets. */
const BUCKET_EDGES = [1, 2, 3, 4, 5, 6, 8, 10, Infinity];

const POSITIONS: readonly Position[] = ["GKP", "DEF", "MID", "FWD"];

/** Floor so the Monte Carlo never samples from a degenerate distribution. */
const MIN_VARIANCE = 0.25;

/**
 * A bucket needs at least this many residuals for its own fit to be trusted.
 * Below this, the bucket is thin evidence and must not be published as-is:
 * a sparse or empty bucket at high predicted points is exactly where an
 * under-stated variance would do the most damage (a near-certain overtake
 * probability precisely where we know the least).
 */
const MIN_BUCKET_SAMPLES = 20;

export interface VarianceTable {
  buckets: number[];
  byPosition: Record<Position, number[]>;
}

function bucketIndex(xPoints: number): number {
  const x = Number.isFinite(xPoints) ? Math.max(0, xPoints) : 0;
  const i = BUCKET_EDGES.findIndex((edge) => x < edge);
  return i === -1 ? BUCKET_EDGES.length - 1 : i;
}

/**
 * Fits one position's per-bucket variance from accumulated squared-residual
 * sums and counts, then widens thin buckets rather than letting them collapse
 * to the floor:
 *
 * - A bucket with >= MIN_BUCKET_SAMPLES uses its own mean squared residual.
 * - A thinner bucket (including empty ones) inherits the nearest lower
 *   bucket that qualified.
 * - If no lower bucket has qualified yet, it uses the position's pooled
 *   variance across all its samples.
 * - If the position has no samples at all, it falls back to MIN_VARIANCE.
 *
 * Finally, variance is forced non-decreasing across buckets: predicted-points
 * uncertainty should never shrink as the projection rises, and a single
 * outlier residual in a near-empty bucket must not read as false precision
 * relative to its neighbours.
 */
function fitPositionVariance(sums: number[], counts: number[]): number[] {
  const totalSum = sums.reduce((s, x) => s + x, 0);
  const totalCount = counts.reduce((s, x) => s + x, 0);
  const pooled = totalCount > 0 ? totalSum / totalCount : MIN_VARIANCE;

  const raw: number[] = [];
  let lastQualified: number | null = null;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] >= MIN_BUCKET_SAMPLES) {
      const value = sums[i] / counts[i];
      raw.push(value);
      lastQualified = value;
    } else {
      raw.push(lastQualified ?? pooled);
    }
  }

  const monotonic: number[] = [];
  let prev = -Infinity;
  for (const value of raw) {
    const clamped = Math.max(value, prev, MIN_VARIANCE);
    monotonic.push(clamped);
    prev = clamped;
  }
  return monotonic;
}

export function fitVariance(
  predictions: Array<{ position: Position; ourXp: number; actual: number }>,
): VarianceTable {
  const sums: Record<Position, number[]> = {
    GKP: BUCKET_EDGES.map(() => 0),
    DEF: BUCKET_EDGES.map(() => 0),
    MID: BUCKET_EDGES.map(() => 0),
    FWD: BUCKET_EDGES.map(() => 0),
  };
  const counts: Record<Position, number[]> = {
    GKP: BUCKET_EDGES.map(() => 0),
    DEF: BUCKET_EDGES.map(() => 0),
    MID: BUCKET_EDGES.map(() => 0),
    FWD: BUCKET_EDGES.map(() => 0),
  };

  for (const p of predictions) {
    const i = bucketIndex(p.ourXp);
    sums[p.position][i] += (p.actual - p.ourXp) ** 2;
    counts[p.position][i] += 1;
  }

  const byPosition = {} as Record<Position, number[]>;
  for (const pos of POSITIONS) {
    byPosition[pos] = fitPositionVariance(sums[pos], counts[pos]);
  }

  return { buckets: [...BUCKET_EDGES], byPosition };
}

/**
 * Committed table. Regenerate with `npm run backtest` and paste the
 * `fittedVariance` block from .backtest/report.json. Do not hand-adjust.
 */
export const FITTED_VARIANCE: VarianceTable = {
  buckets: [...BUCKET_EDGES],
  byPosition: {
    GKP: [
      0.3155241718820468, 2.6118184689155215, 7.336210378554302, 7.336210378554302,
      7.560630923816508, 7.560630923816508, 7.560630923816508, 7.560630923816508,
      7.560630923816508,
    ],
    DEF: [
      1.8062984566856497, 5.7300399742059716, 6.713180460451636, 10.656870362351112,
      12.567827813329078, 15.927184807240495, 18.40597687281635, 18.40597687281635,
      18.40597687281635,
    ],
    MID: [
      0.991049612849589, 5.601010859724701, 7.931100508005411, 8.846877477308643,
      9.929687180447036, 14.788995392377537, 18.879394097398073, 18.879394097398073,
      18.879394097398073,
    ],
    FWD: [
      2.2931467486595403, 5.739402002289063, 8.349652343567247, 10.319002087682769,
      10.319002087682769, 10.319002087682769, 10.319002087682769, 10.319002087682769,
      10.319002087682769,
    ],
  },
};

export function estimateVariance(
  position: Position,
  xPoints: number,
  table: VarianceTable = FITTED_VARIANCE,
): number {
  const row = table.byPosition[position] ?? FITTED_VARIANCE.byPosition[position];
  const value = row[bucketIndex(xPoints)];
  return Number.isFinite(value) && value > 0 ? value : MIN_VARIANCE;
}
