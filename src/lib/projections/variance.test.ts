import { describe, expect, it } from "vitest";

import type { Position } from "@/lib/types";
import { estimateVariance, fitVariance } from "@/lib/projections/variance";

function sample(position: Position, ourXp: number, actual: number) {
  return { position, ourXp, actual };
}

describe("regression: variance is derived from residuals, not constants", () => {
  it("gives a larger variance to a population with larger residuals", () => {
    const tight = fitVariance(
      Array.from({ length: 200 }, (_, i) => sample("MID", 4, 4 + (i % 2 === 0 ? 0.5 : -0.5))),
    );
    const loose = fitVariance(
      Array.from({ length: 200 }, (_, i) => sample("MID", 4, 4 + (i % 2 === 0 ? 8 : -8))),
    );
    expect(estimateVariance("MID", 4, loose)).toBeGreaterThan(estimateVariance("MID", 4, tight));
  });

  it("produces different variances for different positions from the same data", () => {
    const table = fitVariance([
      ...Array.from({ length: 100 }, (_, i) => sample("DEF", 3, 3 + (i % 2 ? 0.4 : -0.4))),
      ...Array.from({ length: 100 }, (_, i) => sample("FWD", 3, 3 + (i % 2 ? 6 : -6))),
    ]);
    expect(estimateVariance("FWD", 3, table)).toBeGreaterThan(estimateVariance("DEF", 3, table));
  });

  it("is not a fixed positional constant scaled by xPoints", () => {
    const table = fitVariance([
      ...Array.from({ length: 100 }, (_, i) => sample("MID", 1, 1 + (i % 2 ? 0.2 : -0.2))),
      ...Array.from({ length: 100 }, (_, i) => sample("MID", 9, 9 + (i % 2 ? 7 : -7))),
    ]);
    const lowRatio = estimateVariance("MID", 1, table) / 1;
    const highRatio = estimateVariance("MID", 9, table) / 9;
    expect(Math.abs(highRatio - lowRatio)).toBeGreaterThan(0.01);
  });
});

describe("estimateVariance", () => {
  it("is always strictly positive so the Monte Carlo never degenerates", () => {
    const table = fitVariance([sample("MID", 0, 0)]);
    expect(estimateVariance("MID", 0, table)).toBeGreaterThan(0);
  });

  it("falls back to the committed table when none is supplied", () => {
    expect(estimateVariance("MID", 5)).toBeGreaterThan(0);
  });

  it("never returns NaN for an out-of-range xPoints", () => {
    expect(Number.isNaN(estimateVariance("MID", 999))).toBe(false);
    expect(Number.isNaN(estimateVariance("MID", -5))).toBe(false);
  });
});

describe("fitVariance", () => {
  it("returns a bucket edge list and a per-position array of equal length", () => {
    const table = fitVariance([sample("MID", 2, 3), sample("DEF", 4, 4)]);
    expect(table.byPosition.MID).toHaveLength(table.buckets.length);
    expect(table.byPosition.DEF).toHaveLength(table.buckets.length);
  });

  it("handles an empty sample without producing NaN", () => {
    const table = fitVariance([]);
    expect(Number.isNaN(estimateVariance("MID", 3, table))).toBe(false);
  });
});

describe("regression: thin evidence must widen, not collapse to the floor", () => {
  const POSITIONS: Position[] = ["GKP", "DEF", "MID", "FWD"];

  it("does not let an empty high bucket return a smaller variance than a populated lower bucket", () => {
    // DEF has plenty of samples with real spread at xPoints=7, and zero
    // samples at xPoints=11 (a double-gameweek-sized projection).
    const table = fitVariance(
      Array.from({ length: 42 }, (_, i) => sample("DEF", 7, 7 + (i % 2 ? 4.29 : -4.29))),
    );
    expect(estimateVariance("DEF", 11, table)).toBeGreaterThanOrEqual(
      estimateVariance("DEF", 7, table),
    );
  });

  it("is monotonic non-decreasing across buckets for every position", () => {
    const table = fitVariance([
      ...Array.from({ length: 30 }, (_, i) => sample("MID", 2, 2 + (i % 2 ? 1 : -1))),
      ...Array.from({ length: 30 }, (_, i) => sample("MID", 9, 9 + (i % 2 ? 6 : -6))),
      ...Array.from({ length: 25 }, (_, i) => sample("FWD", 3, 3 + (i % 2 ? 3 : -3))),
      sample("FWD", 9, 30), // single outlier residual in an otherwise-thin bucket
    ]);
    for (const position of POSITIONS) {
      const row = table.byPosition[position];
      for (let i = 1; i < row.length; i++) {
        expect(row[i]).toBeGreaterThanOrEqual(row[i - 1]);
      }
    }
  });

  it("does not let a single-sample bucket produce a value below its lower neighbour", () => {
    const table = fitVariance([
      ...Array.from({ length: 25 }, (_, i) => sample("FWD", 3, 3 + (i % 2 ? 3 : -3))),
      sample("FWD", 9, 30), // one huge squared residual, n=1 for its bucket
    ]);
    const lowerBucketVariance = estimateVariance("FWD", 3, table);
    const singleSampleBucketVariance = estimateVariance("FWD", 9, table);
    expect(singleSampleBucketVariance).toBeGreaterThanOrEqual(lowerBucketVariance);
  });
});
