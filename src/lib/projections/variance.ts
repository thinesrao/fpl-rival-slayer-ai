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

export interface VarianceTable {
  buckets: number[];
  byPosition: Record<Position, number[]>;
}

function bucketIndex(xPoints: number): number {
  const x = Number.isFinite(xPoints) ? Math.max(0, xPoints) : 0;
  const i = BUCKET_EDGES.findIndex((edge) => x < edge);
  return i === -1 ? BUCKET_EDGES.length - 1 : i;
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
    byPosition[pos] = sums[pos].map((sum, i) =>
      counts[pos][i] > 0 ? Math.max(MIN_VARIANCE, sum / counts[pos][i]) : MIN_VARIANCE,
    );
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
      0.3155241718820468, 2.6118184689155215, 7.336210378554302, 6.712226618707537,
      7.560630923816508, 9.661253017570008, 0.25, 0.25, 0.25,
    ],
    DEF: [
      1.8062984566856497, 5.7300399742059716, 6.713180460451636, 10.656870362351112,
      12.567827813329078, 15.927184807240495, 18.40597687281635, 0.25, 0.25,
    ],
    MID: [
      0.991049612849589, 5.601010859724701, 7.931100508005411, 8.846877477308643,
      9.929687180447036, 14.788995392377537, 18.879394097398073, 43.87303230411893, 0.25,
    ],
    FWD: [
      2.2931467486595403, 5.739402002289063, 8.349652343567247, 10.319002087682769,
      9.376937009079693, 30.862972154018173, 24.094137816762206, 34.762039025553655,
      1.2068256794153873,
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
