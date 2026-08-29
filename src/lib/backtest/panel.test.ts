import { describe, expect, it } from "vitest";

import { groupByPlayer, toPanelRows } from "@/lib/backtest/panel";

const HEADER_ROW = {
  name: "Player One",
  position: "GK",
  element: "7",
  team: "Arsenal",
  round: "5",
  minutes: "90",
  starts: "1",
  total_points: "6",
  goals_scored: "0",
  assists: "0",
  clean_sheets: "1",
  goals_conceded: "0",
  own_goals: "0",
  penalties_saved: "0",
  penalties_missed: "0",
  yellow_cards: "0",
  red_cards: "0",
  saves: "3",
  bonus: "1",
  bps: "28",
  expected_goals: "0.01",
  expected_assists: "0.02",
  expected_goals_conceded: "0.90",
  defensive_contribution: "4",
  was_home: "True",
  opponent_team: "12",
  value: "55",
  xP: "4.2",
};

describe("toPanelRows", () => {
  it("normalises the archive GK position to the app's GKP", () => {
    const [row] = toPanelRows([HEADER_ROW], "2025-26", 5);
    expect(row.position).toBe("GKP");
  });

  it("coerces numeric columns to numbers", () => {
    const [row] = toPanelRows([HEADER_ROW], "2025-26", 5);
    expect(row.minutes).toBe(90);
    expect(row.bps).toBe(28);
    expect(row.expectedGoals).toBeCloseTo(0.01);
    expect(row.totalPoints).toBe(6);
  });

  it("parses was_home as a boolean", () => {
    const [home] = toPanelRows([HEADER_ROW], "2025-26", 5);
    expect(home.wasHome).toBe(true);
    const [away] = toPanelRows([{ ...HEADER_ROW, was_home: "False" }], "2025-26", 5);
    expect(away.wasHome).toBe(false);
  });

  it("uses the caller's round, not the file's, so mislabelled rows cannot leak", () => {
    const [row] = toPanelRows([{ ...HEADER_ROW, round: "31" }], "2025-26", 5);
    expect(row.round).toBe(5);
  });

  it("marks xP as absent when the column is zero", () => {
    const [row] = toPanelRows([{ ...HEADER_ROW, xP: "0" }], "2025-26", 5);
    expect(row.fplXp).toBeNull();
  });

  it("keeps xP when the column carries a value", () => {
    const [row] = toPanelRows([HEADER_ROW], "2025-26", 5);
    expect(row.fplXp).toBeCloseTo(4.2);
  });

  it("treats a missing defensive_contribution column as zero", () => {
    const { defensive_contribution: _drop, ...withoutDc } = HEADER_ROW;
    const [row] = toPanelRows([withoutDc], "2024-25", 5);
    expect(row.defensiveContribution).toBe(0);
  });
});

describe("groupByPlayer", () => {
  it("groups by element id and sorts each list ascending by round", () => {
    const rows = [
      ...toPanelRows([{ ...HEADER_ROW, element: "7" }], "2025-26", 9),
      ...toPanelRows([{ ...HEADER_ROW, element: "7" }], "2025-26", 2),
      ...toPanelRows([{ ...HEADER_ROW, element: "8" }], "2025-26", 4),
    ];
    const grouped = groupByPlayer(rows);
    expect(grouped.get(7)?.map((r) => r.round)).toEqual([2, 9]);
    expect(grouped.get(8)?.map((r) => r.round)).toEqual([4]);
  });
});
