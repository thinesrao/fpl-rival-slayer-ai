import { describe, expect, it } from "vitest";
import { buildDraftSeed, type SeedPick } from "./seed";

// A full 15: FPL numbers slots 1..11 for the XI and 12..15 for the bench in
// autosub order, and the XI is always GK-first.
const SQUAD: Array<{ id: number; etype: number; slot: number }> = [
  { id: 101, etype: 1, slot: 1 }, // GK starter
  { id: 201, etype: 2, slot: 2 },
  { id: 202, etype: 2, slot: 3 },
  { id: 203, etype: 2, slot: 4 },
  { id: 301, etype: 3, slot: 5 },
  { id: 302, etype: 3, slot: 6 },
  { id: 303, etype: 3, slot: 7 },
  { id: 304, etype: 3, slot: 8 },
  { id: 401, etype: 4, slot: 9 },
  { id: 402, etype: 4, slot: 10 },
  { id: 403, etype: 4, slot: 11 },
  { id: 305, etype: 3, slot: 12 }, // bench 1
  { id: 204, etype: 2, slot: 13 }, // bench 2
  { id: 205, etype: 2, slot: 14 }, // bench 3
  { id: 102, etype: 1, slot: 15 }, // bench GK
];

function picks(overrides: Partial<Record<number, Partial<SeedPick>>> = {}): SeedPick[] {
  return SQUAD.map((p) => ({
    elementId: p.id,
    position: p.slot,
    isCaptain: false,
    isVice: false,
    value: 50,
    ...(overrides[p.id] ?? {}),
  }));
}

const elementTypeById = new Map(SQUAD.map((p) => [p.id, p.etype]));
const webNameById = new Map(SQUAD.map((p) => [p.id, `P${p.id}`]));

function build(ps: SeedPick[] = picks(), bank = 15) {
  return buildDraftSeed({
    gw: 4,
    bank,
    picks: ps,
    elementTypeById,
    webNameById,
    activeChip: "wildcard",
    source: "pending",
  });
}

describe("buildDraftSeed", () => {
  it("orders picks into the draft's slot contract: GK, DEF, MID, FWD", () => {
    const seed = build();
    expect(seed.picks).toEqual([
      101, 102, // GKP
      201, 202, 203, 204, 205, // DEF
      301, 302, 303, 304, 305, // MID
      401, 402, 403, // FWD
    ]);
  });

  it("keeps the manager's own bench rather than re-deriving one", () => {
    const seed = build();
    expect(seed.startingXI).toEqual([101, 201, 202, 203, 301, 302, 303, 304, 401, 402, 403]);
    const benched = seed.picks.filter((id) => id != null && !seed.startingXI.includes(id));
    expect(benched).toEqual([102, 204, 205, 305]);
  });

  it("reads the formation off the starting XI", () => {
    expect(build().formation).toBe("3-4-3");
  });

  it("derives the cap from bank plus the value of all 15", () => {
    const seed = build(picks(), 15);
    expect(seed.squadValue).toBe(15 * 50);
    expect(seed.bank).toBe(15);
    expect(seed.budget).toBe(765);
  });

  it("carries captain, vice, chip and source through", () => {
    const seed = build(picks({ 401: { isCaptain: true }, 301: { isVice: true } }));
    expect(seed.captainId).toBe(401);
    expect(seed.viceId).toBe(301);
    expect(seed.activeChip).toBe("wildcard");
    expect(seed.source).toBe("pending");
  });

  it("marks starters in the summary", () => {
    const seed = build();
    const byId = new Map(seed.summary.map((p) => [p.id, p]));
    expect(byId.get(101)).toEqual({ id: 101, webName: "P101", position: "GKP", isStarter: true });
    expect(byId.get(102)?.isStarter).toBe(false);
    expect(byId.get(305)?.position).toBe("MID");
  });

  it("pads to 15 slots when the squad comes back short", () => {
    const seed = build(picks().slice(0, 12));
    expect(seed.picks).toHaveLength(15);
    expect(seed.picks.filter((id) => id == null)).toHaveLength(3);
  });

  it("skips players missing from bootstrap instead of mis-slotting them", () => {
    const seed = build([
      ...picks(),
      { elementId: 999, position: 16, isCaptain: false, isVice: false, value: 40 },
    ]);
    expect(seed.picks).not.toContain(999);
    expect(seed.squadValue).toBe(750);
  });
});
