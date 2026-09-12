import { describe, expect, it } from "vitest";
import {
  HORIZON_DECAY,
  buildWildcardPool,
  fixtureFactor,
  horizonWeights,
  pruneCandidates,
  teamFixtureLoad,
} from "./wildcard-pool";
import type { WildcardCandidate } from "./wildcard-milp";
import type { FplBootstrap, FplElement, FplFixture, FplTeam } from "@/lib/types";

describe("horizonWeights", () => {
  it("starts at full value and decays geometrically", () => {
    const w = horizonWeights(4);
    expect(w[0]).toBe(1);
    expect(w[1]).toBeCloseTo(HORIZON_DECAY, 10);
    expect(w[3]).toBeCloseTo(HORIZON_DECAY ** 3, 10);
  });

  it("always yields at least one gameweek", () => {
    expect(horizonWeights(0)).toEqual([1]);
    expect(horizonWeights(-3)).toEqual([1]);
  });
});

function fixture(teamH: number, teamA: number, fdrH: number, fdrA: number): FplFixture {
  return {
    id: teamH * 100 + teamA,
    event: 1,
    finished: false,
    kickoff_time: null,
    team_h: teamH,
    team_a: teamA,
    team_h_difficulty: fdrH,
    team_a_difficulty: fdrA,
  } as FplFixture;
}

describe("teamFixtureLoad", () => {
  it("counts a single fixture for both sides with their own difficulty", () => {
    const load = teamFixtureLoad([fixture(1, 2, 2, 5)]);
    expect(load.get(1)).toEqual({ count: 1, avgFdr: 2 });
    expect(load.get(2)).toEqual({ count: 1, avgFdr: 5 });
  });

  it("averages difficulty across a double gameweek", () => {
    const load = teamFixtureLoad([fixture(1, 2, 2, 5), fixture(3, 1, 3, 4)]);
    expect(load.get(1)).toEqual({ count: 2, avgFdr: 3 });
  });

  it("omits teams with no fixture", () => {
    expect(teamFixtureLoad([fixture(1, 2, 3, 3)].slice()).has(9)).toBe(false);
  });
});

describe("fixtureFactor", () => {
  it("is zero on a blank gameweek", () => {
    expect(fixtureFactor(undefined)).toBe(0);
    expect(fixtureFactor({ count: 0, avgFdr: 3 })).toBe(0);
  });

  it("is one for a single fixture of average difficulty", () => {
    expect(fixtureFactor({ count: 1, avgFdr: 3 })).toBe(1);
  });

  it("rewards an easy fixture and penalises a hard one", () => {
    expect(fixtureFactor({ count: 1, avgFdr: 2 })).toBeGreaterThan(1);
    expect(fixtureFactor({ count: 1, avgFdr: 5 })).toBeLessThan(1);
  });

  it("roughly doubles for a double gameweek", () => {
    expect(fixtureFactor({ count: 2, avgFdr: 3 })).toBe(2);
  });

  it("never goes negative, however brutal the run", () => {
    expect(fixtureFactor({ count: 1, avgFdr: 99 })).toBe(0);
  });
});

function candidate(
  playerId: number,
  elementType: 1 | 2 | 3 | 4,
  cost: number,
  xp: number,
  teamId = 1,
): WildcardCandidate {
  return { playerId, teamId, elementType, cost, xp, captainXp: xp };
}

describe("pruneCandidates", () => {
  it("keeps a cheaper player who outscores a dearer one", () => {
    const pool = [
      candidate(1, 3, 100, 5),
      candidate(2, 3, 50, 8), // cheaper and better — always worth keeping
    ];
    const kept = pruneCandidates(pool, {
      topPerPosition: 1,
      topPerPositionPerTeam: 1,
      cheapestPerPosition: 0,
    });
    expect(kept.map((c) => c.playerId)).toContain(2);
  });

  it("drops a player beaten on points by a cheaper club-mate", () => {
    // All on one club, so the per-club rule can't rescue the dominated player
    // and only the cost/points frontier decides.
    const pool = [
      candidate(1, 3, 50, 8, 1),
      candidate(2, 3, 90, 3, 1), // dearer and worse than 1 — never optimal
      candidate(3, 3, 120, 9, 1),
    ];
    const kept = pruneCandidates(pool, {
      topPerPosition: 2,
      topPerPositionPerTeam: 2,
      cheapestPerPosition: 1,
    });
    expect(kept.map((c) => c.playerId)).not.toContain(2);
    expect(kept.map((c) => c.playerId).sort()).toEqual([1, 3]);
  });

  it("keeps the best few per club, since a squad may take three", () => {
    // Four players from one club, all dominated by a rival's cheaper star.
    const pool = [
      candidate(1, 2, 40, 9, 99),
      ...[2, 3, 4, 5].map((id, i) => candidate(id, 2, 60 + i, 5 - i * 0.1, 7)),
    ];
    const kept = pruneCandidates(pool, {
      topPerPosition: 1,
      topPerPositionPerTeam: 3,
      cheapestPerPosition: 0,
    });
    const fromClub7 = kept.filter((c) => c.teamId === 7);
    expect(fromClub7).toHaveLength(3);
  });

  it("always keeps bench fodder, however badly it scores", () => {
    const pool = [
      candidate(1, 4, 150, 12, 1),
      candidate(2, 4, 38, 0.1, 2), // the cheapest forward in the game
    ];
    const kept = pruneCandidates(pool, {
      topPerPosition: 1,
      topPerPositionPerTeam: 1,
      cheapestPerPosition: 1,
    });
    expect(kept.map((c) => c.playerId)).toContain(2);
  });

  it("prunes each position independently", () => {
    const pool = [
      ...[1, 2, 3].map((id) => candidate(id, 1, 40 + id, 5 - id, id)),
      ...[4, 5, 6].map((id) => candidate(id, 4, 40 + id, 5 - id, id)),
    ];
    const kept = pruneCandidates(pool, {
      topPerPosition: 1,
      topPerPositionPerTeam: 1,
      cheapestPerPosition: 0,
    });
    expect(kept.some((c) => c.elementType === 1)).toBe(true);
    expect(kept.some((c) => c.elementType === 4)).toBe(true);
  });
});

