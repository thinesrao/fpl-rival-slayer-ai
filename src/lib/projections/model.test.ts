import { describe, expect, it } from "vitest";

import type {
  FplElement,
  FplFixture,
  FplPick,
  FplTeam,
  ManagerSquad,
  SquadSlot,
} from "@/lib/types";
import { projectPlayer, projectSquad } from "@/lib/projections/model";

function element(overrides: Partial<FplElement> = {}): FplElement {
  return {
    id: 1,
    web_name: "Test",
    element_type: 3,
    team: 1,
    chance_of_playing_next_round: null,
    status: "a",
    news: "",
    form: "5.0",
    expected_goals_per_90: 0.4,
    expected_assists_per_90: 0.2,
    starts_per_90: 1,
    ict_index: "120.0",
    ...(overrides as object),
  } as FplElement;
}

const team = { id: 1, name: "T", short_name: "T" } as FplTeam;
const fixtures = [
  { id: 1, event: 10, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 4, finished: false },
] as unknown as FplFixture[];

describe("projectPlayer public contract", () => {
  it("returns every field consumers depend on", () => {
    const p = projectPlayer({ player: element(), team, position: "MID", fixtures, gw: 10 });
    expect(Object.keys(p).sort()).toEqual(
      ["fixtureDifficulty", "injuryRisk", "notes", "playerId", "position", "variance", "webName", "xPoints"].sort(),
    );
  });

  it("keeps xPoints a finite non-negative number", () => {
    const p = projectPlayer({ player: element(), team, position: "MID", fixtures, gw: 10 });
    expect(Number.isFinite(p.xPoints)).toBe(true);
    expect(p.xPoints).toBeGreaterThanOrEqual(0);
  });

  it("reports injuryRisk as 1 minus availability", () => {
    const p = projectPlayer({
      player: element({ chance_of_playing_next_round: 25 }),
      team, position: "MID", fixtures, gw: 10,
    });
    expect(p.injuryRisk).toBeCloseTo(0.75, 5);
  });

  it("notes a blank gameweek", () => {
    const p = projectPlayer({ player: element(), team, position: "MID", fixtures: [], gw: 10 });
    expect(p.notes.join(" ")).toMatch(/blank/i);
    expect(p.xPoints).toBe(0);
  });

  it("notes an availability doubt", () => {
    const p = projectPlayer({
      player: element({ chance_of_playing_next_round: 50, news: "Knock" }),
      team, position: "MID", fixtures, gw: 10,
    });
    expect(p.notes.join(" ")).toMatch(/50%/);
  });

  it("uses the residual-fitted variance rather than a positional constant", () => {
    const p = projectPlayer({ player: element(), team, position: "MID", fixtures, gw: 10 });
    expect(p.variance).toBeGreaterThan(0);
  });

  it("notes a regular defensive-contribution threat on a triple gameweek", () => {
    // DEF defaults to dcPer90=6, threshold=10 (scoring-rules.ts). A single
    // fixture only reaches ~0.17 expected DC points; three fixtures in one
    // event (a rare but real triple gameweek) crosses the 0.5 note threshold.
    const tripleFixtures = [
      { id: 1, event: 10, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 4, finished: false },
      { id: 2, event: 10, team_h: 3, team_a: 1, team_h_difficulty: 2, team_a_difficulty: 4, finished: false },
      { id: 3, event: 10, team_h: 1, team_a: 4, team_h_difficulty: 2, team_a_difficulty: 4, finished: false },
    ] as unknown as FplFixture[];
    const p = projectPlayer({
      player: element({ starts_per_90: 1 }),
      team,
      position: "DEF",
      fixtures: tripleFixtures,
      gw: 10,
    });
    expect(p.notes.join(" ")).toMatch(/defensive-contribution threat/i);
  });
});

describe("projectSquad", () => {
  function pick(overrides: Partial<FplPick> = {}): FplPick {
    return { element: 1, position: 1, multiplier: 1, is_captain: false, is_vice_captain: false, ...overrides };
  }

  function slot(overrides: Partial<SquadSlot> = {}): SquadSlot {
    return {
      pick: pick(),
      player: element(),
      team,
      position: "MID",
      ...overrides,
    };
  }

  const baseEntry = { id: 1, name: "Test FC", player_name: "Tester", total: 100, rank: 5 };

  it("sums starting-XI points with the captain multiplier and keeps bench separate", () => {
    const squad: ManagerSquad = {
      entry: baseEntry,
      gw: 10,
      picks: [
        slot({ pick: pick({ multiplier: 2, is_captain: true }) }), // captain, doubled
        slot({ pick: pick({ multiplier: 1 }) }), // regular starter
        slot({ pick: pick({ multiplier: 0 }) }), // bench
      ],
      starters: [],
      bench: [],
      captain: undefined,
      viceCaptain: undefined,
      activeChip: null,
    };

    const proj = projectSquad(squad, fixtures, 10);

    expect(proj.entryId).toBe(1);
    expect(proj.perPlayer).toHaveLength(3);

    const perPlayerXp = proj.perPlayer.map((p) => p.xPoints);
    const expectedStarting = Number((perPlayerXp[0] * 2 + perPlayerXp[1] * 1).toFixed(2));
    expect(proj.startingXIPoints).toBeCloseTo(expectedStarting, 2);
    expect(proj.benchPoints).toBeCloseTo(perPlayerXp[2], 2);
    expect(proj.totalExpected).toBeCloseTo(
      Number((proj.startingXIPoints + proj.benchPoints * 0.1).toFixed(2)),
      2,
    );
    expect(proj.stdev).toBeGreaterThanOrEqual(0);
  });

  it("returns zeroed totals for an all-bench squad", () => {
    const squad: ManagerSquad = {
      entry: baseEntry,
      gw: 10,
      picks: [slot({ pick: pick({ multiplier: 0 }) })],
      starters: [],
      bench: [],
      captain: undefined,
      viceCaptain: undefined,
      activeChip: null,
    };

    const proj = projectSquad(squad, fixtures, 10);
    expect(proj.startingXIPoints).toBe(0);
    expect(proj.stdev).toBe(0);
  });
});
