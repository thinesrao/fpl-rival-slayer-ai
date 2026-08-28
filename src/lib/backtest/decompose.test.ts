import { describe, expect, it } from "vitest";

import { decomposeActualPoints } from "@/lib/backtest/decompose";
import { DC_THRESHOLD } from "@/lib/projections/scoring-rules";
import type { PanelRow } from "@/lib/backtest/types";

function row(overrides: Partial<PanelRow>): PanelRow {
  return {
    season: "2025-26",
    round: 10,
    playerId: 1,
    webName: "Test",
    position: "MID",
    teamName: "T",
    opponentTeam: 2,
    wasHome: true,
    minutes: 90,
    starts: 1,
    totalPoints: 0,
    goalsScored: 0,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 0,
    ownGoals: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 0,
    bps: 0,
    expectedGoals: 0,
    expectedAssists: 0,
    expectedGoalsConceded: 0,
    defensiveContribution: 0,
    value: 50,
    fplXp: null,
    ...overrides,
  };
}

describe("DC_THRESHOLD", () => {
  it("is 10 for defenders and 12 for midfielders and forwards", () => {
    expect(DC_THRESHOLD.DEF).toBe(10);
    expect(DC_THRESHOLD.MID).toBe(12);
    expect(DC_THRESHOLD.FWD).toBe(12);
  });

  it("is null for goalkeepers, who never receive it", () => {
    expect(DC_THRESHOLD.GKP).toBeNull();
  });
});

describe("decomposeActualPoints", () => {
  it("awards 2 appearance points for 60 or more minutes", () => {
    expect(decomposeActualPoints(row({ minutes: 60 })).appearance).toBe(2);
  });

  it("awards 1 appearance point below 60 minutes", () => {
    expect(decomposeActualPoints(row({ minutes: 45 })).appearance).toBe(1);
  });

  it("awards no appearance points for an unused player", () => {
    expect(decomposeActualPoints(row({ minutes: 0 })).appearance).toBe(0);
  });

  it("scores goals by position", () => {
    expect(decomposeActualPoints(row({ position: "DEF", goalsScored: 1 })).goals).toBe(6);
    expect(decomposeActualPoints(row({ position: "MID", goalsScored: 1 })).goals).toBe(5);
    expect(decomposeActualPoints(row({ position: "FWD", goalsScored: 1 })).goals).toBe(4);
  });

  it("scores clean sheets only for 60+ minutes and only for GKP, DEF and MID", () => {
    expect(decomposeActualPoints(row({ position: "DEF", cleanSheets: 1 })).cleanSheet).toBe(4);
    expect(decomposeActualPoints(row({ position: "MID", cleanSheets: 1 })).cleanSheet).toBe(1);
    expect(decomposeActualPoints(row({ position: "FWD", cleanSheets: 1 })).cleanSheet).toBe(0);
    expect(
      decomposeActualPoints(row({ position: "DEF", cleanSheets: 1, minutes: 30 })).cleanSheet,
    ).toBe(0);
  });

  it("deducts one point per two goals conceded for GKP and DEF only", () => {
    expect(decomposeActualPoints(row({ position: "DEF", goalsConceded: 3 })).concededPenalty).toBe(-1);
    expect(decomposeActualPoints(row({ position: "MID", goalsConceded: 3 })).concededPenalty).toBe(0);
  });

  it("awards one point per three saves", () => {
    expect(decomposeActualPoints(row({ position: "GKP", saves: 7 })).saves).toBe(2);
  });

  it("awards defensive contribution at the defender threshold of 10", () => {
    expect(decomposeActualPoints(row({ position: "DEF", defensiveContribution: 9 })).defensiveContribution).toBe(0);
    expect(decomposeActualPoints(row({ position: "DEF", defensiveContribution: 10 })).defensiveContribution).toBe(2);
  });

  it("awards defensive contribution at the midfield threshold of 12", () => {
    expect(decomposeActualPoints(row({ position: "MID", defensiveContribution: 11 })).defensiveContribution).toBe(0);
    expect(decomposeActualPoints(row({ position: "MID", defensiveContribution: 12 })).defensiveContribution).toBe(2);
  });

  it("never awards defensive contribution to a goalkeeper", () => {
    expect(decomposeActualPoints(row({ position: "GKP", defensiveContribution: 30 })).defensiveContribution).toBe(0);
  });

  it("sums components into total", () => {
    const b = decomposeActualPoints(row({ position: "MID", goalsScored: 1, assists: 1, bonus: 3 }));
    expect(b.total).toBe(b.appearance + b.goals + b.assists + b.cleanSheet + b.concededPenalty +
      b.saves + b.penaltiesSaved + b.penaltiesMissed + b.ownGoals + b.cards + b.bonus + b.defensiveContribution);
  });

  it("reproduces recorded totals for a clean 2025-26 case", () => {
    // A defender, 90 minutes, no clean sheet, no returns, DC 11 -> 2 + 2 = 4.
    const b = decomposeActualPoints(
      row({ position: "DEF", minutes: 90, goalsConceded: 1, defensiveContribution: 11 }),
    );
    expect(b.total).toBe(4);
  });
});
