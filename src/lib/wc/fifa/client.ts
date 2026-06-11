// Typed client for the official FIFA World Cup 2026™ Fantasy public feed.
// All three endpoints are unauthenticated GETs served from S3/CloudFront.
// players.json is ~1.1MB — close enough to Next's 2MB fetch-cache item limit
// (and growing as rounds complete) that we keep a per-process in-memory copy,
// mirroring the FPL bootstrap pattern in src/lib/fpl/client.ts.

import type { WcPlayer, WcRound } from "./types";

const BASE = "https://play.fifa.com/json/fantasy";

const HEADERS: HeadersInit = {
  Accept: "application/json, text/plain, */*",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

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
const PLAYERS_TTL_MS = 60 * 1000;

export function bustWcPlayers(): void {
  playersCache = null;
}

export async function getWcPlayers(): Promise<WcPlayer[]> {
  const now = Date.now();
  if (playersCache && now - playersCache.at < PLAYERS_TTL_MS) return playersCache.data;
  if (playersInflight) return playersInflight;
  playersInflight = (async () => {
    const res = await fetch(`${BASE}/players.json`, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new WcFeedError(res.status, `FIFA feed ${res.status} players.json: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as WcPlayer[];
    playersCache = { at: Date.now(), data };
    return data;
  })();
  try {
    return await playersInflight;
  } finally {
    playersInflight = null;
  }
}

export async function getWcRounds(): Promise<WcRound[]> {
  const res = await fetch(`${BASE}/rounds.json`, {
    headers: HEADERS,
    next: { revalidate: 120, tags: ["wc-rounds"] },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new WcFeedError(res.status, `FIFA feed ${res.status} rounds.json: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as WcRound[];
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
