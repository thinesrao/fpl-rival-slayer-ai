import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { FplError } from "@/lib/fpl/client";
import type { FplBootstrap, FplEntry, FplPicksResponse } from "@/lib/types";

const { getBootstrap, getEntry, getEntryHistory, getPicks } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  getEntry: vi.fn(),
  getEntryHistory: vi.fn(),
  getPicks: vi.fn(),
}));

vi.mock("@/lib/fpl/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fpl/client")>();
  return { ...actual, getBootstrap, getEntry, getEntryHistory, getPicks };
});

const { GET } = await import("./route");

const SQUAD = [
  [1, 1], [2, 1], // GKP
  [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], // DEF
  [8, 3], [9, 3], [10, 3], [11, 3], [12, 3], // MID
  [13, 4], [14, 4], [15, 4], // FWD
] as const;

function bootstrap(): FplBootstrap {
  return {
    events: [
      { id: 3, deadline_time: "2026-09-04T17:30:00Z", is_current: true, is_next: false, finished: true },
      { id: 4, deadline_time: "2026-09-12T12:30:00Z", is_current: false, is_next: true, finished: false },
    ],
    elements: SQUAD.map(([id, et]) => ({
      id,
      web_name: `P${id}`,
      element_type: et,
      now_cost: 50,
    })),
    teams: [],
  } as unknown as FplBootstrap;
}

function picksFor(event: number, bank: number): FplPicksResponse {
  return {
    active_chip: null,
    entry_history: { event, bank },
    picks: SQUAD.map(([id], i) => ({
      element: id,
      position: i + 1,
      multiplier: i < 11 ? 1 : 0,
      is_captain: i === 7,
      is_vice_captain: i === 12,
    })),
  } as unknown as FplPicksResponse;
}

const request = () => new NextRequest("http://localhost/api/my-squad-draft-seed?teamId=1");

afterEach(() => vi.clearAllMocks());

describe("GET /api/my-squad-draft-seed", () => {
  it("rejects a missing teamId", async () => {
    const res = await GET(new NextRequest("http://localhost/api/my-squad-draft-seed"));
    expect(res.status).toBe(400);
  });

  it("seeds a squad from the latest published picks", async () => {
    getBootstrap.mockResolvedValue(bootstrap());
    getPicks.mockResolvedValue(picksFor(3, 7));
    getEntry.mockResolvedValue({ last_deadline_bank: 12 } as FplEntry);
    getEntryHistory.mockResolvedValue(null);

    const body = await (await GET(request())).json();
    expect(body.picks).toHaveLength(15);
    expect(body.startingXI).toHaveLength(11);
    expect(body.bank).toBe(12);
    expect(body.squadValue).toBe(15 * 50);
    expect(body.budget).toBe(12 + 15 * 50);
  });

  it("still seeds when FPL is mid-update and the entry lookup 503s", async () => {
    // After a deadline FPL answers /entry/{id}/ with "The game is being
    // updated." for a while. The picks carry the same bank figure, so this
    // must not fail the request — it did, and took the Drafts tab down.
    getBootstrap.mockResolvedValue(bootstrap());
    getPicks.mockResolvedValue(picksFor(3, 9));
    getEntry.mockRejectedValue(new FplError(503, "The game is being updated."));
    getEntryHistory.mockRejectedValue(new FplError(503, "The game is being updated."));

    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bank).toBe(9);
    expect(body.budget).toBe(9 + 15 * 50);
  });

  it("falls back a gameweek when the newest one 503s", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-12T12:35:00Z"));
    getBootstrap.mockResolvedValue(bootstrap());
    getPicks.mockImplementation(async (_id: number, gw: number) => {
      if (gw === 4) throw new FplError(503, "The game is being updated.");
      return picksFor(3, 4);
    });
    getEntry.mockResolvedValue({ last_deadline_bank: null } as unknown as FplEntry);
    getEntryHistory.mockResolvedValue(null);

    const res = await GET(request());
    expect(res.status).toBe(200);
    expect((await res.json()).gw).toBe(3);
    vi.restoreAllMocks();
  });

  it("surfaces an FPL failure when no gameweek can be read at all", async () => {
    getBootstrap.mockResolvedValue(bootstrap());
    getPicks.mockRejectedValue(new FplError(503, "The game is being updated."));
    getEntry.mockResolvedValue({ last_deadline_bank: 0 } as FplEntry);
    getEntryHistory.mockResolvedValue(null);

    const res = await GET(request());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("fpl_error");
  });
});
