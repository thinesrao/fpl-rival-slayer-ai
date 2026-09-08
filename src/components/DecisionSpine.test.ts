import { describe, expect, it } from "vitest";

import { formatDelta, showsTrustBadge, spineState, verdictTone } from "@/components/DecisionSpine";
import type { Action } from "@/lib/decision/types";

const rival = (i: number) => ({
  rivalEntryId: i,
  rivalName: `Rival ${i}`,
  before: 0.4,
  after: 0.6,
});

const action = (
  mean: number,
  lower80: number,
  upper80: number,
  hitCost = 0,
  rivalCount = 0,
): Action => ({
  kind: "transfer",
  headline: "Swap Szoboszlai for Semenyo",
  detail: "",
  hitCost,
  evidence: [],
  overtakeDelta: {
    mean,
    lower80,
    upper80,
    perRival: Array.from({ length: rivalCount }, (_, i) => rival(i)),
  },
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
    expect(formatDelta(action(0.042, 0.01, 0.07))).toContain("+1.0%");
    expect(formatDelta(action(0.042, 0.01, 0.07))).toContain("+7.0%");
  });

  it("keeps the sign on a negative interval", () => {
    const s = formatDelta(action(-0.031, -0.06, -0.01));
    expect(s).toContain("-6.0%");
    expect(s).toContain("-1.0%");
  });

  it("shows that a straddling interval crosses zero", () => {
    const s = formatDelta(action(0.005, -0.01, 0.02));
    expect(s).toContain("-1.0%");
    expect(s).toContain("+2.0%");
  });

  it("names the hit when one applies", () => {
    expect(formatDelta(action(0.05, 0.02, 0.08, -4))).toContain("4-point hit");
  });

  it("says nothing about a hit when there is none", () => {
    expect(formatDelta(action(0.05, 0.02, 0.08, 0))).not.toContain("hit");
  });

  // overtakeDelta is summed across rivals, so rendering it raw as a single
  // percentage overstates the effect by a factor of the rival count.
  it("divides the summed delta by the rival count", () => {
    const s = formatDelta(action(0.6768, 0.642, 0.712, 0, 3));
    expect(s).toContain("+22.6%");
    expect(s).not.toContain("+67.7%");
  });

  it("divides the interval bounds by the same rival count", () => {
    const s = formatDelta(action(0.6768, 0.642, 0.712, 0, 3));
    expect(s).toContain("+21.4%");
    expect(s).toContain("+23.7%");
  });

  it("says the figure is per rival when rivals are tracked", () => {
    expect(formatDelta(action(0.6768, 0.642, 0.712, 0, 3))).toContain("per rival");
  });

  it("leaves the figure alone when there are no rivals to average over", () => {
    const s = formatDelta(action(0.042, 0.01, 0.07, 0, 0));
    expect(s).toContain("+4.2%");
    expect(s).not.toContain("per rival");
  });
});

describe("spineState", () => {
  it("returns loading when isLoading is true", () => {
    expect(spineState({ isLoading: true, isError: false, hasData: true })).toBe("loading");
  });

  it("returns error when isError is true", () => {
    expect(spineState({ isLoading: false, isError: true, hasData: true })).toBe("error");
  });

  it("returns error when hasData is false", () => {
    expect(spineState({ isLoading: false, isError: false, hasData: false })).toBe("error");
  });

  it("returns ready when not loading, no error, and has data", () => {
    expect(spineState({ isLoading: false, isError: false, hasData: true })).toBe("ready");
  });
});

describe("showsTrustBadge", () => {
  it("returns true when status is recommend", () => {
    expect(showsTrustBadge("recommend")).toBe(true);
  });

  it("returns true when status is too-close", () => {
    expect(showsTrustBadge("too-close")).toBe(true);
  });

  it("returns false when status is locked", () => {
    expect(showsTrustBadge("locked")).toBe(false);
  });

  it("returns false when status is unavailable", () => {
    expect(showsTrustBadge("unavailable")).toBe(false);
  });
});
