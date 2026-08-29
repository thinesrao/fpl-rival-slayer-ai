import { describe, expect, it } from "vitest";

import { HOLDOUT_ROUNDS, fitRounds, runBacktest } from "@/lib/backtest/runner";

function record(round: number, element: number, overrides: Record<string, string> = {}) {
  return {
    name: `P${element}`,
    position: element % 2 === 0 ? "DEF" : "MID",
    element: String(element),
    team: "T",
    round: String(round),
    minutes: "90",
    starts: "1",
    total_points: String(2 + (element % 5)),
    goals_scored: "0",
    assists: "0",
    clean_sheets: "0",
    goals_conceded: "1",
    own_goals: "0",
    penalties_saved: "0",
    penalties_missed: "0",
    yellow_cards: "0",
    red_cards: "0",
    saves: "0",
    bonus: "0",
    bps: String(10 + element),
    expected_goals: String(0.05 * (element % 7)),
    expected_assists: "0.1",
    expected_goals_conceded: "1.1",
    defensive_contribution: String(element % 15),
    was_home: "True",
    opponent_team: "2",
    value: "60",
    xP: String(1 + (element % 4)),
    ...overrides,
  };
}

const loader = async (round: number) =>
  round >= 1 && round <= 12
    ? Array.from({ length: 40 }, (_, i) => record(round, i + 1))
    : null;

describe("split definition", () => {
  it("uses the eight benchmark gameweeks from the spec", () => {
    expect([...HOLDOUT_ROUNDS]).toEqual([4, 5, 6, 8, 9, 24, 29, 38]);
  });

  it("produces a fit set disjoint from the holdout", () => {
    const fit = fitRounds();
    for (const r of HOLDOUT_ROUNDS) expect(fit).not.toContain(r);
  });

  it("excludes rounds 1 to 3 from the holdout, which are feature-poor", () => {
    for (const r of [1, 2, 3]) expect(HOLDOUT_ROUNDS).not.toContain(r);
  });
});

describe("runBacktest", () => {
  it("produces one prediction per evaluated player-round", async () => {
    const report = await runBacktest({ rounds: [8, 9], loader });
    expect(report.predictions.length).toBeGreaterThan(0);
    expect(report.roundsEvaluated).toEqual([8, 9]);
  });

  it("skips rounds the loader cannot supply and records them as gaps", async () => {
    const report = await runBacktest({ rounds: [8, 99], loader });
    expect(report.gaps).toContain(99);
    expect(report.roundsEvaluated).toEqual([8]);
  });

  it("never scores a player with fewer than the minimum prior rounds", async () => {
    const report = await runBacktest({ rounds: [4], loader });
    for (const p of report.predictions) expect(p.sampleRounds).toBeGreaterThanOrEqual(3);
  });

  it("reports our model, FPL's xP and predict-the-mean as separate baselines", async () => {
    const report = await runBacktest({ rounds: [8, 9], loader });
    expect(report.starters.model).toBeDefined();
    expect(report.starters.fplXp).toBeDefined();
    expect(report.starters.mean).toBeDefined();
  });

  it("segments starters separately from all rows", async () => {
    const report = await runBacktest({ rounds: [8, 9], loader });
    expect(report.starters.model.n).toBeLessThanOrEqual(report.all.model.n);
  });

  it("emits calibration buckets", async () => {
    const report = await runBacktest({ rounds: [8, 9], loader });
    expect(report.calibration.length).toBeGreaterThan(0);
  });

  it("throws rather than silently proceeding when no round can be loaded", async () => {
    await expect(runBacktest({ rounds: [99], loader })).rejects.toThrow(/no rounds/i);
  });
});
