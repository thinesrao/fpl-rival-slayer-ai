import { describe, expect, it } from "vitest";
import { resolveStartingXI } from "./formation";
import type { PickerPlayer, Position, SquadDraft } from "./types";

// id → position, with totalPoints descending by id so the auto-pick order is
// predictable: within a position, the lowest id is the "best" player.
const SQUAD: Array<[number, Position]> = [
  [101, "GKP"], [102, "GKP"],
  [201, "DEF"], [202, "DEF"], [203, "DEF"], [204, "DEF"], [205, "DEF"],
  [301, "MID"], [302, "MID"], [303, "MID"], [304, "MID"], [305, "MID"],
  [401, "FWD"], [402, "FWD"], [403, "FWD"],
];

const byId = new Map<number, PickerPlayer>(
  SQUAD.map(([id, position]) => [
    id,
    {
      id,
      code: id,
      webName: `P${id}`,
      team: "TST",
      teamCode: 1,
      position,
      price: 5,
      form: 0,
      totalPoints: 1000 - id,
      selectedByPct: 0,
      status: "a",
    },
  ]),
);

function draft(overrides: Partial<SquadDraft> = {}): SquadDraft {
  return {
    id: "d",
    name: "d",
    budget: 1000,
    picks: SQUAD.map(([id]) => id),
    captainId: null,
    viceId: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

const XI = [101, 201, 202, 203, 301, 302, 303, 304, 401, 402, 403];

describe("resolveStartingXI", () => {
  it("keeps a stored XI that matches the formation", () => {
    const xi = resolveStartingXI(draft({ startingXI: XI }), byId, "3-4-3");
    expect(new Set(xi)).toEqual(new Set(XI));
  });

  it("keeps a stored XI even when it isn't the highest-scoring one", () => {
    // 205 is the worst defender by totalPoints, but the manager started them.
    const stored = [101, 205, 204, 203, 301, 302, 303, 304, 401, 402, 403];
    const xi = resolveStartingXI(draft({ startingXI: stored }), byId, "3-4-3");
    expect(new Set(xi)).toEqual(new Set(stored));
  });

  it("auto-picks when the draft has no stored XI", () => {
    const xi = resolveStartingXI(draft(), byId, "3-4-3");
    expect(new Set(xi)).toEqual(new Set(XI));
  });

  it("repairs the one slot a transfer emptied, leaving the rest alone", () => {
    // 203 (a starter) is transferred out for 206.
    const picks = SQUAD.map(([id]) => (id === 203 ? 206 : id));
    byId.set(206, { ...byId.get(205)!, id: 206, webName: "P206", totalPoints: 0 });
    const d = draft({ picks, startingXI: XI });
    const xi = resolveStartingXI(d, byId, "3-4-3");
    expect(xi).toHaveLength(11);
    expect(xi).not.toContain(203);
    // Everyone else who was starting still is; the gap goes to a bench DEF.
    for (const id of XI.filter((i) => i !== 203)) expect(xi).toContain(id);
    expect([204, 205, 206].filter((id) => xi.includes(id))).toHaveLength(1);
  });

  it("trims a stored XI down to a smaller formation's shape", () => {
    const xi = resolveStartingXI(draft({ startingXI: XI }), byId, "3-5-2");
    expect(xi).toHaveLength(11);
    const pos = (id: number) => byId.get(id)!.position;
    expect(xi.filter((id) => pos(id) === "DEF")).toHaveLength(3);
    expect(xi.filter((id) => pos(id) === "MID")).toHaveLength(5);
    expect(xi.filter((id) => pos(id) === "FWD")).toHaveLength(2);
  });

  it("drops stored ids that are no longer in the squad", () => {
    const xi = resolveStartingXI(draft({ startingXI: [...XI, 999] }), byId, "3-4-3");
    expect(xi).not.toContain(999);
    expect(xi).toHaveLength(11);
  });
});
