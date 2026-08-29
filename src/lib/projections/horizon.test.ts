import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  FplBootstrap,
  FplElement,
  FplEvent,
  FplFixture,
  FplTeam,
  ManagerSquad,
  RivalContext,
  SquadSlot,
} from "@/lib/types";

const getFixturesMock = vi.fn<(event?: number) => Promise<FplFixture[]>>();

vi.mock("@/lib/fpl/client", () => ({
  getFixtures: (event?: number) => getFixturesMock(event),
}));

// Imported after the mock so buildHorizon picks up the mocked client.
const { buildHorizon, computeCumulativeOvertake } = await import("@/lib/projections/horizon");
type HorizonGw = Awaited<ReturnType<typeof buildHorizon>>["horizon"][number];

const team: FplTeam = { id: 1, code: 1, name: "Team", short_name: "TM" } as FplTeam;

function player(overrides: Partial<FplElement> = {}): FplElement {
  return {
    id: 1,
    code: 1,
    web_name: "Test",
    first_name: "Test",
    second_name: "Player",
    team: 1,
    element_type: 3,
    now_cost: 50,
    status: "a",
    news: "",
    news_added: null,
    chance_of_playing_next_round: null,
    form: "5.0",
    points_per_game: "5.0",
    total_points: 50,
    minutes: 900,
    selected_by_percent: "10.0",
    ep_next: "5.0",
    ep_this: "5.0",
    expected_goals: "1.0",
    expected_assists: "1.0",
    expected_goal_involvements: "2.0",
    expected_goals_conceded: "1.0",
    expected_goals_per_90: 0.4,
    expected_assists_per_90: 0.2,
    expected_goal_involvements_per_90: 0.6,
    expected_goals_conceded_per_90: 1.0,
    saves_per_90: 0,
    clean_sheets_per_90: 0.3,
    starts_per_90: 1,
    ict_index: "120.0",
    bps: 200,
    transfers_in_event: 0,
    transfers_out_event: 0,
    cost_change_event: 0,
    cost_change_start: 0,
    ...overrides,
  } as FplElement;
}

function slot(): SquadSlot {
  return {
    pick: { element: 1, position: 1, multiplier: 1, is_captain: false, is_vice_captain: false },
    player: player(),
    team,
    position: "MID",
  };
}

function managerSquad(id: number, total: number, rank: number): ManagerSquad {
  return {
    entry: { id, name: `Team ${id}`, player_name: "Manager", total, rank },
    gw: 4,
    picks: [slot()],
    starters: [],
    bench: [],
    captain: undefined,
    viceCaptain: undefined,
    activeChip: null,
  };
}

const bs: FplBootstrap = {
  events: [
    { id: 4, name: "GW4", deadline_time: "", deadline_time_epoch: 0, finished: false, is_current: true, is_next: false, is_previous: false, average_entry_score: 50, highest_score: null },
    { id: 5, name: "GW5", deadline_time: "", deadline_time_epoch: 0, finished: false, is_current: false, is_next: true, is_previous: false, average_entry_score: 50, highest_score: null },
  ] as FplEvent[],
  teams: [team],
  elements: [player()],
  element_types: [],
  total_players: 1,
};

const fixtures: FplFixture[] = [
  { id: 1, code: 1, event: 4, kickoff_time: null, finished: false, team_h: 1, team_a: 2, team_h_score: null, team_a_score: null, team_h_difficulty: 2, team_a_difficulty: 4 },
];

beforeEach(() => {
  getFixturesMock.mockReset();
  getFixturesMock.mockResolvedValue(fixtures);
});

describe("buildHorizon", () => {
  it("builds one HorizonGw per requested future gameweek and fetches fixtures for each", async () => {
    const ctx: RivalContext = {
      user: managerSquad(1, 100, 1),
      rivals: [managerSquad(2, 90, 2)],
      leagueName: "Test League",
    };

    const result = await buildHorizon(ctx, bs, 4, 2);

    expect(result.horizon).toHaveLength(2); // events 4 and 5
    expect(result.horizon.map((h) => h.gw)).toEqual([4, 5]);
    expect(getFixturesMock).toHaveBeenCalledTimes(2);
    expect(result.cumulative).toHaveLength(1);
    expect(result.cumulative[0].rivalEntryId).toBe(2);
  });

  it("clamps n to at least one gameweek", async () => {
    const ctx: RivalContext = {
      user: managerSquad(1, 100, 1),
      rivals: [managerSquad(2, 90, 2)],
      leagueName: "Test League",
    };

    const result = await buildHorizon(ctx, bs, 4, 0);
    expect(result.horizon).toHaveLength(1);
  });
});

describe("computeCumulativeOvertake", () => {
  const ctx: RivalContext = {
    user: managerSquad(1, 100, 1),
    rivals: [managerSquad(2, 40, 2)],
    leagueName: "Test League",
  };

  function horizonGw(userPts: number, rivalPts: number, stdev = 1): HorizonGw {
    return {
      gw: 4,
      fixtures,
      user: { entryId: 1, startingXIPoints: userPts, benchPoints: 0, totalExpected: userPts, stdev, perPlayer: [] },
      rivals: [{ entryId: 2, startingXIPoints: rivalPts, benchPoints: 0, totalExpected: rivalPts, stdev, perPlayer: [] }],
      overtake: [],
    };
  }

  it("reports near-certain overtake when the user is far ahead every GW and already leads the table", () => {
    const horizon = [horizonGw(80, 20), horizonGw(80, 20)];
    const [c] = computeCumulativeOvertake(ctx, horizon, 500);

    expect(c.rivalEntryId).toBe(2);
    expect(c.pointsBehind).toBe(0);
    expect(c.userExpectedTotal).toBeCloseTo(160, 5);
    expect(c.rivalExpectedTotal).toBeCloseTo(40, 5);
    expect(c.overtakeProbability).toBeGreaterThan(0.9);
  });

  it("falls back to a stdev floor of 1 and a rival default of 0 when a rival slot is missing", () => {
    const horizon: HorizonGw[] = [
      {
        gw: 4,
        fixtures,
        user: { entryId: 1, startingXIPoints: 50, benchPoints: 0, totalExpected: 50, stdev: 0, perPlayer: [] },
        rivals: [], // no matching rival projection for index 0
        overtake: [],
      },
    ];
    const [c] = computeCumulativeOvertake(ctx, horizon, 100);
    expect(c.rivalExpectedTotal).toBe(0);
    expect(c.overtakeProbability).toBeGreaterThanOrEqual(0);
  });
});
