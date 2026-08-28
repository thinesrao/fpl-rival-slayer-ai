import { describe, expect, it } from "vitest";

import type {
  AiRecommendation,
} from "@/lib/ai/gemini";
import type {
  FplBootstrap,
  FplElement,
  FplFixture,
  FplTeam,
  ManagerSquad,
  SquadProjection,
  SquadSlot,
} from "@/lib/types";
import {
  findElementByWebName,
  opponentForTeam,
  resolveSuggestedSquad,
} from "@/lib/projections/resolve-suggested";

function makeTeam(id: number, shortName: string): FplTeam {
  return { id, code: id, name: shortName, short_name: shortName } as FplTeam;
}

function makeElement(overrides: Partial<FplElement>): FplElement {
  return {
    id: 1,
    code: 1,
    web_name: "Player",
    first_name: "First",
    second_name: "Last",
    team: 1,
    element_type: 3,
    now_cost: 55,
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

describe("opponentForTeam", () => {
  const teamsById = new Map([
    [1, makeTeam(1, "ARS")],
    [2, makeTeam(2, "LEE")],
  ]);
  const fixtures = [
    { id: 1, code: 1, event: 4, kickoff_time: null, finished: false, team_h: 1, team_a: 2, team_h_score: null, team_a_score: null, team_h_difficulty: 2, team_a_difficulty: 4 },
  ] as unknown as FplFixture[];

  it("formats a home fixture", () => {
    expect(opponentForTeam(1, fixtures, teamsById)).toBe("LEE (H)");
  });

  it("formats an away fixture", () => {
    expect(opponentForTeam(2, fixtures, teamsById)).toBe("ARS (A)");
  });

  it("returns null on a blank gameweek", () => {
    expect(opponentForTeam(3, fixtures, teamsById)).toBeNull();
  });

  it("joins a double gameweek's opponents", () => {
    const dgw = [
      ...fixtures,
      { id: 2, code: 2, event: 4, kickoff_time: null, finished: false, team_h: 3, team_a: 1, team_h_score: null, team_a_score: null, team_h_difficulty: 2, team_a_difficulty: 4 },
    ] as unknown as FplFixture[];
    expect(opponentForTeam(1, dgw, teamsById)).toBe("LEE (H) + ? (A)");
  });
});

describe("findElementByWebName", () => {
  const bs = {
    elements: [makeElement({ id: 1, web_name: "B.Fernandes" }), makeElement({ id: 2, web_name: "Haaland" })],
  } as FplBootstrap;

  it("matches exactly", () => {
    expect(findElementByWebName("Haaland", bs)?.id).toBe(2);
  });

  it("matches case-insensitively", () => {
    expect(findElementByWebName("haaland", bs)?.id).toBe(2);
  });

  it("fuzzy-matches a substring after normalizing punctuation", () => {
    // web_name is "B.Fernandes" -> normalized "bfernandes", which contains
    // the normalized search term "fernandes" as a substring.
    expect(findElementByWebName("Fernandes", bs)?.id).toBe(1);
  });

  it("returns null when nothing matches", () => {
    expect(findElementByWebName("Nobody", bs)).toBeNull();
  });

  it("returns null for a too-short normalized name", () => {
    expect(findElementByWebName("Jr", bs)).toBeNull();
  });
});

describe("resolveSuggestedSquad", () => {
  const team = makeTeam(1, "ARS");
  const owned = makeElement({ id: 1, web_name: "Owned", team: 1, element_type: 2 }); // DEF
  const unowned = makeElement({ id: 2, web_name: "NewSigning", team: 1, element_type: 4 }); // FWD
  const unfindable = "Ghost Player";

  const bs = {
    elements: [owned, unowned],
    teams: [team],
  } as unknown as FplBootstrap;

  const userSlot: SquadSlot = {
    pick: { element: 1, position: 1, multiplier: 1, is_captain: true, is_vice_captain: false },
    player: owned,
    team,
    position: "DEF",
  };

  const user: ManagerSquad = {
    entry: { id: 1, name: "Me", player_name: "Me", total: 100, rank: 1 },
    gw: 4,
    picks: [userSlot],
    starters: [userSlot],
    bench: [],
    captain: userSlot,
    viceCaptain: undefined,
    activeChip: null,
  };

  const userProjection: SquadProjection = {
    entryId: 1,
    startingXIPoints: 5,
    benchPoints: 0,
    totalExpected: 5,
    stdev: 1,
    perPlayer: [
      { playerId: 1, webName: "Owned", position: "DEF", xPoints: 5, variance: 1, injuryRisk: 0, fixtureDifficulty: 2, notes: [] },
    ],
  };

  const fixtures: FplFixture[] = [
    { id: 1, code: 1, event: 4, kickoff_time: null, finished: false, team_h: 1, team_a: 2, team_h_score: null, team_a_score: null, team_h_difficulty: 2, team_a_difficulty: 4 },
  ];

  const rec: AiRecommendation = {
    overall_strategy: "Attack",
    transfers: [{ out: "Owned", in: "NewSigning", reason: "Form" }],
    captain: { pick: "Owned", vice: unfindable, reasoning: "Best fixture" },
    starting_xi: ["Owned", "NewSigning", unfindable],
    bench: ["NewSigning"],
    chip: { use: "none", reasoning: "" },
    differentials_to_exploit: [],
    multi_gw_plan: [],
  } as unknown as AiRecommendation;

  it("reuses the cached xP for an owned player and projects a fresh xP for a new signing", () => {
    const resolved = resolveSuggestedSquad({
      rec, user, userProjection, bs, fixtures, gw: 4, bank: 10, freeTransfers: 1,
    });

    const ownedResolved = resolved.startingXi.find((p) => p.playerId === 1);
    expect(ownedResolved?.xPoints).toBeCloseTo(5, 1);

    const newSigningResolved = resolved.startingXi.find((p) => p.playerId === 2);
    expect(newSigningResolved).toBeDefined();
    expect(newSigningResolved?.isIn).toBe(true);
  });

  it("falls back to a placeholder for a name that cannot be resolved", () => {
    const resolved = resolveSuggestedSquad({
      rec, user, userProjection, bs, fixtures, gw: 4, bank: 10, freeTransfers: 1,
    });
    const ghost = resolved.startingXi.find((p) => p.webName === unfindable);
    expect(ghost).toEqual(expect.objectContaining({ playerId: -1, xPoints: 0 }));
  });

  it("marks the captain and computes the doubled total xP", () => {
    const resolved = resolveSuggestedSquad({
      rec, user, userProjection, bs, fixtures, gw: 4, bank: 10, freeTransfers: 1,
    });
    const captain = resolved.startingXi.find((p) => p.isCaptain);
    expect(captain?.playerId).toBe(1);
    // owned (5, captain x2) + newSigning (projected) + ghost (0)
    const nonCaptain = resolved.totalXp - 5 * 2;
    expect(nonCaptain).toBeGreaterThanOrEqual(0);
  });

  it("derives the formation string from starting-XI element types", () => {
    const resolved = resolveSuggestedSquad({
      rec, user, userProjection, bs, fixtures, gw: 4, bank: 10, freeTransfers: 1,
    });
    expect(resolved.formation).toMatch(/^\d-\d-\d$/);
  });

  it("passes bank and freeTransfers through unchanged", () => {
    const resolved = resolveSuggestedSquad({
      rec, user, userProjection, bs, fixtures, gw: 4, bank: 12.5, freeTransfers: 2,
    });
    expect(resolved.bank).toBe(12.5);
    expect(resolved.freeTransfers).toBe(2);
  });
});
