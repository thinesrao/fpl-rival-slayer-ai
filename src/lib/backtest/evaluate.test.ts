import { describe, expect, it } from "vitest";

import { calibrationBuckets, evaluate, intervalCoverage, spearman } from "@/lib/backtest/evaluate";

describe("spearman", () => {
  it("is 1 for a perfectly monotonic increasing relationship", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
  });

  it("is -1 for a perfectly monotonic decreasing relationship", () => {
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 10);
  });

  it("handles ties by averaging ranks", () => {
    expect(spearman([1, 1, 2, 2], [1, 1, 2, 2])).toBeCloseTo(1, 10);
  });

  it("returns null when one side has zero variance", () => {
    expect(spearman([0, 0, 0, 0], [1, 2, 3, 4])).toBeNull();
  });
});

describe("evaluate degeneracy guards", () => {
  it("refuses a constant predictor rather than returning NaN", () => {
    // This is the exact shape that produced NaN during design: an xP column of all zeros.
    const r = evaluate([0, 0, 0, 0], [1, 5, 2, 8]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/constant|variance/i);
  });

  it("refuses constant actuals", () => {
    const r = evaluate([1, 2, 3, 4], [3, 3, 3, 3]);
    expect(r.ok).toBe(false);
  });

  it("refuses an empty set", () => {
    const r = evaluate([], []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.n).toBe(0);
  });

  it("throws when the arrays have different lengths", () => {
    expect(() => evaluate([1, 2], [1])).toThrow();
  });

  it("never returns a NaN metric on a successful result", () => {
    const r = evaluate([1, 2, 3, 4], [1, 3, 2, 5]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Number.isNaN(r.rmse)).toBe(false);
      expect(Number.isNaN(r.mae)).toBe(false);
      expect(Number.isNaN(r.spearman)).toBe(false);
    }
  });
});

describe("evaluate metrics", () => {
  it("computes RMSE correctly", () => {
    const r = evaluate([1, 2, 3], [2, 4, 6]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rmse).toBeCloseTo(Math.sqrt((1 + 4 + 9) / 3), 10);
  });

  it("computes MAE correctly", () => {
    const r = evaluate([1, 2, 3], [2, 4, 6]);
    if (r.ok) expect(r.mae).toBeCloseTo((1 + 2 + 3) / 3, 10);
  });

  it("reports n", () => {
    const r = evaluate([1, 2, 3], [2, 4, 6]);
    if (r.ok) expect(r.n).toBe(3);
  });
});

describe("calibrationBuckets", () => {
  it("returns the requested number of populated buckets", () => {
    const preds = Array.from({ length: 100 }, (_, i) => i / 10);
    const acts = preds.map((p) => p + 1);
    expect(calibrationBuckets(preds, acts, 5)).toHaveLength(5);
  });

  it("reports mean predicted and mean actual per bucket", () => {
    const preds = [0, 0, 10, 10];
    const acts = [1, 1, 20, 20];
    const buckets = calibrationBuckets(preds, acts, 2);
    expect(buckets[0].meanPredicted).toBeCloseTo(0, 10);
    expect(buckets[0].meanActual).toBeCloseTo(1, 10);
    expect(buckets[buckets.length - 1].meanActual).toBeCloseTo(20, 10);
  });

  it("returns an empty array for empty input", () => {
    expect(calibrationBuckets([], [], 5)).toEqual([]);
  });
});

describe("intervalCoverage", () => {
  it("reports 1 when every actual falls inside its interval", () => {
    expect(intervalCoverage([5, 5, 5], [2, 2, 2], [5, 4, 6], 1.2816)).toBeCloseTo(1, 10);
  });

  it("reports 0 when every actual falls outside", () => {
    expect(intervalCoverage([5, 5], [0.1, 0.1], [50, -50], 1.2816)).toBeCloseTo(0, 10);
  });

  it("treats a zero stdev as a point interval", () => {
    expect(intervalCoverage([5], [0], [5], 1.2816)).toBeCloseTo(1, 10);
  });
});
