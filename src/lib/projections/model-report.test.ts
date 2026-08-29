import { describe, expect, it } from "vitest";

import { SHIP_GATE_BAR, evaluateShipGate } from "@/lib/projections/model-report";

describe("SHIP_GATE_BAR", () => {
  it("is FPL's own xP performance on 2025-26 starters", () => {
    expect(SHIP_GATE_BAR.rmse).toBeCloseTo(2.691, 3);
    expect(SHIP_GATE_BAR.spearman).toBeCloseTo(0.507, 3);
  });
});

describe("evaluateShipGate", () => {
  it("passes only when both RMSE and Spearman beat the bar", () => {
    expect(evaluateShipGate({ rmse: 2.5, spearman: 0.55 }).passes).toBe(true);
  });

  it("fails when RMSE is worse even if the ranking is better", () => {
    expect(evaluateShipGate({ rmse: 2.9, spearman: 0.60 }).passes).toBe(false);
  });

  it("fails when ranking is worse even if RMSE is better", () => {
    expect(evaluateShipGate({ rmse: 2.4, spearman: 0.40 }).passes).toBe(false);
  });

  it("fails on an exact tie, since a tie is not an improvement", () => {
    expect(evaluateShipGate({ rmse: 2.691, spearman: 0.507 }).passes).toBe(false);
  });

  it("reports the bars it applied so a reader can check the claim", () => {
    const g = evaluateShipGate({ rmse: 2.5, spearman: 0.55 });
    expect(g.rmseBar).toBeCloseTo(2.691, 3);
    expect(g.spearmanBar).toBeCloseTo(0.507, 3);
  });
});
