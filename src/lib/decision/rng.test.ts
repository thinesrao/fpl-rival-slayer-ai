import { describe, expect, it } from "vitest";

import { hashSeed, mulberry32, normalSampler } from "@/lib/decision/rng";

describe("hashSeed", () => {
  it("is stable for the same parts", () => {
    expect(hashSeed(3, 4778037)).toBe(hashSeed(3, 4778037));
  });

  it("differs for different parts", () => {
    expect(hashSeed(3, 4778037)).not.toBe(hashSeed(4, 4778037));
    expect(hashSeed(3, 4778037)).not.toBe(hashSeed(3, 4778038));
  });

  it("returns a non-negative 32-bit integer", () => {
    const h = hashSeed("gw", 12, "entry", 999999);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});

describe("mulberry32", () => {
  it("produces the same sequence for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces a different sequence for a different seed", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("stays within [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("normalSampler", () => {
  it("recovers the mean and stdev to within sampling error", () => {
    const sample = normalSampler(mulberry32(42));
    const xs = Array.from({ length: 20000 }, () => sample(50, 10));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
    expect(mean).toBeCloseTo(50, 0);
    expect(Math.sqrt(variance)).toBeCloseTo(10, 0);
  });

  it("is deterministic for a given seed", () => {
    const a = normalSampler(mulberry32(9))(0, 1);
    const b = normalSampler(mulberry32(9))(0, 1);
    expect(a).toBe(b);
  });

  it("returns the mean exactly when stdev is zero", () => {
    expect(normalSampler(mulberry32(1))(7, 0)).toBe(7);
  });
});
