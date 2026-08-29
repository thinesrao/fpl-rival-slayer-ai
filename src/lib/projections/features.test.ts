import { describe, expect, it } from "vitest";

import {
  BASE_START_RATE,
  FALLBACK_MINUTES_PER_START,
  LeakageError,
  START_PRIOR_WEIGHT,
  buildFeatures,
} from "@/lib/projections/features";
import type { PanelRow } from "@/lib/backtest/types";

function row(round: number, overrides: Partial<PanelRow> = {}): PanelRow {
  return {
    season: "2025-26",
    round,
    playerId: 1,
    webName: "Test",
    position: "MID",
    teamName: "T",
    opponentTeam: 2,
    wasHome: true,
    minutes: 90,
    starts: 1,
    totalPoints: 5,
    goalsScored: 0,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 1,
    ownGoals: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 0,
    bps: 20,
    expectedGoals: 0.3,
    expectedAssists: 0.2,
    expectedGoalsConceded: 1.1,
    defensiveContribution: 6,
    value: 70,
    fplXp: null,
    ...overrides,
  };
}

const FIXTURE = { fdr: 3, isHome: true, fixtureCount: 1, opponentXgcPer90: 1.2 };

describe("buildFeatures leakage guard", () => {
  it("throws when handed a row from the round being predicted", () => {
    expect(() => buildFeatures([row(4), row(5)], 5, FIXTURE)).toThrow(LeakageError);
  });

  it("throws when handed a row from a later round", () => {
    expect(() => buildFeatures([row(4), row(9)], 5, FIXTURE)).toThrow(LeakageError);
  });

  it("names the offending round in the error", () => {
    expect(() => buildFeatures([row(7)], 5, FIXTURE)).toThrow(/round 7/);
  });

  it("accepts history consisting only of earlier rounds", () => {
    expect(() => buildFeatures([row(1), row(2), row(3)], 5, FIXTURE)).not.toThrow();
  });
});

describe("buildFeatures rolling values", () => {
  it("computes per-90 rates from prior rounds only", () => {
    // Two 90-minute rounds, 0.3 xG each -> 0.3 per 90.
    const f = buildFeatures([row(1), row(2), row(3)], 4, FIXTURE);
    expect(f.xg90).toBeCloseTo(0.3, 5);
    expect(f.xa90).toBeCloseTo(0.2, 5);
  });

  it("excludes the future round from the average", () => {
    const withFuture = [row(1, { expectedGoals: 0.1 }), row(2, { expectedGoals: 0.1 }), row(3, { expectedGoals: 0.1 })];
    const f = buildFeatures(withFuture, 4, FIXTURE);
    expect(f.xg90).toBeCloseTo(0.1, 5);
  });

  it("reports pStart near the observed fraction when the sample is informative", () => {
    const f = buildFeatures([row(1, { starts: 1 }), row(2, { starts: 0 }), row(3, { starts: 1 }), row(4, { starts: 1 })], 5, FIXTURE);
    // 3 of 4 started, smoothed toward the 0.28 base rate with weight 2:
    // (3 + 2*0.28) / (4 + 2) = 0.5933
    expect(f.pStart).toBeCloseTo((3 + 2 * 0.28) / 6, 4);
  });

  it("reports minutesPerStart from started rounds only", () => {
    const f = buildFeatures(
      [row(1, { starts: 1, minutes: 90 }), row(2, { starts: 0, minutes: 5 }), row(3, { starts: 1, minutes: 70 })],
      4,
      FIXTURE,
    );
    expect(f.minutesPerStart).toBeCloseTo(80, 5);
  });

  it("computes bps90 from prior rounds, which is what replaces the cumulative ICT term", () => {
    const f = buildFeatures([row(1, { bps: 30 }), row(2, { bps: 10 })], 3, FIXTURE);
    expect(f.bps90).toBeCloseTo(20, 5);
  });

  it("computes dcPer90 from prior rounds", () => {
    const f = buildFeatures([row(1, { defensiveContribution: 8 }), row(2, { defensiveContribution: 12 })], 3, FIXTURE);
    expect(f.dcPer90).toBeCloseTo(10, 5);
  });

  it("honours the rolling window and ignores rounds older than it", () => {
    const old = Array.from({ length: 10 }, (_, i) => row(i + 1, { expectedGoals: 1 }));
    const recent = Array.from({ length: 6 }, (_, i) => row(i + 11, { expectedGoals: 0 }));
    const f = buildFeatures([...old, ...recent], 17, FIXTURE, { window: 6 });
    expect(f.xg90).toBeCloseTo(0, 5);
  });

  it("reports sampleRounds so the caller can reject thin history", () => {
    expect(buildFeatures([row(1), row(2)], 3, FIXTURE).sampleRounds).toBe(2);
  });

  it("returns zeroed rates for a player with no history rather than NaN", () => {
    const f = buildFeatures([], 1, FIXTURE);
    expect(f.xg90).toBe(0);
    expect(f.minutesPerStart).toBe(FALLBACK_MINUTES_PER_START);
    expect(f.sampleRounds).toBe(0);
    expect(Number.isNaN(f.bps90)).toBe(false);
  });

  it("carries the fixture context through unchanged", () => {
    const f = buildFeatures([row(1)], 2, { fdr: 5, isHome: false, fixtureCount: 2, opponentXgcPer90: 0.7 });
    expect(f.fdr).toBe(5);
    expect(f.isHome).toBe(false);
    expect(f.fixtureCount).toBe(2);
    expect(f.opponentXgcPer90).toBeCloseTo(0.7);
  });

  it("defaults availability to 1 when not supplied", () => {
    expect(buildFeatures([row(1)], 2, FIXTURE).availability).toBe(1);
  });

  it("clamps supplied availability into 0..1", () => {
    expect(buildFeatures([row(1)], 2, FIXTURE, { availability: 1.4 }).availability).toBe(1);
    expect(buildFeatures([row(1)], 2, FIXTURE, { availability: -3 }).availability).toBe(0);
  });
});

