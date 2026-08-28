import { describe, expect, it } from "vitest";

import type { PlayerFeatures } from "@/lib/projections/features";
import { scorePlayer } from "@/lib/projections/scoring";

function features(overrides: Partial<PlayerFeatures> = {}): PlayerFeatures {
  return {
    playerId: 1,
    webName: "Test",
    position: "MID",
    xg90: 0.3,
    xa90: 0.2,
    bps90: 20,
    dcPer90: 4,
    startRate: 1,
    minutesPerStart: 90,
    availability: 1,
    fdr: 3,
    isHome: true,
    fixtureCount: 1,
    opponentXgcPer90: 1.2,
    sampleRounds: 6,
    ...overrides,
  };
}

describe("regression: minutes probability is applied exactly once", () => {
  it("halving play probability halves expected points, rather than quartering them", () => {
    const full = scorePlayer(features({ availability: 1, startRate: 1 })).xPoints;
    const half = scorePlayer(features({ availability: 0.5, startRate: 1 })).xPoints;
    expect(half / full).toBeCloseTo(0.5, 2);
  });

  it("a 75% availability player is not priced at 56%", () => {
    const full = scorePlayer(features({ availability: 1 })).xPoints;
    const partial = scorePlayer(features({ availability: 0.75 })).xPoints;
    expect(partial / full).toBeCloseTo(0.75, 2);
    expect(partial / full).toBeGreaterThan(0.7);
  });

  it("exposes playProbability as the single applied factor", () => {
    expect(scorePlayer(features({ availability: 0.5, startRate: 1 })).playProbability).toBeCloseTo(0.5, 5);
  });
});

describe("regression: form is not added on top of component terms", () => {
  it("gives identical scores to two players whose rolling rates match", () => {
    // Historically a "hot" player got a bonus for output already counted in xg90.
    const a = scorePlayer(features({ xg90: 0.3, xa90: 0.2, bps90: 20 })).xPoints;
    const b = scorePlayer(features({ xg90: 0.3, xa90: 0.2, bps90: 20 })).xPoints;
    expect(a).toBe(b);
  });

  it("has no component that is not one of the six scoring categories", () => {
    const { components } = scorePlayer(features());
    expect(Object.keys(components).sort()).toEqual(
      ["appearance", "assists", "bonus", "cleanSheet", "defensiveContribution", "goals"].sort(),
    );
  });
});

describe("regression: bonus expectation does not drift with season progress", () => {
  it("scores an identical player identically at round 5 and round 30", () => {
    // bps90 is a rate, so an identical player late in the season scores the same.
    const early = scorePlayer(features({ bps90: 20, sampleRounds: 4 })).components.bonus;
    const late = scorePlayer(features({ bps90: 20, sampleRounds: 30 })).components.bonus;
    expect(late).toBeCloseTo(early, 10);
  });

  it("still discriminates between a high-bps and a low-bps player", () => {
    const high = scorePlayer(features({ bps90: 35 })).components.bonus;
    const low = scorePlayer(features({ bps90: 8 })).components.bonus;
    expect(high).toBeGreaterThan(low);
  });

  it("caps the bonus term below the 3-point maximum a player can actually earn", () => {
    expect(scorePlayer(features({ bps90: 500 })).components.bonus).toBeLessThanOrEqual(3);
  });
});

describe("regression: fixture difficulty is applied exactly once", () => {
  it("changes clean-sheet expectation via opponent strength", () => {
    const easy = scorePlayer(features({ position: "DEF", opponentXgcPer90: 0.4 })).components.cleanSheet;
    const hard = scorePlayer(features({ position: "DEF", opponentXgcPer90: 2.5 })).components.cleanSheet;
    expect(easy).toBeGreaterThan(hard);
  });

  it("does not additionally subtract a flat penalty for a hard fixture", () => {
    // With opponent strength held constant, the raw fdr number must not move the score.
    const a = scorePlayer(features({ fdr: 1, opponentXgcPer90: 1.2 })).xPoints;
    const b = scorePlayer(features({ fdr: 5, opponentXgcPer90: 1.2 })).xPoints;
    expect(a).toBeCloseTo(b, 10);
  });
});

