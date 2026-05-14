// Top-N ownership intel across the user's mini-league. Walks page 1 of the
// classic standings, slices the top N entries, fetches their picks for the
// target GW, and aggregates per-player who owns/captains them.
//
// Bounded to N ≤ 25 to keep fan-out manageable. Existing Next fetch cache on
// `getPicks` (CACHE_LIVE: 300s) absorbs the repeated calls cheaply.

import { getLeagueStandings, getPicks } from "@/lib/fpl/client";
import type { FplBootstrap, FplLeagueStandingEntry } from "@/lib/types";

export interface LeagueOwner {
  entryId: number;
  rank: number;
  entryName: string;
  playerName: string;
  total: number;
}

export interface LeagueOwnedPlayer {
  playerId: number;
  webName: string;
  teamShort: string;
  positionShort: string;
  cost: number; // tenths of £m
  selectedByPct: number; // global EO
  // Per top-N manager: how this player appears in their squad.
  occurrences: Array<{
    entryId: number;
    rank: number;
    multiplier: number; // 0 bench, 1 starter, 2 captain, 3 TC
    isCaptain: boolean;
    isVice: boolean;
  }>;
  ownersCount: number;
  startersCount: number;
  captainsCount: number;
  multiplierSum: number; // captainEO proxy
  eoPct: number; // ownersCount / N * 100
  captainEoPct: number; // multiplierSum / N * 100
}

export interface LeagueOwnershipResult {
  leagueName: string;
  gw: number;
  topN: number;
  owners: LeagueOwner[];
  players: LeagueOwnedPlayer[];
}

const POS_SHORT: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

export async function computeLeagueOwnership(
  leagueId: number,
  gw: number,
  bs: FplBootstrap,
  topN = 10,
): Promise<LeagueOwnershipResult> {
  const safeN = Math.max(1, Math.min(25, topN));
  const standings = await getLeagueStandings(leagueId, 1);
  const top = standings.standings.results.slice(0, safeN);

  // Fetch picks in parallel — but if a manager's GW picks aren't available
  // (very early-season or pre-deadline), swallow the 404 and skip them.
  const picksList = await Promise.all(
    top.map((row) => getPicks(row.entry, gw).catch(() => null)),
  );

  const playersById = new Map(bs.elements.map((p) => [p.id, p]));
  const teamsById = new Map(bs.teams.map((t) => [t.id, t]));
  const agg = new Map<number, LeagueOwnedPlayer>();

  for (let i = 0; i < top.length; i++) {
    const row: FplLeagueStandingEntry = top[i];
    const picks = picksList[i];
    if (!picks) continue;
    for (const p of picks.picks) {
      let entry = agg.get(p.element);
      if (!entry) {
        const el = playersById.get(p.element);
        if (!el) continue;
        const team = teamsById.get(el.team);
        entry = {
          playerId: p.element,
          webName: el.web_name,
          teamShort: team?.short_name ?? "?",
          positionShort: POS_SHORT[el.element_type] ?? "?",
          cost: el.now_cost,
          selectedByPct: Number(el.selected_by_percent) || 0,
          occurrences: [],
          ownersCount: 0,
          startersCount: 0,
          captainsCount: 0,
          multiplierSum: 0,
          eoPct: 0,
          captainEoPct: 0,
        };
        agg.set(p.element, entry);
      }
      entry.occurrences.push({
        entryId: row.entry,
        rank: row.rank,
        multiplier: p.multiplier,
        isCaptain: p.is_captain,
        isVice: p.is_vice_captain,
      });
      entry.ownersCount++;
      if (p.multiplier > 0) entry.startersCount++;
      if (p.is_captain) entry.captainsCount++;
      entry.multiplierSum += p.multiplier;
    }
  }

  const denom = Math.max(1, top.length);
  for (const v of agg.values()) {
    v.eoPct = Number(((v.ownersCount / denom) * 100).toFixed(1));
    v.captainEoPct = Number(((v.multiplierSum / denom) * 100).toFixed(1));
  }

  const players = [...agg.values()].sort(
    (a, b) => b.captainEoPct - a.captainEoPct || b.eoPct - a.eoPct,
  );

  const owners: LeagueOwner[] = top.map((row) => ({
    entryId: row.entry,
    rank: row.rank,
    entryName: row.entry_name,
    playerName: row.player_name,
    total: row.total,
  }));

  return { leagueName: standings.league.name, gw, topN: safeN, owners, players };
}
