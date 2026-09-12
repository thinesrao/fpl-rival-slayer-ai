// The most recent squad the public API will actually serve.
//
// `/entry/{id}/event/{gw}/picks/` 404s until that gameweek's deadline has
// passed, so "latest" is a small search rather than a lookup: ask for the
// next gameweek whenever the clock says its deadline is behind us (FPL can
// lag on flipping `is_current`), and fall back to the current one.
//
// Shared by the drafts seed and the wildcard optimiser, which both need the
// same starting point: what the manager owns and what it is worth.

import { FplError, currentEvent, getPicks, nextEvent } from "./client";
import type { FplBootstrap, FplPicksResponse } from "@/lib/types";

/** Gameweeks to try, newest first. */
export function candidateGameweeks(bs: FplBootstrap, now = Date.now()): number[] {
  const current = currentEvent(bs);
  const next = nextEvent(bs);
  const gws: number[] = [];
  if (next && now >= new Date(next.deadline_time).getTime()) gws.push(next.id);
  if (current) gws.push(current.id);
  return gws.length > 0 ? [...new Set(gws)] : [1];
}

export interface LatestPicks {
  gw: number;
  picks: FplPicksResponse;
}

export async function loadLatestPicks(teamId: number, bs: FplBootstrap): Promise<LatestPicks> {
  const candidates = candidateGameweeks(bs);
  let lastError: unknown = null;
  for (const gw of candidates) {
    try {
      return { gw, picks: await getPicks(teamId, gw) };
    } catch (err) {
      // Every candidate but the last is a guess that the newer gameweek has
      // published, so ANY failure on one falls through to the older one — not
      // just a 404. In the minutes after a deadline FPL answers this endpoint
      // with 503 "The game is being updated." while it settles, and treating
      // that as fatal took the drafts seed and the wildcard optimiser down
      // during exactly the window managers are looking at them.
      lastError = err;
    }
  }
  throw lastError ?? new FplError(404, `No published picks for team ${teamId}.`);
}
