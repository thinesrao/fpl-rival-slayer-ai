// API-Football (v3.football.api-sports.io) integration for confirmed lineups.
// Free tier = 100 requests/day, so every call path goes through a Redis daily
// counter with a hard stop at 90. All functions return null when the key is
// missing or the budget is spent — callers must treat lineups as optional.
//
// World Cup league id = 1. Fixture ids are mapped to FIFA-feed matches by
// kickoff time (±30 min) + team-name similarity, once per day.

import { apiFootballEnabled, env } from "@/lib/env";
import { getRedis, kvGet, kvSet, storeEnabled } from "@/lib/store/redis";
import type { WcMatch } from "@/lib/wc/fifa/types";

const BASE = "https://v3.football.api-sports.io";
const LEAGUE_WORLD_CUP = 1;
const SEASON = 2026;
const DAILY_BUDGET = 90;

function budgetKey(): string {
  return `wc:af:budget:${new Date().toISOString().slice(0, 10)}`;
}

/** Increments the daily counter; false = budget exhausted (or no store to
 *  count with AND key present — without a store we still allow calls but the
 *  Next fetch-cache and permanent lineup caching keep volume tiny). */
async function takeBudget(): Promise<boolean> {
  if (!storeEnabled) return true;
  const r = getRedis();
  if (!r) return true;
  try {
    const n = await r.incr(budgetKey());
    if (n === 1) await r.expire(budgetKey(), 48 * 3600);
    return n <= DAILY_BUDGET;
  } catch {
    return false;
  }
}

async function afFetch<T>(path: string): Promise<T | null> {
  if (!apiFootballEnabled) return null;
  if (!(await takeBudget())) {
    console.warn("[wc/af] daily request budget exhausted — skipping", path);
    return null;
  }
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "x-apisports-key": env.API_FOOTBALL_KEY! },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[wc/af] ${res.status} ${path}`);
      return null;
    }
    const body = (await res.json()) as { response: T; errors: unknown };
    return body.response;
  } catch (err) {
    console.warn("[wc/af] fetch failed", path, err);
    return null;
  }
}

interface AfFixture {
  fixture: { id: number; date: string };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
}

interface FixtureMapEntry {
  afFixtureId: number;
  homeName: string;
  awayName: string;
  date: string;
}

/** wcMatchId → API-Football fixture, refreshed at most daily. */
async function getFixtureMap(matches: Array<{ wcMatch: WcMatch }>): Promise<Map<number, FixtureMapEntry>> {
  const KEY = "wc:af:fixture-map";
  const cached = await kvGet<Record<string, FixtureMapEntry>>(KEY);
  if (cached) return new Map(Object.entries(cached).map(([k, v]) => [Number(k), v]));

  const fixtures = await afFetch<AfFixture[]>(`/fixtures?league=${LEAGUE_WORLD_CUP}&season=${SEASON}`);
  if (!fixtures) return new Map();

  const norm = (s: string | null) =>
    (s ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const map = new Map<number, FixtureMapEntry>();
  for (const { wcMatch } of matches) {
    const kickoff = new Date(wcMatch.date).getTime();
    const candidate = fixtures.find((f) => {
      const dt = Math.abs(new Date(f.fixture.date).getTime() - kickoff);
      if (dt > 30 * 60 * 1000) return false;
      const h = norm(f.teams.home.name);
      const a = norm(f.teams.away.name);
      const wh = norm(wcMatch.homeSquadName);
      const wa = norm(wcMatch.awaySquadName);
      return (
        (h.includes(wh.slice(0, 6)) || wh.includes(h.slice(0, 6))) &&
        (a.includes(wa.slice(0, 6)) || wa.includes(a.slice(0, 6)))
      );
    });
    if (candidate) {
      map.set(wcMatch.id, {
        afFixtureId: candidate.fixture.id,
        homeName: candidate.teams.home.name,
        awayName: candidate.teams.away.name,
        date: candidate.fixture.date,
      });
    }
  }
  await kvSet(KEY, Object.fromEntries(map), 24 * 3600);
  return map;
}

export interface ConfirmedLineup {
  team: string;
  formation: string | null;
  startersNames: string[];
  benchNames: string[];
}

/** Confirmed lineups for a match — fetched only inside the 15–75 min
 *  pre-kickoff window, cached permanently (lineups never change after FT). */
export async function getLineupsIfDue(wcMatch: WcMatch): Promise<ConfirmedLineup[] | null> {
  if (!apiFootballEnabled) return null;
  const cacheKey = `wc:af:lineup:${wcMatch.id}`;
  const cached = await kvGet<ConfirmedLineup[]>(cacheKey);
  if (cached) return cached;

  const minsToKickoff = (new Date(wcMatch.date).getTime() - Date.now()) / 60000;
  const started = wcMatch.period !== "pre_match";
  // Only spend a request when XIs are likely published.
  if (!started && (minsToKickoff > 75 || minsToKickoff < -120)) return null;

  const fixtureMap = await getFixtureMap([{ wcMatch }]);
  const entry = fixtureMap.get(wcMatch.id);
  if (!entry) return null;

  interface AfLineup {
    team: { name: string };
    formation: string | null;
    startXI: Array<{ player: { name: string } }>;
    substitutes: Array<{ player: { name: string } }>;
  }
  const lineups = await afFetch<AfLineup[]>(`/fixtures/lineups?fixture=${entry.afFixtureId}`);
  if (!lineups || lineups.length === 0) return null;

  const result: ConfirmedLineup[] = lineups.map((l) => ({
    team: l.team.name,
    formation: l.formation,
    startersNames: (l.startXI ?? []).map((s) => s.player.name),
    benchNames: (l.substitutes ?? []).map((s) => s.player.name),
  }));
  await kvSet(cacheKey, result); // permanent
  return result;
}

/** Loose surname match: is this fantasy player in the confirmed-lineup names? */
export function nameInLineup(playerName: string, lineupNames: string[]): boolean {
  const surname = playerName.toLowerCase().split(" ").slice(-1)[0];
  if (surname.length < 3) return false;
  return lineupNames.some((n) => n.toLowerCase().includes(surname));
}
