import { describe, expect, it } from "vitest";
import { validateDraft } from "./validate";
import type { PickerPlayer, Position, SquadDraft } from "./types";

// Prices chosen so the naive float sum drifts off the exact cap.
const PRICES: Array<[number, Position, number]> = [
  [101, "GKP", 5.5], [102, "GKP", 4.0],
  [201, "DEF", 6.0], [202, "DEF", 5.5], [203, "DEF", 4.5], [204, "DEF", 4.5], [205, "DEF", 4.0],
  [301, "MID", 14.5], [302, "MID", 8.5], [303, "MID", 7.0], [304, "MID", 5.5], [305, "MID", 4.5],
  [401, "FWD", 9.0], [402, "FWD", 7.5], [403, "FWD", 5.5],
];

const byId = new Map<number, PickerPlayer>(
  PRICES.map(([id, position, price]) => [
    id,
    {
      id,
      code: id,
      webName: `P${id}`,
      team: id === 301 ? "MCI" : `T${id}`,
      teamCode: 1,
      position,
      price,
      form: 0,
      totalPoints: 0,
      selectedByPct: 0,
      status: "a",
    },
  ]),
);

/** 5.5+4+6+5.5+4.5+4.5+4+14.5+8.5+7+5.5+4.5+9+7.5+5.5 = £96.0m */
const TOTAL_TENTHS = 960;

function draft(budget: number): SquadDraft {
  return {
    id: "d",
    name: "d",
    budget,
    picks: PRICES.map(([id]) => id),
    captainId: 301,
    viceId: 401,
    createdAt: "",
    updatedAt: "",
  };
}

describe("validateDraft budget", () => {
  it("counts a squad costing exactly its cap as in budget", () => {
    const v = validateDraft(draft(TOTAL_TENTHS), byId);
    expect(v.totalCost).toBe(96);
    expect(v.inBudget).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("leaves no float dust in the implied bank", () => {
    const v = validateDraft(draft(TOTAL_TENTHS), byId);
    expect(draft(TOTAL_TENTHS).budget / 10 - v.totalCost).toBe(0);
  });

  it("still flags a squad one tenth over the cap", () => {
    const v = validateDraft(draft(TOTAL_TENTHS - 1), byId);
    expect(v.inBudget).toBe(false);
    expect(v.errors.some((e) => e.startsWith("Over budget"))).toBe(true);
  });
});
