import { describe, expect, it } from "vitest";

import type { FplLive } from "@/lib/fpl/client";
import type { FplBootstrap } from "@/lib/types";
import {
  buildPreDeadlineSnapshot,
  buildSettledSnapshot,
  snapshotKey,
} from "@/lib/backtest/snapshot";

const bs = {
  elements: [
    {
      id: 1,
      element_type: 3,
      team: 2,
      ep_next: "4.5",
      expected_goals_per_90: 0.4,
      expected_assists_per_90: 0.2,
      starts_per_90: 0.9,
      chance_of_playing_next_round: null,
    },
    {
      id: 2,
      element_type: 2,
      team: 3,
      ep_next: "",
      expected_goals_per_90: 0.05,
      expected_assists_per_90: 0.1,
      starts_per_90: 1,
      chance_of_playing_next_round: 75,
    },
  ],
} as unknown as FplBootstrap;

const live = {
  elements: [
    {
      id: 1,
      stats: {
        minutes: 90, starts: 1, bps: 30, bonus: 2, defensive_contribution: 11,
        total_points: 9, expected_goals: 0.3, expected_assists: 0.1,
      },
    },
  ],
} as unknown as FplLive;

describe("snapshotKey", () => {
  it("namespaces by kind and gameweek", () => {
    expect(snapshotKey("pre", 7)).toBe("rs:snapshot:pre:7");
    expect(snapshotKey("settled", 7)).toBe("rs:snapshot:settled:7");
  });
});

describe("buildPreDeadlineSnapshot", () => {
  it("captures FPL's ep_next as a number", () => {
    const snap = buildPreDeadlineSnapshot(bs, 7, "2026-08-28T00:00:00.000Z");
    expect(snap.players[0].epNext).toBeCloseTo(4.5, 5);
  });

  it("records a missing ep_next as 0 rather than NaN", () => {
    const snap = buildPreDeadlineSnapshot(bs, 7, "2026-08-28T00:00:00.000Z");
    expect(snap.players[1].epNext).toBe(0);
  });

  it("preserves a null chance_of_playing rather than coercing it to 0", () => {
    const snap = buildPreDeadlineSnapshot(bs, 7, "2026-08-28T00:00:00.000Z");
    expect(snap.players[0].chanceOfPlaying).toBeNull();
    expect(snap.players[1].chanceOfPlaying).toBe(75);
  });

  it("stamps the gameweek and capture time", () => {
    const snap = buildPreDeadlineSnapshot(bs, 7, "2026-08-28T00:00:00.000Z");
    expect(snap.gw).toBe(7);
    expect(snap.capturedAt).toBe("2026-08-28T00:00:00.000Z");
  });

  it("captures every element", () => {
    expect(buildPreDeadlineSnapshot(bs, 7, "x").players).toHaveLength(2);
  });
});

describe("buildSettledSnapshot", () => {
  it("captures the actuals needed to score a prediction", () => {
    const snap = buildSettledSnapshot(live, 7, "2026-08-28T00:00:00.000Z");
    expect(snap.players[0]).toMatchObject({
      id: 1, minutes: 90, starts: 1, bps: 30, bonus: 2,
      defensiveContribution: 11, totalPoints: 9,
    });
  });

  it("defaults a missing defensive_contribution to 0", () => {
    const older = {
      elements: [{ id: 5, stats: { minutes: 90, starts: 1, bps: 10, bonus: 0, total_points: 3, expected_goals: 0, expected_assists: 0 } }],
    } as unknown as FplLive;
    expect(buildSettledSnapshot(older, 3, "x").players[0].defensiveContribution).toBe(0);
  });
});
