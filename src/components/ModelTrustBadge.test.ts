import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchModelReport, shouldShowModelTrustBadge } from "@/components/ModelTrustBadge";
import type { ModelReport } from "@/lib/projections/model-report";

function report(passes: boolean): ModelReport {
  return {
    generatedAt: "2026-08-27T00:00:00.000Z",
    season: "2025-26",
    rounds: [4, 5, 6, 8, 9, 24, 29, 38],
    starters: {
      model: { rmse: 3.4, mae: 2.5, spearman: 0.16, n: 1733 },
      fplXp: { rmse: 2.63, mae: 1.9, spearman: 0.53, n: 1721 },
    },
    shipGate: { passes, rmseBar: 2.691, spearmanBar: 0.507 },
    calibration: [],
  };
}

describe("shouldShowModelTrustBadge", () => {
  it("is false when the ship gate passes — nothing to disclose", () => {
    expect(shouldShowModelTrustBadge(report(true))).toBe(false);
  });

  it("is true when the ship gate fails — the model does not yet beat FPL's own xP", () => {
    expect(shouldShowModelTrustBadge(report(false))).toBe(true);
  });

  it("is false while the report hasn't loaded yet, so it never flashes a claim", () => {
    expect(shouldShowModelTrustBadge(undefined)).toBe(false);
  });
});

describe("fetchModelReport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed report on a 200 response", async () => {
    const body = report(false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => body }),
    );

    await expect(fetchModelReport()).resolves.toEqual(body);
  });

  it("throws with the status code when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
    );

    await expect(fetchModelReport()).rejects.toThrow(/503/);
  });
});
