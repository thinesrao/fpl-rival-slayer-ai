import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  FplBootstrap,
  FplElement,
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

const { buildProjections } = await import("@/lib/projections/index");

const team: FplTeam = { id: 1, code: 1, name: "Team", short_name: "TM" } as FplTeam;

function player(): FplElement {
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
  events: [],
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

describe("buildProjections", () => {
  it("fetches fixtures once for the GW and projects both the user and every rival", async () => {
    const ctx: RivalContext = {
      user: managerSquad(1, 100, 1),
      rivals: [managerSquad(2, 90, 2), managerSquad(3, 80, 3)],
      leagueName: "Test League",
    };

    const result = await buildProjections(ctx, bs, 4);

    expect(getFixturesMock).toHaveBeenCalledTimes(1);
    expect(getFixturesMock).toHaveBeenCalledWith(4);
    expect(result.gw).toBe(4);
    expect(result.user.entryId).toBe(1);
    expect(result.rivals).toHaveLength(2);
    expect(result.rivals.map((r) => r.entryId)).toEqual([2, 3]);
    expect(result.overtake).toHaveLength(2);
  });
});
