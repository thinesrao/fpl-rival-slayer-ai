// Typed client for the official FIFA World Cup 2026™ Fantasy public feed.
// All three endpoints are unauthenticated GETs. As tournament traffic grew,
// FIFA's CDN (Akamai) began intermittently 403'ing data-centre egress IPs
// like Vercel's — the same bot-filter problem the FPL client documents. We
// defend with browser-like headers AND a Redis "last known good" snapshot:
// every successful fetch is persisted, and any 403/network failure falls back
// to that copy (the feed is global — identical for all users — so a slightly
// stale shared copy is far better than a 502).

import { kvGet, kvSet } from "@/lib/store/redis";
import type { WcPlayer, WcRound } from "./types";

const BASE = "https://play.fifa.com/json/fantasy";

// A fuller browser header set than a bare UA — Akamai's bot filter scores
// requests on the whole header shape, not just User-Agent.
const HEADERS: HeadersInit = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: "https://play.fifa.com/fantasy/",
  Origin: "https://play.fifa.com",
};

const LAST_GOOD_PLAYERS = "wc:lastgood:players";
const LAST_GOOD_ROUNDS = "wc:lastgood:rounds";

export class WcFeedError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "WcFeedError";
  }
}

interface MemCache<T> {
  at: number;
  data: T;
}

let playersCache: MemCache<WcPlayer[]> | null = null;
let playersInflight: Promise<WcPlayer[]> | null = null;
let roundsCache: MemCache<WcRound[]> | null = null;
const PLAYERS_TTL_MS = 60 * 1000;
const ROUNDS_TTL_MS = 90 * 1000;

export function bustWcPlayers(): void {
  playersCache = null;
}

export async function getWcPlayers(): Promise<WcPlayer[]> {
  const now = Date.now();
  if (playersCache && now - playersCache.at < PLAYERS_TTL_MS) return playersCache.data;
  if (playersInflight) return playersInflight;
  playersInflight = (async () => {
    try {
      const res = await fetch(`${BASE}/players.json`, { headers: HEADERS, cache: "no-store" });
      if (!res.ok) throw new WcFeedError(res.status, `players.json ${res.status}`);
      const data = (await res.json()) as WcPlayer[];
      playersCache = { at: Date.now(), data };
      void kvSet(LAST_GOOD_PLAYERS, data); // shared durable fallback
      return data;
    } catch (err) {
      const fallback = await loadFallback<WcPlayer[]>(playersCache, LAST_GOOD_PLAYERS);
      if (fallback) return fallback;
      throw asFeedError(err, "players.json");
    }
  })();
  try {
    return await playersInflight;
  } finally {
    playersInflight = null;
  }
}

export async function getWcRounds(): Promise<WcRound[]> {
  const now = Date.now();
  if (roundsCache && now - roundsCache.at < ROUNDS_TTL_MS) return roundsCache.data;
  try {
    const res = await fetch(`${BASE}/rounds.json`, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) throw new WcFeedError(res.status, `rounds.json ${res.status}`);
    const data = (await res.json()) as WcRound[];
    roundsCache = { at: Date.now(), data };
    void kvSet(LAST_GOOD_ROUNDS, data);
    return data;
  } catch (err) {
    const fallback = await loadFallback<WcRound[]>(roundsCache, LAST_GOOD_ROUNDS);
    if (fallback) return fallback;
    throw asFeedError(err, "rounds.json");
  }
}

/** Prefer the in-process cache (even if past its TTL) over a Redis round-trip,
 *  then fall back to the durable last-known-good copy. */
async function loadFallback<T>(mem: MemCache<T> | null, redisKey: string): Promise<T | null> {
  if (mem) return mem.data;
  return kvGet<T>(redisKey);
}

function asFeedError(err: unknown, file: string): WcFeedError {
  if (err instanceof WcFeedError) return err;
  return new WcFeedError(502, `FIFA feed ${file}: ${err instanceof Error ? err.message : String(err)}`);
}

// Convenience selectors ------------------------------------------------------

/** The round currently in play, if any. */
export function activeRound(rounds: WcRound[]): WcRound | null {
  return rounds.find((r) => r.status !== "scheduled" && r.status !== "complete") ?? null;
}

/** The next round that hasn't started (by feed status, then by lock time). */
export function nextScheduledRound(rounds: WcRound[]): WcRound | null {
  const byStatus = rounds.find((r) => r.status === "scheduled");
  if (byStatus) return byStatus;
  const now = Date.now();
  return rounds.find((r) => new Date(r.startDate).getTime() > now) ?? null;
}

/** The round we plan FOR: the live one while it's in play (mid-round captain
 *  moves and bench subs are this game's biggest edge), else the next
 *  scheduled, else the last round (tournament over). */
export function targetRound(rounds: WcRound[]): WcRound {
  return activeRound(rounds) ?? nextScheduledRound(rounds) ?? rounds[rounds.length - 1];
}

/** A round "locks" when its first match kicks off. */
export function roundLockTime(round: WcRound): Date {
  const dates = round.tournaments.map((m) => new Date(m.date).getTime());
  const earliest = dates.length ? Math.min(...dates) : new Date(round.startDate).getTime();
  return new Date(earliest);
}

export function displayName(p: WcPlayer): string {
  return p.knownName || [p.firstName, p.lastName].filter(Boolean).join(" ") || `#${p.id}`;
}

/** Points a player scored in a given round. Handles both feed shapes: an
 *  empty array pre-tournament and a {"<roundId>": pts} dict once live. */
export function roundPointsFor(p: WcPlayer, roundId: number): number | null {
  const rp = p.stats.roundPoints;
  if (Array.isArray(rp)) return rp[roundId - 1] ?? null;
  const v = rp?.[String(roundId)];
  return typeof v === "number" ? v : null;
}

/** A round is in progress the moment it's neither waiting nor finished —
 *  the live feed uses "playing" (not "active"). */
export function roundInProgress(round: Pick<WcRound, "status">): boolean {
  return round.status !== "scheduled" && round.status !== "complete";
}