function element(id: number, elementType: number, team: number, over: Partial<FplElement> = {}) {
  return {
    id,
    code: id,
    web_name: `P${id}`,
    element_type: elementType,
    team,
    now_cost: 50,
    status: "a",
    ep_next: "5.0",
    ep_this: "5.0",
    form: "5.0",
    total_points: 40,
    selected_by_percent: "5.0",
    news: "",
    chance_of_playing_next_round: null,
    ...over,
  } as FplElement;
}

function bootstrap(elements: FplElement[]): FplBootstrap {
  const teams = [1, 2].map(
    (id) => ({ id, code: id, name: `T${id}`, short_name: `T${id}`, strength: 3 }) as FplTeam,
  );
  return { elements, teams, events: [] } as unknown as FplBootstrap;
}

describe("buildWildcardPool", () => {
  const fixtures = [fixture(1, 2, 3, 3)];
  const fetchFixtures = async () => fixtures;

  it("reads FPL's own projection for the 'fpl' source", async () => {
    const bs = bootstrap([element(1, 3, 1, { ep_next: "7.5" })]);
    const pool = await buildWildcardPool({ bs, gws: [1], source: "fpl", fetchFixtures });
    expect(pool.candidates[0].captainXp).toBe(7.5);
    expect(pool.candidates[0].xp).toBe(7.5);
    expect(pool.source).toBe("fpl");
  });

  it("weights later gameweeks down", async () => {
    const bs = bootstrap([element(1, 3, 1, { ep_next: "10" })]);
    const pool = await buildWildcardPool({ bs, gws: [1, 2], source: "fpl", fetchFixtures });
    // GW1 at full value, GW2 decayed and scaled by an average fixture.
    expect(pool.candidates[0].xp).toBeCloseTo(10 + 10 * HORIZON_DECAY, 3);
    // The armband is decided for the next gameweek only.
    expect(pool.candidates[0].captainXp).toBe(10);
  });

  it("scores a later blank gameweek as nothing", async () => {
    const bs = bootstrap([element(1, 3, 1, { ep_next: "10" })]);
    // Team 1 has no fixture in the second gameweek.
    const perGw = [fixtures, [fixture(2, 3, 3, 3)]];
    const pool = await buildWildcardPool({
      bs,
      gws: [1, 2],
      source: "fpl",
      fetchFixtures: async (gw) => perGw[gw - 1],
    });
    expect(pool.candidates[0].xp).toBe(10);
  });

  it("excludes injured, suspended and unavailable players", async () => {
    const bs = bootstrap([
      element(1, 3, 1, { status: "a" }),
      element(2, 3, 1, { status: "i" }),
      element(3, 3, 1, { status: "s" }),
      element(4, 3, 1, { status: "u" }),
      element(5, 3, 1, { status: "n" }),
      element(6, 3, 1, { status: "d" }), // a doubt is still selectable
    ]);
    const pool = await buildWildcardPool({ bs, gws: [1], source: "fpl", fetchFixtures });
    expect(pool.candidates.map((c) => c.playerId).sort()).toEqual([1, 6]);
    expect(pool.consideredCount).toBe(2);
  });

  it("survives a fixture fetch that fails", async () => {
    const bs = bootstrap([element(1, 3, 1, { ep_next: "6" })]);
    const pool = await buildWildcardPool({
      bs,
      gws: [1],
      source: "fpl",
      fetchFixtures: async () => {
        throw new Error("upstream down");
      },
    });
    expect(pool.candidates).toHaveLength(1);
  });
});
