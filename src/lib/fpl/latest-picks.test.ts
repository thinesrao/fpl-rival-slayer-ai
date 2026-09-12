import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateGameweeks, loadLatestPicks } from "./latest-picks";
import { FplError } from "./client";
import * as client from "./client";
import type { FplBootstrap, FplPicksResponse } from "@/lib/types";

const DEADLINE_GW4 = "2026-09-12T12:30:00Z";
const BEFORE = Date.parse("2026-09-12T08:00:00Z");
const AFTER = Date.parse("2026-09-12T12:35:00Z");

function bootstrap(): FplBootstrap {
  return {
    events: [
      { id: 3, deadline_time: "2026-09-04T17:30:00Z", is_current: true, is_next: false, finished: true },
      { id: 4, deadline_time: DEADLINE_GW4, is_current: false, is_next: true, finished: false },
    ],
  } as unknown as FplBootstrap;
}

function picks(event: number): FplPicksResponse {
  return { active_chip: null, entry_history: { event, bank: 0 }, picks: [] } as unknown as FplPicksResponse;
}

afterEach(() => vi.restoreAllMocks());

describe("candidateGameweeks", () => {
  it("asks only for the current gameweek before the next deadline", () => {
    expect(candidateGameweeks(bootstrap(), BEFORE)).toEqual([3]);
  });

  it("tries the next gameweek first once its deadline has passed", () => {
    expect(candidateGameweeks(bootstrap(), AFTER)).toEqual([4, 3]);
  });

  it("falls back to gameweek 1 when there are no events at all", () => {
    expect(candidateGameweeks({ events: [] } as unknown as FplBootstrap)).toEqual([1]);
  });
});

describe("loadLatestPicks", () => {
  it("returns the newest gameweek that has published", async () => {
    vi.spyOn(client, "getPicks").mockImplementation(async (_id, gw) => picks(gw));
    vi.spyOn(Date, "now").mockReturnValue(AFTER);

    const result = await loadLatestPicks(1, bootstrap());
    expect(result.gw).toBe(4);
  });

  it("falls back a gameweek when the newest 404s as unpublished", async () => {
    vi.spyOn(client, "getPicks").mockImplementation(async (_id, gw) => {
      if (gw === 4) throw new FplError(404, "Not found.");
      return picks(gw);
    });
    vi.spyOn(Date, "now").mockReturnValue(AFTER);

    const result = await loadLatestPicks(1, bootstrap());
    expect(result.gw).toBe(3);
  });

  it("falls back a gameweek when FPL is mid-update and 503s", async () => {
    // FPL answers "The game is being updated." for minutes after a deadline.
    // Treating that as fatal took down the drafts seed and the wildcard
    // optimiser during exactly the window managers use them.
    vi.spyOn(client, "getPicks").mockImplementation(async (_id, gw) => {
      if (gw === 4) throw new FplError(503, 'FPL 503: "The game is being updated."');
      return picks(gw);
    });
    vi.spyOn(Date, "now").mockReturnValue(AFTER);

    const result = await loadLatestPicks(1, bootstrap());
    expect(result.gw).toBe(3);
  });

  it("falls back on a non-FplError too", async () => {
    vi.spyOn(client, "getPicks").mockImplementation(async (_id, gw) => {
      if (gw === 4) throw new TypeError("fetch failed");
      return picks(gw);
    });
    vi.spyOn(Date, "now").mockReturnValue(AFTER);

    const result = await loadLatestPicks(1, bootstrap());
    expect(result.gw).toBe(3);
  });

  it("surfaces the error when every candidate fails", async () => {
    vi.spyOn(client, "getPicks").mockImplementation(async () => {
      throw new FplError(503, "The game is being updated.");
    });
    vi.spyOn(Date, "now").mockReturnValue(AFTER);

    await expect(loadLatestPicks(1, bootstrap())).rejects.toThrow(/being updated/);
  });

  it("reports the last failure, not the optimistic first one", async () => {
    vi.spyOn(client, "getPicks").mockImplementation(async (_id, gw) => {
      throw new FplError(gw === 4 ? 503 : 404, gw === 4 ? "mid-update" : "no such team");
    });
    vi.spyOn(Date, "now").mockReturnValue(AFTER);

    await expect(loadLatestPicks(1, bootstrap())).rejects.toThrow(/no such team/);
  });
});
