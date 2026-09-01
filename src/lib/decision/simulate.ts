// Paired Monte-Carlo comparison of two versions of the same squad.
//
// A transfer changes one of fifteen players and a captain switch changes none
// of them — just a multiplier. Sampling the two scenarios independently would
// estimate that small effect as the difference of two much larger noisy
// quantities, and the interval the decision rule needs would almost never
// exclude zero, for reasons that have nothing to do with the football.
//
// So both scenarios are evaluated against the SAME draws (common random
// numbers). The rival's sampled score is shared too. What survives the
// subtraction is the effect of the change itself.
//
// Batching gives the delta a distribution: each batch is an independent
// estimate, and the 10th/90th percentiles across batches form the 80%
// interval that the decision rule tests against zero.
//
// Each draw consumes exactly one shared normal deviate for the user (scaled
// separately for baseline and variant) and one shared normal deviate for
// "the rival environment this week" (scaled per rival's own mean/stdev).
// Drawing the rival deviate once per draw — not once per rival — keeps
// stream consumption independent of how many rivals are being evaluated, so
// summing the delta across an arbitrary set of rivals is exact rather than
// merely close.

import { mulberry32, normalSampler } from "@/lib/decision/rng";
import type { SquadProjection } from "@/lib/types";

export const BATCHES = 40;
export const DRAWS_PER_BATCH = 500;

export interface RivalTarget {
  entryId: number;
  name: string;
  expected: number;
  stdev: number;
  /** Standings gap to close. 0 when the user is already level or ahead. */
  pointsBehind: number;
}

export interface DeltaDistribution {
  /** Mean change in summed overtake probability, variant minus baseline. */
  mean: number;
  lower80: number;
  upper80: number;
  perRival: Array<{ rivalEntryId: number; rivalName: string; before: number; after: number }>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

export function simulateDelta(args: {
  baseline: SquadProjection;
  variant: SquadProjection;
  rivals: RivalTarget[];
  seed: number;
}): DeltaDistribution {
  const { baseline, variant, rivals, seed } = args;

  const batchDeltas: number[] = [];
  const beforeHits = rivals.map(() => 0);
  const afterHits = rivals.map(() => 0);
  let totalDraws = 0;

  for (let b = 0; b < BATCHES; b++) {
    // Each batch gets its own streams, derived from the run seed so the
    // whole distribution is reproducible. The user and rival dimensions use
    // separate streams so that neither's consumption rate depends on the
    // other.
    const userSample = normalSampler(mulberry32((seed + b * 0x9e3779b9) >>> 0));
    const rivalSample = normalSampler(mulberry32((seed + b * 0x9e3779b9 + 1) >>> 0));
    let batchDelta = 0;

    for (let d = 0; d < DRAWS_PER_BATCH; d++) {
      // One shared standard-normal draw per squad, reused across scenarios.
      const zUser = userSample(0, 1);
      const baseScore = baseline.startingXIPoints + Math.max(1, baseline.stdev) * zUser;
      const varScore = variant.startingXIPoints + Math.max(1, variant.stdev) * zUser;

      // One shared standard-normal draw for the rival environment this week,
      // reused across every rival being evaluated — see header note.
      const zRival = rivalSample(0, 1);

      for (let i = 0; i < rivals.length; i++) {
        const rival = rivals[i];
        const rivalScore = rival.expected + Math.max(1, rival.stdev) * zRival;
        const need = rival.pointsBehind;
        const before = baseScore - rivalScore > need ? 1 : 0;
        const after = varScore - rivalScore > need ? 1 : 0;
        beforeHits[i] += before;
        afterHits[i] += after;
        batchDelta += after - before;
      }
      totalDraws++;
    }

    batchDeltas.push(batchDelta / DRAWS_PER_BATCH);
  }

  const sorted = [...batchDeltas].sort((x, y) => x - y);
  const mean = batchDeltas.reduce((s, x) => s + x, 0) / batchDeltas.length;

  return {
    mean,
    lower80: percentile(sorted, 0.1),
    upper80: percentile(sorted, 0.9),
    perRival: rivals.map((r, i) => ({
      rivalEntryId: r.entryId,
      rivalName: r.name,
      before: beforeHits[i] / totalDraws,
      after: afterHits[i] / totalDraws,
    })),
  };
}
