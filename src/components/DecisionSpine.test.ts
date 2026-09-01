import { describe, expect, it } from "vitest";

import { formatDelta, verdictTone } from "@/components/DecisionSpine";
import type { Action } from "@/lib/decision/types";

const action = (mean: number, lower80: number, upper80: number, hitCost = 0): Action => ({
  kind: "transfer",
  headline: "Bring in Semenyo",
  detail: "",
  hitCost,
  evidence: [],
  overtakeDelta: { mean, lower80, upper80, perRival: [] },
});

describe("verdictTone", () => {
  it("is green when an action is recommended", () => {
    expect(verdictTone("recommend")).toBe("green");
  });

  it("is amber when nothing clears the bar", () => {
    expect(verdictTone("too-close")).toBe("amber");
  });

  it("is muted once locked", () => {
    expect(verdictTone("locked")).toBe("muted");
  });

  it("is muted when unavailable", () => {
    expect(verdictTone("unavailable")).toBe("muted");
  });
});

describe("formatDelta", () => {
  it("renders a positive delta as a signed percentage", () => {
    expect(formatDelta(action(0.042, 0.01, 0.07))).toContain("+4.2%");
  });

  it("renders a negative delta with a minus sign", () => {
    expect(formatDelta(action(-0.031, -0.06, -0.01))).toContain("-3.1%");
  });

  it("includes the 80% interval", () => {
    expect(formatDelta(action(0.042, 0.01, 0.07))).toContain("1.0%");
    expect(formatDelta(action(0.042, 0.01, 0.07))).toContain("7.0%");
  });

  it("names the hit when one applies", () => {
    expect(formatDelta(action(0.05, 0.02, 0.08, -4))).toContain("-4");
  });

  it("says nothing about a hit when there is none", () => {
    expect(formatDelta(action(0.05, 0.02, 0.08, 0))).not.toContain("-4");
  });
});
