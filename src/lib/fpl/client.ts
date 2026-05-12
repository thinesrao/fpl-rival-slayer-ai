// Typed client for the public Fantasy Premier League API.
// All endpoints are unauthenticated GETs. We rely on Next.js fetch cache for
// dedupe + revalidation so each route handler call cheaply hits the same data.

import { env } from "@/lib/env";
import type {
  FplBootstrap,
  FplEntry,
  FplFixture,
  FplLeagueStandings,
  FplPicksResponse,
} from "@/lib/types";

const BASE = "https://fantasy.premierleague.com/api";

type CacheOpts = { revalidate: number; tags?: string[] };

const CACHE_FIXTURES: CacheOpts = { revalidate: 3600, tags: ["fpl-fixtures"] };
const CACHE_LIVE: CacheOpts = { revalidate: 300, tags: ["fpl-live"] }; // standings/picks/entry
const CACHE_ELEMENT_SUMMARY: CacheOpts = { revalidate: 900, tags: ["fpl-element-summary"] };

async function fplFetch<T>(path: string, cache: CacheOpts): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { "User-Agent": env.FPL_USER_AGENT, Accept: "application/json" },
    next: { revalidate: cache.revalidate, tags: cache.tags },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new FplError(res.status, `FPL ${res.status} ${path}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// bootstrap-static is ~2.6MB which exceeds Next's 2MB fetch-cache item limit,
// so we keep a per-process in-memory copy with a short TTL instead.
const BOOTSTRAP_TTL_MS = 60 * 60 * 1000;
let bootstrapCache: { at: number; data: FplBootstrap } | null = null;
let bootstrapInflight: Promise<FplBootstrap> | null = null;

export class FplError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "FplError";
  }
}

export async function getBootstrap(): Promise<FplBootstrap> {
  const now = Date.now();
  if (bootstrapCache && now - bootstrapCache.at < BOOTSTRAP_TTL_MS) return bootstrapCache.data;
  if (bootstrapInflight) return bootstrapInflight;
  bootstrapInflight = (async () => {
    const url = `${BASE}/bootstrap-static/`;
    const res = await fetch(url, {
      headers: { "User-Agent": env.FPL_USER_AGENT, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new FplError(res.status, `FPL ${res.status} bootstrap-static: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as FplBootstrap;
    bootstrapCache = { at: Date.now(), data };
    return data;
  })();
  try {
    return await bootstrapInflight;
  } finally {
    bootstrapInflight = null;
  }
}

export function getFixtures(event?: number): Promise<FplFixture[]> {
  const q = event ? `?event=${event}` : "";
  return fplFetch<FplFixture[]>(`/fixtures/${q}`, CACHE_FIXTURES);
}

export function getEntry(teamId: number): Promise<FplEntry> {
  return fplFetch<FplEntry>(`/entry/${teamId}/`, CACHE_LIVE);
}

export interface FplEntryHistory {
  current: Array<{
    event: number;
    points: number;
    total_points: number;
    rank: number;
    overall_rank: number;
    bank: number;
    value: number;
    event_transfers: number;
    event_transfers_cost: number;
    points_on_bench: number;
  }>;
  past: Array<{ season_name: string; total_points: number; rank: number }>;
  chips: Array<{ name: string; time: string; event: number }>;
}

export function getEntryHistory(teamId: number): Promise<FplEntryHistory> {
  return fplFetch<FplEntryHistory>(`/entry/${teamId}/history/`, CACHE_LIVE);
}

export function getPicks(teamId: number, gw: number): Promise<FplPicksResponse> {
  return fplFetch<FplPicksResponse>(`/entry/${teamId}/event/${gw}/picks/`, CACHE_LIVE);
}

export function getLeagueStandings(
  leagueId: number,
  page = 1,
): Promise<FplLeagueStandings> {
  return fplFetch<FplLeagueStandings>(
    `/leagues-classic/${leagueId}/standings/?page_standings=${page}`,
    CACHE_LIVE,
  );
}

export interface FplElementSummary {
  fixtures: Array<{
    id: number;
    event: number | null;
    finished: boolean;
    difficulty: number;
    is_home: boolean;
    team_h: number;
    team_a: number;
  }>;
  history: Array<{
    element: number;
    fixture: number;
    opponent_team: number;
    total_points: number;
    minutes: number;
    round: number;
    was_home: boolean;
  }>;
}

export function getElementSummary(playerId: number): Promise<FplElementSummary> {
  return fplFetch<FplElementSummary>(`/element-summary/${playerId}/`, CACHE_ELEMENT_SUMMARY);
}

// Convenience selectors -------------------------------------------------------

export function currentEvent(bs: FplBootstrap) {
  return bs.events.find((e) => e.is_current) ?? bs.events.find((e) => !e.finished) ?? bs.events[0];
}

export function nextEvent(bs: FplBootstrap) {
  return (
    bs.events.find((e) => e.is_next) ??
    bs.events.find((e) => !e.finished && !e.is_current) ??
    currentEvent(bs)
  );
}

export function targetEvent(bs: FplBootstrap) {
  // The GW we are recommending FOR — the next un-deadlined one if available,
  // else the current GW (which is still running).
  const next = bs.events.find((e) => e.is_next);
  if (next) return next;
  const cur = bs.events.find((e) => e.is_current);
  if (cur && !cur.finished) return cur;
  return nextEvent(bs);
}

export function previousEvent(bs: FplBootstrap) {
  return bs.events.find((e) => e.is_previous) ?? null;
}
