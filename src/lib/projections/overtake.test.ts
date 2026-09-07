import { describe, expect, it } from "vitest";

import type { ManagerSquad, RivalContext, SquadProjection } from "@/lib/types";
import { computeOvertakeOdds } from "@/lib/projections/overtake";
import { mulberry32 } from "@/lib/decision/rng";

// For use in it() blocks
function squadManager(id: number, total: number, rank: number): ManagerSquad {
  return {
    entry: { id, name: `Team ${id}`, player_name: "Manager", total, rank },
    gw: 10,
    picks: [],
    starters: [],
    bench: [],
    captain: undefined,
    viceCaptain: undefined,
    activeChip: null,
  };
}

function projection(entryId: number, startingXIPoints: number, stdev: number): SquadProjection {
  return { entryId, startingXIPoints, benchPoints: 0, totalExpected: startingXIPoints, stdev, perPlayer: [] };
}

// Module-scope fixtures for determinism tests
const managerSquad = (id: number, name: string, total: number, rank: number): ManagerSquad => ({
  entry: { id, name, player_name: name, total, rank },
  gw: 10,
  picks: [],
  starters: [],
  bench: [],
  captain: undefined,
  viceCaptain: undefined,
  activeChip: null,
});

const squad = (entryId: number, points: number, stdev: number): SquadProjection => ({
  entryId,
  startingXIPoints: points,
  benchPoints: 4,
  totalExpected: points + 0.4,
  stdev,
  perPlayer: [],
});

const ctx: RivalContext = {
  user: managerSquad(1, "Me", 100, 5),
  rivals: [managerSquad(2, "Rival", 105, 4)],
  leagueName: "Test",
};
const userProj: SquadProjection = squad(1, 50, 10);
const rivalProjs: SquadProjection[] = [squad(2, 48, 10)];

describe("computeOvertakeOdds", () => {
  it("reports high overtake probability when far ahead in projected xP and already ahead in the table", () => {
    const ctx: RivalContext = {
      user: squadManager(1, 100, 1),
      rivals: [squadManager(2, 50, 2)], // rival is behind in the table
      leagueName: "Test League",
    };
    const userProj = projection(1, 80, 1);
    const rivalProj = projection(2, 20, 1);

    const [odds] = computeOvertakeOdds(ctx, userProj, [rivalProj], 500);

    expect(odds.rivalEntryId).toBe(2);
    expect(odds.pointsBehind).toBe(0); // user is already ahead
    expect(odds.expectedDelta).toBeCloseTo(60, 5);
    expect(odds.overtakeProbability).toBeGreaterThan(0.9);
  });

  it("reports low overtake probability when far behind in projected xP and in the table", () => {
    const ctx: RivalContext = {
      user: squadManager(1, 10, 5),
      rivals: [squadManager(2, 100, 1)], // rival is far ahead in the table
      leagueName: "Test League",
    };
    const userProj = projection(1, 20, 1);
    const rivalProj = projection(2, 80, 1);

    const [odds] = computeOvertakeOdds(ctx, userProj, [rivalProj], 500);

    expect(odds.pointsBehind).toBe(90);
    expect(odds.overtakeProbability).toBeLessThan(0.1);
  });

  it("skips a rival with no matching projection", () => {
    const ctx: RivalContext = {
      user: squadManager(1, 10, 1),
      rivals: [squadManager(2, 5, 2), squadManager(3, 3, 3)],
      leagueName: "Test League",
    };
    const userProj = projection(1, 50, 5);
    // Only one projection supplied for two rivals — the second is skipped.
    const odds = computeOvertakeOdds(ctx, userProj, [projection(2, 40, 5)], 100);

    expect(odds).toHaveLength(1);
    expect(odds[0].rivalEntryId).toBe(2);
  });

  it("floors stdev at 1 so a zero-variance projection still produces a probability", () => {
    const ctx: RivalContext = {
      user: squadManager(1, 0, 1),
      rivals: [squadManager(2, 0, 2)],
      leagueName: "Test League",
    };
    const odds = computeOvertakeOdds(ctx, projection(1, 50, 0), [projection(2, 50, 0)], 200);
    expect(odds[0].overtakeProbability).toBeGreaterThanOrEqual(0);
    expect(odds[0].overtakeProbability).toBeLessThanOrEqual(1);
  });
});

describe("determinism", () => {
  it("returns identical odds for the same seed", () => {
    const a = computeOvertakeOdds(ctx, userProj, rivalProjs, 2000, mulberry32(1));
    const b = computeOvertakeOdds(ctx, userProj, rivalProjs, 2000, mulberry32(1));
    expect(a).toEqual(b);
  });

  it("returns different odds for a different seed", () => {
    const a = computeOvertakeOdds(ctx, userProj, rivalProjs, 2000, mulberry32(1));
    const b = computeOvertakeOdds(ctx, userProj, rivalProjs, 2000, mulberry32(2));
    expect(a[0].overtakeProbability).not.toBe(b[0].overtakeProbability);
  });

  it("still works without an explicit rng", () => {
    const odds = computeOvertakeOdds(ctx, userProj, rivalProjs, 100);
    expect(odds).toHaveLength(rivalProjs.length);
    expect(odds[0].overtakeProbability).toBeGreaterThanOrEqual(0);
    expect(odds[0].overtakeProbability).toBeLessThanOrEqual(1);
  });
});
