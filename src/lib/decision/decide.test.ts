import { describe, expect, it } from "vitest";

import { decide } from "@/lib/decision/decide";
import type { ManagerSquad, SquadProjection, SquadSlot } from "@/lib/types";
import type { TransferOption } from "@/lib/optimizer/transfer-options";

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
    picks: [slot(10, "Cap", 2), slot(11, "Alt", 1)],
    starters: [slot(10, "Cap", 2), slot(11, "Alt", 1)],
    bench: [],
    captain: slot(10, "Cap", 2),
    viceCaptain: slot(11, "Alt", 1),
    activeChip: null,
  }) as unknown as ManagerSquad;

const projection = (points = 50): SquadProjection => ({
  entryId: 1,
  startingXIPoints: points,
  benchPoints: 4,
  totalExpected: points + 0.4,
  stdev: 12,
  perPlayer: [
    { playerId: 10, webName: "Cap", position: "MID", xPoints: 9, variance: 9, injuryRisk: 0, fixtureDifficulty: 3, notes: [] },
    { playerId: 11, webName: "Alt", position: "MID", xPoints: 5, variance: 9, injuryRisk: 0, fixtureDifficulty: 3, notes: [] },
  ],
});

const rival = (points = 50, behind = 0) => ({
  entryId: 2,
  name: "Rival",
  projection: { ...projection(points), entryId: 2 },
  pointsBehind: behind,
});

const bigOption = (): TransferOption =>
  ({
    id: "OPT-01", category: "best-xp",
    outPlayerId: 11, outWebName: "Alt", outTeamShort: "AAA", outCost: 50, outXp: 4, outPosition: "MID",
    inPlayerId: 20, inWebName: "Newman", inTeamShort: "BBB", inCost: 55, inXp: 30,
    netGainXi: 26, postBank: 5, overtakeImpact: [], overtakeSum: 0.4, notes: [],
  }) as TransferOption;

const base = {
  squad: squad(),
  userProjection: projection(),
  rivals: [rival()],
  transferOptions: [],
  freeTransfers: 1,
  deadline: { gw: 3, iso: "2026-09-04T17:30:00Z" },
  now: Date.parse("2026-09-01T00:00:00Z"),
  minHistoryMet: true,
};

describe("decide", () => {
  it("recommends a transfer with an overwhelming edge", () => {
    const d = decide({ ...base, transferOptions: [bigOption()] });
    expect(d.gateStatus).toBe("recommend");
    expect(d.verdict.kind).toBe("transfer");
    expect(d.verdict.headline).toContain("Newman");
  });

  it("rolls when the only option is marginal", () => {
    const tiny = { ...bigOption(), netGainXi: 0.05, inWebName: "Marginal" } as TransferOption;
    const d = decide({ ...base, transferOptions: [tiny] });
    expect(d.gateStatus).toBe("too-close");
    expect(d.verdict.kind).toBe("roll");
  });

  it("always offers roll as a candidate, even with no options at all", () => {
    const d = decide(base);
    expect(d.verdict.kind).toBe("roll");
    expect(d.gateStatus).toBe("too-close");
  });

  it("is deterministic across repeated calls", () => {
    const args = { ...base, transferOptions: [bigOption()] };
    expect(decide(args)).toEqual(decide(args));
  });

  it("reports locked once the deadline has passed", () => {
    const d = decide({ ...base, now: Date.parse("2026-09-05T00:00:00Z"), transferOptions: [bigOption()] });
    expect(d.gateStatus).toBe("locked");
    expect(d.note).toBeTruthy();
  });

  it("reports unavailable when the model lacks history", () => {
    const d = decide({ ...base, minHistoryMet: false, transferOptions: [bigOption()] });
    expect(d.gateStatus).toBe("unavailable");
    expect(d.note).toContain("history");
  });

  it("falls back to overall rank when there are no rivals", () => {
    const d = decide({ ...base, rivals: [], transferOptions: [bigOption()] });
    expect(d.gateStatus).not.toBe("unavailable");
    expect(d.verdict).toBeTruthy();
  });

  it("computes hours remaining to the deadline", () => {
    const d = decide(base);
    expect(d.deadline.hoursRemaining).toBeCloseTo(89.5, 0);
    expect(d.deadline.gw).toBe(3);
  });

  it("considers captain changes alongside transfers", () => {
    const d = decide({ ...base, transferOptions: [] });
    const headlines = [d.verdict, ...d.alternatives].map((a) => a.headline);
    expect(headlines.some((h) => h.includes("Captain Alt"))).toBe(true);
  });
});
