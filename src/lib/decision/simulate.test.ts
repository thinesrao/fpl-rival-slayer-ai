import { describe, expect, it } from "vitest";

import { mulberry32, normalSampler } from "@/lib/decision/rng";
import { BATCHES, DRAWS_PER_BATCH, type RivalTarget, simulateDelta } from "@/lib/decision/simulate";
import type { SquadProjection } from "@/lib/types";

const squad = (points: number, stdev = 12): SquadProjection => ({
  entryId: 1,
  startingXIPoints: points,
  benchPoints: 4,
  totalExpected: points + 0.4,
  stdev,
  perPlayer: [],
});

const rival = (over: Partial<RivalTarget> = {}): RivalTarget => ({
  entryId: 2,
  name: "Rival",
  expected: 50,
  stdev: 12,
  pointsBehind: 0,
  ...over,
});

describe("simulateDelta", () => {
  it("reports a positive mean delta when the variant scores more", () => {
    const d = simulateDelta({ baseline: squad(50), variant: squad(56), rivals: [rival()], seed: 1 });
    expect(d.mean).toBeGreaterThan(0);
  });

  it("reports a negative mean delta when the variant scores less", () => {
    const d = simulateDelta({ baseline: squad(50), variant: squad(44), rivals: [rival()], seed: 1 });
    expect(d.mean).toBeLessThan(0);
  });

  it("reports a delta of exactly zero when the scenarios are identical", () => {
    const d = simulateDelta({ baseline: squad(50), variant: squad(50), rivals: [rival()], seed: 1 });
    expect(d.mean).toBe(0);
    expect(d.lower80).toBe(0);
    expect(d.upper80).toBe(0);
  });

  it("brackets the mean with its 80% interval", () => {
    const d = simulateDelta({ baseline: squad(50), variant: squad(53), rivals: [rival()], seed: 3 });
    expect(d.lower80).toBeLessThanOrEqual(d.mean);
    expect(d.upper80).toBeGreaterThanOrEqual(d.mean);
  });

  it("is deterministic for a given seed", () => {
    const args = { baseline: squad(50), variant: squad(53), rivals: [rival()], seed: 11 };
    expect(simulateDelta(args)).toEqual(simulateDelta(args));
  });

  it("differs for a different seed", () => {
    const base = { baseline: squad(50), variant: squad(53), rivals: [rival()] };
    expect(simulateDelta({ ...base, seed: 1 }).mean).not.toBe(simulateDelta({ ...base, seed: 2 }).mean);
  });

  it("reports before and after probabilities per rival", () => {
    const d = simulateDelta({
      baseline: squad(50),
      variant: squad(56),
      rivals: [rival({ entryId: 2, name: "A" }), rival({ entryId: 3, name: "B", expected: 60 })],
      seed: 5,
    });
    expect(d.perRival).toHaveLength(2);
    expect(d.perRival[0].rivalName).toBe("A");
    expect(d.perRival[0].after).toBeGreaterThan(d.perRival[0].before);
    for (const r of d.perRival) {
      expect(r.before).toBeGreaterThanOrEqual(0);
      expect(r.before).toBeLessThanOrEqual(1);
      expect(r.after).toBeGreaterThanOrEqual(0);
      expect(r.after).toBeLessThanOrEqual(1);
    }
  });

  it("requires a bigger score gap to overtake a rival further ahead", () => {
    const near = simulateDelta({
      baseline: squad(50), variant: squad(56), rivals: [rival({ pointsBehind: 1 })], seed: 7,
    });
    const far = simulateDelta({
      baseline: squad(50), variant: squad(56), rivals: [rival({ pointsBehind: 40 })], seed: 7,
    });
    expect(near.perRival[0].after).toBeGreaterThan(far.perRival[0].after);
  });

  it("sums the delta across rivals", () => {
    const one = simulateDelta({ baseline: squad(50), variant: squad(56), rivals: [rival()], seed: 5 });
    const two = simulateDelta({
      baseline: squad(50), variant: squad(56),
      rivals: [rival({ entryId: 2 }), rival({ entryId: 3 })], seed: 5,
    });
    // Each rival draws from its own stream, so two rivals with the same
    // distribution contribute independently — the sum is close to double, not
    // exactly double. Exact doubling would mean the rivals were perfectly
    // correlated, which is what the per-rival streams deliberately avoid.
    expect(two.mean).toBeCloseTo(one.mean * 2, 2);
  });

  it("draws each rival independently rather than in lockstep", () => {
    // Two rivals with identical distributions must not produce identical
    // sampled outcomes; if they did, their streams would be shared.
    const d = simulateDelta({
      baseline: squad(50), variant: squad(56),
      rivals: [rival({ entryId: 2, name: "A" }), rival({ entryId: 3, name: "B" })],
      seed: 5,
    });
    expect(d.perRival[0].before).not.toBe(d.perRival[1].before);
  });

  it("has a smaller delta interval than independent sampling would", () => {
    const baseline = squad(50);
    const variant = squad(52);
    const rivals = [rival()];

    const paired = simulateDelta({ baseline, variant, rivals, seed: 21 });
    const pairedWidth = paired.upper80 - paired.lower80;

    // Independent equivalent: draw each scenario from its OWN stream, so the two
    // probability estimates are independently noisy — exactly what the pairing
    // in simulateDelta is designed to avoid.
    const widthOf = (xs: number[]): number => {
      const s = [...xs].sort((a, b) => a - b);
      const at = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
      return at(0.9) - at(0.1);
    };

    const batchDeltas: number[] = [];
    for (let b = 0; b < BATCHES; b++) {
      const sBase = normalSampler(mulberry32(21 + b));
      const sVar = normalSampler(mulberry32(9000 + b));
      let before = 0;
      let after = 0;
      for (let i = 0; i < DRAWS_PER_BATCH; i++) {
        if (sBase(baseline.startingXIPoints, baseline.stdev) - sBase(rivals[0].expected, rivals[0].stdev) > 0) before++;
        if (sVar(variant.startingXIPoints, variant.stdev) - sVar(rivals[0].expected, rivals[0].stdev) > 0) after++;
      }
      batchDeltas.push((after - before) / DRAWS_PER_BATCH);
    }

    expect(pairedWidth).toBeLessThan(widthOf(batchDeltas));
  });
});