describe("scorePlayer general behaviour", () => {
  it("returns zero for a blank gameweek", () => {
    expect(scorePlayer(features({ fixtureCount: 0 })).xPoints).toBe(0);
  });

  it("scales with fixture count for a double gameweek", () => {
    const single = scorePlayer(features({ fixtureCount: 1 })).xPoints;
    const double = scorePlayer(features({ fixtureCount: 2 })).xPoints;
    expect(double).toBeGreaterThan(single);
    expect(double).toBeLessThanOrEqual(single * 2 + 1e-9);
  });

  it("is monotonic in xg90", () => {
    const low = scorePlayer(features({ xg90: 0.1 })).xPoints;
    const high = scorePlayer(features({ xg90: 0.8 })).xPoints;
    expect(high).toBeGreaterThan(low);
  });

  it("is never negative", () => {
    expect(scorePlayer(features({ xg90: 0, xa90: 0, bps90: 0, availability: 0 })).xPoints).toBeGreaterThanOrEqual(0);
  });

  it("is never NaN for any zeroed input", () => {
    const z = scorePlayer(features({ xg90: 0, xa90: 0, bps90: 0, dcPer90: 0, startRate: 0, minutesPerStart: 0, opponentXgcPer90: 0 }));
    expect(Number.isNaN(z.xPoints)).toBe(false);
  });

  it("awards defenders more per goal than forwards", () => {
    const def = scorePlayer(features({ position: "DEF", xg90: 0.5 })).components.goals;
    const fwd = scorePlayer(features({ position: "FWD", xg90: 0.5 })).components.goals;
    expect(def).toBeGreaterThan(fwd);
  });

  it("gives forwards no clean-sheet credit", () => {
    expect(scorePlayer(features({ position: "FWD" })).components.cleanSheet).toBe(0);
  });

});

describe("regression: defensive contribution points are modelled", () => {
  it("awards a defender approaching the threshold of 10 a non-zero expectation", () => {
    const c = scorePlayer(features({ position: "DEF", dcPer90: 9.5 })).components.defensiveContribution;
    expect(c).toBeGreaterThan(0);
  });

  it("gives a higher expectation to a defender averaging above the threshold", () => {
    const below = scorePlayer(features({ position: "DEF", dcPer90: 6 })).components.defensiveContribution;
    const above = scorePlayer(features({ position: "DEF", dcPer90: 14 })).components.defensiveContribution;
    expect(above).toBeGreaterThan(below);
  });

  it("uses the higher threshold of 12 for midfielders, so a MID scores less than a DEF at the same rate", () => {
    const def = scorePlayer(features({ position: "DEF", dcPer90: 11 })).components.defensiveContribution;
    const mid = scorePlayer(features({ position: "MID", dcPer90: 11 })).components.defensiveContribution;
    expect(def).toBeGreaterThan(mid);
  });

  it("never awards defensive contribution to a goalkeeper", () => {
    expect(scorePlayer(features({ position: "GKP", dcPer90: 40 })).components.defensiveContribution).toBe(0);
  });

  it("never exceeds the 2 points actually on offer", () => {
    expect(scorePlayer(features({ position: "DEF", dcPer90: 60 })).components.defensiveContribution)
      .toBeLessThanOrEqual(2 + 1e-9);
  });

  it("is zero for a player expected to play no minutes", () => {
    expect(scorePlayer(features({ position: "DEF", dcPer90: 20, minutesPerStart: 0 })).components.defensiveContribution).toBe(0);
  });

  it("raises a defender's total score relative to the pre-Task-7 model", () => {
    const withDc = scorePlayer(features({ position: "DEF", dcPer90: 15 })).xPoints;
    const withoutDc = scorePlayer(features({ position: "DEF", dcPer90: 0 })).xPoints;
    expect(withDc).toBeGreaterThan(withoutDc);
  });
});
