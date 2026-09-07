import { describe, expect, it } from "vitest";

import { clearsBar, pickVerdict } from "@/lib/decision/rule";
import type { Action } from "@/lib/decision/types";

const action = (over: Partial<Action> & { mean: number; lower80: number; upper80: number }): Action => ({
  kind: over.kind ?? "transfer",
  headline: over.headline ?? "Do a thing",
  detail: over.detail ?? "",
  hitCost: over.hitCost ?? 0,
  evidence: over.evidence ?? [],
  overtakeDelta: {
    mean: over.mean,
    lower80: over.lower80,
    upper80: over.upper80,
    perRival: [],
  },
});

const roll = action({ kind: "roll", headline: "Roll your transfer", mean: 0, lower80: 0, upper80: 0 });

describe("clearsBar", () => {
  it("clears when the whole 80% interval is above zero", () => {
    expect(clearsBar(action({ mean: 0.05, lower80: 0.01, upper80: 0.09 }))).toBe(true);
  });

  it("does not clear when the interval straddles zero", () => {
    expect(clearsBar(action({ mean: 0.05, lower80: -0.02, upper80: 0.12 }))).toBe(false);
  });

  it("does not clear when the interval is entirely below zero", () => {
    expect(clearsBar(action({ mean: -0.04, lower80: -0.09, upper80: -0.01 }))).toBe(false);
  });

  it("does not clear when the lower bound sits exactly on zero", () => {
    // A boundary that touches zero has not demonstrated an edge.
    expect(clearsBar(action({ mean: 0.03, lower80: 0, upper80: 0.06 }))).toBe(false);
  });

  it("never clears for the roll action, whose delta is zero by definition", () => {
    expect(clearsBar(roll)).toBe(false);
  });
});

describe("pickVerdict", () => {
  it("recommends the best clearing candidate", () => {
    const weak = action({ headline: "Weak", mean: 0.02, lower80: 0.005, upper80: 0.03 });
    const strong = action({ headline: "Strong", mean: 0.08, lower80: 0.04, upper80: 0.12 });
    const out = pickVerdict(roll, [weak, strong]);
    expect(out.verdict.headline).toBe("Strong");
    expect(out.gateStatus).toBe("recommend");
  });

  it("rolls when nothing clears the bar", () => {
    const noisy = action({ headline: "Noisy", mean: 0.06, lower80: -0.01, upper80: 0.13 });
    const out = pickVerdict(roll, [noisy]);
    expect(out.verdict.kind).toBe("roll");
    expect(out.gateStatus).toBe("too-close");
  });

  it("rolls when there are no candidates at all", () => {
    const out = pickVerdict(roll, []);
    expect(out.verdict.kind).toBe("roll");
    expect(out.gateStatus).toBe("too-close");
  });

  it("ranks alternatives by mean delta, best first, excluding the verdict", () => {
    const a = action({ headline: "A", mean: 0.09, lower80: 0.05, upper80: 0.13 });
    const b = action({ headline: "B", mean: 0.04, lower80: 0.01, upper80: 0.07 });
    const c = action({ headline: "C", mean: 0.06, lower80: -0.02, upper80: 0.14 });
    const out = pickVerdict(roll, [b, c, a]);
    expect(out.verdict.headline).toBe("A");
    expect(out.alternatives.map((x) => x.headline)).toEqual(["C", "B", "Roll your transfer"]);
  });

  it("keeps the closest candidate visible when it rolls, so the user can overrule", () => {
    const near = action({ headline: "Near miss", mean: 0.05, lower80: -0.001, upper80: 0.1 });
    const out = pickVerdict(roll, [near]);
    expect(out.verdict.kind).toBe("roll");
    expect(out.alternatives[0].headline).toBe("Near miss");
  });

  it("prefers a smaller confident edge over a larger uncertain one", () => {
    const straddle = action({ headline: "Big but noisy", mean: 0.09, lower80: -0.01, upper80: 0.19 });
    const modest = action({ headline: "Small but sure", mean: 0.03, lower80: 0.01, upper80: 0.05 });
    const out = pickVerdict(roll, [straddle, modest]);
    expect(out.verdict.headline).toBe("Small but sure");
    expect(out.gateStatus).toBe("recommend");
    // The larger mean still ranks first among alternatives — it lost on confidence.
    expect(out.alternatives[0].headline).toBe("Big but noisy");
  });
});
