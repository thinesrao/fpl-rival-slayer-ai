import { describe, expect, it } from "vitest";

import type { FplElement, FplFixture, FplTeam } from "@/lib/types";
import { fixtureContextFor, liveFeatures } from "@/lib/projections/live-features";

function element(overrides: Partial<FplElement> = {}): FplElement {
  return {
    id: 1,
    web_name: "Test",
    element_type: 3,
    team: 1,
    chance_of_playing_next_round: null,
    form: "5.0",
    expected_goals_per_90: 0.4,
    expected_assists_per_90: 0.2,
    starts_per_90: 1,
    ict_index: "120.0",
    ...(overrides as object),
  } as FplElement;
}

const team = { id: 1, name: "T", short_name: "T" } as FplTeam;

function fixture(overrides: Partial<FplFixture> = {}): FplFixture {
  return {
    id: 1,
    event: 10,
    team_h: 1,
    team_a: 2,
    team_h_difficulty: 2,
    team_a_difficulty: 4,
    finished: false,
    ...(overrides as object),
  } as FplFixture;
}

describe("fixtureContextFor", () => {
  it("reports a blank gameweek as zero fixtures", () => {
    const ctx = fixtureContextFor([], 1, 10);
    expect(ctx.fixtureCount).toBe(0);
  });

  it("counts a double gameweek", () => {
    const ctx = fixtureContextFor([fixture(), fixture({ id: 2, team_a: 1, team_h: 3 })], 1, 10);
    expect(ctx.fixtureCount).toBe(2);
  });

  it("detects home versus away correctly", () => {
    expect(fixtureContextFor([fixture()], 1, 10).isHome).toBe(true);
    expect(fixtureContextFor([fixture()], 2, 10).isHome).toBe(false);
  });

  it("reads the difficulty from the correct side", () => {
    expect(fixtureContextFor([fixture()], 1, 10).fdr).toBe(2);
    expect(fixtureContextFor([fixture()], 2, 10).fdr).toBe(4);
  });
});

describe("liveFeatures", () => {
  it("treats a null chance_of_playing as fully available", () => {
    const f = liveFeatures({ player: element(), team, position: "MID", fixtures: [fixture()], gw: 10 });
    expect(f.availability).toBe(1);
  });

  it("converts a percentage chance_of_playing into a 0..1 availability", () => {
    const f = liveFeatures({
      player: element({ chance_of_playing_next_round: 50 }),
      team,
      position: "MID",
      fixtures: [fixture()],
      gw: 10,
    });
    expect(f.availability).toBeCloseTo(0.5, 5);
  });

  it("carries the live per-90 rates into the shared feature shape", () => {
    const f = liveFeatures({ player: element(), team, position: "MID", fixtures: [fixture()], gw: 10 });
    expect(f.xg90).toBeCloseTo(0.4, 5);
    expect(f.xa90).toBeCloseTo(0.2, 5);
  });

  it("never produces NaN from missing live fields", () => {
    const f = liveFeatures({
      player: element({ expected_goals_per_90: undefined as never, starts_per_90: undefined as never }),
      team,
      position: "MID",
      fixtures: [fixture()],
      gw: 10,
    });
    expect(Number.isNaN(f.xg90)).toBe(false);
    expect(Number.isNaN(f.pStart)).toBe(false);
  });
});

describe("regression: the live path has no hard-zero either", () => {
  it("does not score a fit player with no recorded starts at exactly zero", () => {
    const f = liveFeatures({
      player: element({ starts_per_90: 0 }),
      team,
      position: "MID",
      fixtures: [fixture()],
      gw: 10,
    });
    expect(f.pStart).toBeGreaterThan(0);
    expect(f.minutesPerStart).toBeGreaterThan(0);
  });

  it("still floors a player FPL has flagged as out", () => {
    const f = liveFeatures({
      player: element({ starts_per_90: 0, status: "i", chance_of_playing_next_round: 0 }),
      team,
      position: "MID",
      fixtures: [fixture()],
      gw: 10,
    });
    expect(f.pStart).toBe(0);
  });

  it("leaves a regular starter's probability untouched", () => {
    const f = liveFeatures({
      player: element({ starts_per_90: 1 }),
      team,
      position: "MID",
      fixtures: [fixture()],
      gw: 10,
    });
    expect(f.pStart).toBe(1);
  });
});
