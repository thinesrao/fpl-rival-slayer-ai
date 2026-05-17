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

// Browser-like headers — FPL's bot filter 403s anything that looks
// like a generic HTTP client. Keep the set tight: UA + the common
// browser navigation headers a Chrome request would include.
function fplHeaders(): HeadersInit {
  return {
    "User-Agent": env.FPL_USER_AGENT,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-GB,en;q=0.9",
    Referer: "https://fantasy.premierleague.com/",
    Origin: "https://fantasy.premierleague.com",
  };
}

function explain403(path: string, body: string): string {
  return (
    `FPL 403 ${path}: blocked by upstream bot filter. ` +
    `Override FPL_USER_AGENT with a current Chrome UA, or check that the ` +
    `host IP isn't on a known data-centre block list. Body: ${body.slice(0, 120)}`
  );
}

async function fplFetch<T>(path: string, cache: CacheOpts): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: fplHeaders(),
    next: { revalidate: cache.revalidate, tags: cache.tags },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 403) throw new FplError(403, explain403(path, text));
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

export function bustBootstrap(): void {
  bootstrapCache = null;
}

export async function getBootstrap(): Promise<FplBootstrap> {
  const now = Date.now();
  if (bootstrapCache && now - bootstrapCache.at < BOOTSTRAP_TTL_MS) return bootstrapCache.data;
  if (bootstrapInflight) return bootstrapInflight;
  bootstrapInflight = (async () => {
    const url = `${BASE}/bootstrap-static/`;
    const res = await fetch(url, {
      headers: fplHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 403) throw new FplError(403, explain403("/bootstrap-static/", text));
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

export interface FplLiveElement {
  id: number;
  stats: {
    minutes: number;
    goals_scored: number;
    assists: number;
    clean_sheets: number;
    goals_conceded: number;
    own_goals: number;
    penalties_saved: number;
    penalties_missed: number;
    yellow_cards: number;
    red_cards: number;
    saves: number;
    bonus: number;
    bps: number;
    influence: string;
    creativity: string;
    threat: string;
    ict_index: string;
    total_points: number;
    in_dreamteam: boolean;
    /** 25/26+ FPL stat (CBI + tackles + recoveries). Absent on older seasons. */
    defensive_contribution?: number;
  };
}

export interface FplLive {
  elements: FplLiveElement[];
}

const CACHE_LIVE_GW: CacheOpts = { revalidate: 60, tags: ["fpl-live-gw"] }; // refreshes every minute

export function getLive(gw: number): Promise<FplLive> {
  return fplFetch<FplLive>(`/event/${gw}/live/`, CACHE_LIVE_GW);
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

export function previousFinishedEvent(bs: FplBootstrap) {
  // The most recent fully-finished GW (data settled), used for retrospectives.
  return [...bs.events].reverse().find((e) => e.finished) ?? null;
}

export function gameweekStatus(bs: FplBootstrap) {
  const cur = currentEvent(bs);
  const inProgress = cur.is_current && !cur.finished;
  const deadlinePassed = Date.now() >= new Date(cur.deadline_time).getTime();
  return {
    gw: cur.id,
    deadlineIso: cur.deadline_time,
    inProgress,
    deadlinePassed,
    finished: cur.finished,
  };
}
