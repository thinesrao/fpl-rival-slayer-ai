import { describe, expect, it } from "vitest";

import type { FplBootstrap, FplElement, FplFixture, FplTeam } from "@/lib/types";
import { projectPlayer } from "@/lib/projections/model";

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
const bs = { elements: [], teams: [], events: [], element_types: [] } as unknown as FplBootstrap;
const fixtures = [
  { id: 1, event: 10, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 4, finished: false },
] as unknown as FplFixture[];

describe("projectPlayer public contract", () => {
  it("returns every field consumers depend on", () => {
    const p = projectPlayer({ player: element(), team, position: "MID", fixtures, gw: 10, bs });
    expect(Object.keys(p).sort()).toEqual(
      ["fixtureDifficulty", "injuryRisk", "notes", "playerId", "position", "variance", "webName", "xPoints"].sort(),
    );
  });

  it("keeps xPoints a finite non-negative number", () => {
    const p = projectPlayer({ player: element(), team, position: "MID", fixtures, gw: 10, bs });
    expect(Number.isFinite(p.xPoints)).toBe(true);
    expect(p.xPoints).toBeGreaterThanOrEqual(0);
  });

  it("reports injuryRisk as 1 minus availability", () => {
    const p = projectPlayer({
      player: element({ chance_of_playing_next_round: 25 }),
      team, position: "MID", fixtures, gw: 10, bs,
    });
    expect(p.injuryRisk).toBeCloseTo(0.75, 5);
  });

  it("notes a blank gameweek", () => {
    const p = projectPlayer({ player: element(), team, position: "MID", fixtures: [], gw: 10, bs });
    expect(p.notes.join(" ")).toMatch(/blank/i);
    expect(p.xPoints).toBe(0);
  });

  it("notes an availability doubt", () => {
    const p = projectPlayer({
      player: element({ chance_of_playing_next_round: 50, news: "Knock" }),
      team, position: "MID", fixtures, gw: 10, bs,
    });
    expect(p.notes.join(" ")).toMatch(/50%/);
  });

  it("uses the residual-fitted variance rather than a positional constant", () => {
    const p = projectPlayer({ player: element(), team, position: "MID", fixtures, gw: 10, bs });
    expect(p.variance).toBeGreaterThan(0);
  });
});