describe("regression: a finite sample never yields a hard zero", () => {
  it("never returns pStart exactly 0 for a player who started none of the window", () => {
    const none = [row(1, { starts: 0, minutes: 0 }), row(2, { starts: 0, minutes: 0 }), row(3, { starts: 0, minutes: 0 })];
    const f = buildFeatures(none, 4, FIXTURE);
    expect(f.pStart).toBeGreaterThan(0);
  });

  it("never returns minutesPerStart of 0 when the player started none of the window", () => {
    const none = [row(1, { starts: 0, minutes: 0 }), row(2, { starts: 0, minutes: 0 }), row(3, { starts: 0, minutes: 0 })];
    expect(buildFeatures(none, 4, FIXTURE).minutesPerStart).toBe(FALLBACK_MINUTES_PER_START);
  });

  it("scores such a player above zero rather than exactly zero", async () => {
    const { scorePlayer } = await import("@/lib/projections/scoring");
    const none = [row(1, { starts: 0, minutes: 0 }), row(2, { starts: 0, minutes: 0 }), row(3, { starts: 0, minutes: 0 })];
    const f = buildFeatures(none, 4, FIXTURE);
    expect(scorePlayer(f).xPoints).toBeGreaterThan(0);
  });

  it("still ranks a non-starter well below a regular starter", async () => {
    const { scorePlayer } = await import("@/lib/projections/scoring");
    const none = [row(1, { starts: 0, minutes: 0 }), row(2, { starts: 0, minutes: 0 }), row(3, { starts: 0, minutes: 0 })];
    const every = [row(1, { starts: 1 }), row(2, { starts: 1 }), row(3, { starts: 1 })];
    const bench = scorePlayer(buildFeatures(none, 4, FIXTURE)).xPoints;
    const regular = scorePlayer(buildFeatures(every, 4, FIXTURE)).xPoints;
    expect(regular).toBeGreaterThan(bench * 2);
  });

  it("shrinks less as the sample grows, approaching the observed rate", () => {
    const short = buildFeatures([row(1, { starts: 1 }), row(2, { starts: 1 }), row(3, { starts: 1 })], 4, FIXTURE);
    const long = buildFeatures(
      Array.from({ length: 20 }, (_, i) => row(i + 1, { starts: 1 })),
      21,
      FIXTURE,
      { window: 20 },
    );
    expect(long.pStart).toBeGreaterThan(short.pStart);
    expect(long.pStart).toBeLessThanOrEqual(1);
  });

  it("uses the empirical base start rate as the prior", () => {
    expect(BASE_START_RATE).toBeCloseTo(0.28, 2);
    expect(START_PRIOR_WEIGHT).toBe(2);
  });

  it("returns the bare prior when there is no history at all", () => {
    expect(buildFeatures([], 1, FIXTURE).pStart).toBeCloseTo(BASE_START_RATE, 5);
  });
});
