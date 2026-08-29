import { describe, expect, it } from "vitest";

import type { ManagerSquad, RivalContext, SquadProjection } from "@/lib/types";
import { computeOvertakeOdds } from "@/lib/projections/overtake";

function squad(id: number, total: number, rank: number): ManagerSquad {
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

describe("computeOvertakeOdds", () => {
  it("reports high overtake probability when far ahead in projected xP and already ahead in the table", () => {
    const ctx: RivalContext = {
      user: squad(1, 100, 1),
      rivals: [squad(2, 50, 2)], // rival is behind in the table
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
      user: squad(1, 10, 5),
      rivals: [squad(2, 100, 1)], // rival is far ahead in the table
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
      user: squad(1, 10, 1),
      rivals: [squad(2, 5, 2), squad(3, 3, 3)],
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
      user: squad(1, 0, 1),
      rivals: [squad(2, 0, 2)],
      leagueName: "Test League",
    };
    const odds = computeOvertakeOdds(ctx, projection(1, 50, 0), [projection(2, 50, 0)], 200);
    expect(odds[0].overtakeProbability).toBeGreaterThanOrEqual(0);
    expect(odds[0].overtakeProbability).toBeLessThanOrEqual(1);
  });
});
