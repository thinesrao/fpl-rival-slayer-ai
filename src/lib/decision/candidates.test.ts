import { describe, expect, it } from "vitest";

import { CAPTAIN_ALTERNATIVES, captainCandidates, transferCandidates } from "@/lib/decision/candidates";
import type { TransferOption } from "@/lib/optimizer/transfer-options";
import type { ManagerSquad, PlayerProjection, SquadProjection, SquadSlot } from "@/lib/types";

const proj = (playerId: number, webName: string, xPoints: number): PlayerProjection => ({
  playerId,
  webName,
  position: "MID",
  xPoints,
  variance: 9,
  injuryRisk: 0,
  fixtureDifficulty: 3,
  notes: [],
});

const slot = (id: number, name: string, multiplier: number): SquadSlot =>
  ({
    pick: { element: id, position: 1, multiplier, is_captain: multiplier === 2, is_vice_captain: false },
    player: { id, web_name: name },
    team: { id: 1, short_name: "AAA" },
    position: "MID",
  }) as unknown as SquadSlot;

const squad = (): ManagerSquad =>
  ({
    entry: { id: 1, name: "Me", player_name: "Me", total: 100, rank: 5 },
    gw: 3,
    picks: [slot(10, "Cap", 2), slot(11, "Alt", 1), slot(12, "Third", 1), slot(13, "Fourth", 1), slot(14, "Bench", 0)],
    starters: [slot(10, "Cap", 2), slot(11, "Alt", 1), slot(12, "Third", 1), slot(13, "Fourth", 1)],
    bench: [slot(14, "Bench", 0)],
    captain: slot(10, "Cap", 2),
    viceCaptain: slot(11, "Alt", 1),
    activeChip: null,
  }) as unknown as ManagerSquad;

const projection = (): SquadProjection => ({
  entryId: 1,
  startingXIPoints: 5 * 2 + 8 + 7 + 6, // Cap doubled, then Alt, Third, Fourth
  benchPoints: 2,
  totalExpected: 31.2,
  stdev: 12,
  perPlayer: [proj(10, "Cap", 5), proj(11, "Alt", 8), proj(12, "Third", 7), proj(13, "Fourth", 6), proj(14, "Bench", 2)],
});

const option = (over: Partial<TransferOption> = {}): TransferOption =>
  ({
    id: "OPT-01",
    category: "best-xp",
    outPlayerId: 13,
    outWebName: "Fourth",
    outTeamShort: "AAA",
    outCost: 50,
    outXp: 6,
    outPosition: "MID",
    inPlayerId: 20,
    inWebName: "Newman",
    inTeamShort: "BBB",
    inCost: 55,
    inXp: 9,
    netGainXi: 3,
    postBank: 5,
    overtakeImpact: [],
    overtakeSum: 0.04,
    notes: [],
    ...over,
  }) as TransferOption;

describe("captainCandidates", () => {
  it("returns exactly CAPTAIN_ALTERNATIVES candidates", () => {
    expect(captainCandidates(squad(), projection())).toHaveLength(CAPTAIN_ALTERNATIVES);
  });

  it("never proposes the current captain", () => {
    const headlines = captainCandidates(squad(), projection()).map((c) => c.headline);
    // Exact match, not a substring: "Captain Alt" legitimately contains "Cap",
    // and so would any real player named Capoue or Caprile.
    expect(headlines).not.toContain("Captain Cap");
    expect(headlines).toHaveLength(3);
  });

  it("orders alternatives by expected points, highest first", () => {
    const cs = captainCandidates(squad(), projection());
    expect(cs[0].headline).toContain("Alt");
  });

  it("raises the projected total by one copy of the difference, not two", () => {
    const base = projection();
    const cs = captainCandidates(squad(), base);
    // startingXIPoints already contains the captain's points doubled, so moving
    // the armband from Cap (5) to Alt (8) shifts the total by +3, not +6.
    expect(cs[0].variant.startingXIPoints).toBeCloseTo(base.startingXIPoints + 3, 5);
  });

  it("never charges a hit for a captain change", () => {
    for (const c of captainCandidates(squad(), projection())) expect(c.hitCost).toBe(0);
  });

  it("returns nothing when there is no captain set", () => {
    const s = squad();
    (s as { captain: SquadSlot | undefined }).captain = undefined;
    expect(captainCandidates(s, projection())).toEqual([]);
  });

  it("links to the squad tab as evidence", () => {
    expect(captainCandidates(squad(), projection())[0].evidence[0].tab).toBe("squad");
  });

  it("widens the spread when the new captain is more volatile", () => {
    const base = projection();
    const volatile = { ...base, perPlayer: base.perPlayer.map((p) => (p.playerId === 11 ? { ...p, variance: 36 } : p)) };
    const cs = captainCandidates(squad(), volatile);
    expect(cs[0].variant.stdev).toBeGreaterThan(base.stdev);
  });
});

describe("transferCandidates", () => {
  it("shifts the projected total by netGainXi", () => {
    const base = projection();
    const [c] = transferCandidates([option()], base, 1);
    expect(c.variant.startingXIPoints).toBeCloseTo(base.startingXIPoints + 3, 5);
  });

  it("charges no hit while free transfers remain", () => {
    const [c] = transferCandidates([option()], projection(), 1);
    expect(c.hitCost).toBe(0);
  });

  it("charges -4 when no free transfer remains, and deducts it from the variant", () => {
    const base = projection();
    const [c] = transferCandidates([option()], base, 0);
    expect(c.hitCost).toBe(-4);
    expect(c.variant.startingXIPoints).toBeCloseTo(base.startingXIPoints + 3 - 4, 5);
  });

  it("names both players in the headline", () => {
    const [c] = transferCandidates([option()], projection(), 1);
    expect(c.headline).toContain("Newman");
    expect(c.detail).toContain("Fourth");
  });

  it("links to the rival tab as evidence", () => {
    const [c] = transferCandidates([option()], projection(), 1);
    expect(c.evidence.some((e) => e.tab === "vs")).toBe(true);
  });

  it("returns nothing for an empty option list", () => {
    expect(transferCandidates([], projection(), 1)).toEqual([]);
  });
});
