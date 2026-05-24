// Player detail composer for the Pitch tab's player modal.
//
// Joins this GW's live stats + season-cumulative bootstrap fields + per-GW
// element history + upcoming fixtures + per-league ownership into a single
// payload. The UI consumes this via /api/player-detail and renders the modal
// that mirrors FPL Pulse's player-detail card.

import type { FplBootstrap } from "@/lib/types";
import {
  getBootstrap,
  getElementSummary,
  getLive,
  getFixtures,
  currentEvent,
} from "./client";
import { computeLeagueOwnership } from "@/lib/intel/league-ownership";

export interface PlayerDetailGwStats {
  /** Opponent + venue, e.g. "NFO (H)". Null on blank GW. */
  fixtureLabel: string | null;
  minutes: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  defContributions: number;
  bonus: number;
  bps: number;
  totalPoints: number;
}

export interface PlayerDetailSeasonStats {
  startsLeaguePct: number; // (starts / finished_GWs) × 100
  startsEffectivePct: number; // (starts + 0.5 × (appearances - starts)) / finished_GWs × 100
  ownedLeaguePct: number | null; // % of top-N league managers who own; null when leagueId not supplied
  ownedLeagueDenominator: number; // the N used (e.g. 10)
  ownedOverallPct: number; // FPL global selected_by_percent
  pricePoundsMillions: number; // £m
  totalPoints: number;
}

export interface PlayerDetailHistoryEntry {
  gw: number;
  opp: string; // "BRE (H)"
  minutes: number;
  totalPoints: number;
}

export interface PlayerDetailUpcomingEntry {
  gw: number;
  opp: string;
  difficulty: number; // 1..5 FDR
}

export interface PlayerDetailOwnerEntry {
  entryId: number;
  entryName: string;
  rank: number;
  isCaptain: boolean;
}

export interface PlayerDetail {
  player: {
    id: number;
    code: number;
    webName: string;
    fullName: string;
    teamShort: string;
    teamName: string;
    teamCode: number;
    position: "GKP" | "DEF" | "MID" | "FWD";
    elementType: 1 | 2 | 3 | 4;
  };
  gw: number;
  gwStats: PlayerDetailGwStats;
  season: PlayerDetailSeasonStats;
  history: PlayerDetailHistoryEntry[]; // last 3 finished GWs
  upcoming: PlayerDetailUpcomingEntry[]; // next 3
  ownersInLeague: PlayerDetailOwnerEntry[]; // top-N league managers who own
}

const POS_BY_ID: Record<number, "GKP" | "DEF" | "MID" | "FWD"> = {
  1: "GKP",
  2: "DEF",
  3: "MID",
  4: "FWD",
};

function opponentLabel(
  fixtureTeamH: number,
  fixtureTeamA: number,
  playerTeam: number,
  bs: FplBootstrap,
): string {
  const isHome = fixtureTeamH === playerTeam;
  const opp = bs.teams.find((t) => t.id === (isHome ? fixtureTeamA : fixtureTeamH));
  return `${opp?.short_name ?? "?"} (${isHome ? "H" : "A"})`;
}

interface BuildArgs {
  playerId: number;
  teamId?: number;
  leagueId?: number;
  gw?: number;
}

export async function buildPlayerDetail(args: BuildArgs): Promise<PlayerDetail> {
  const bs = await getBootstrap();
  const targetGw = args.gw ?? currentEvent(bs)?.id ?? 1;

  const player = bs.elements.find((e) => e.id === args.playerId);
  if (!player) throw new Error(`Player ${args.playerId} not found in bs.elements`);
  const team = bs.teams.find((t) => t.id === player.team);

  // Fetch in parallel: live (this GW), per-player season summary, this GW
  // fixtures, league ownership (top 10) when leagueId is supplied.
  const [live, elementSummary, fixturesThisGw, ownershipMap] = await Promise.all([
    getLive(targetGw).catch(() => null),
    getElementSummary(player.id).catch(() => null),
    getFixtures(targetGw).catch(() => []),
    args.leagueId
      ? computeLeagueOwnership(args.leagueId, targetGw, bs, 10).catch(() => null)
      : Promise.resolve(null),
  ]);

  const liveEl = live?.elements.find((e) => e.id === player.id);
  const playerFixture = (fixturesThisGw ?? []).find(
    (f) => f.team_h === player.team || f.team_a === player.team,
  );
  const gwStats: PlayerDetailGwStats = {
    fixtureLabel: playerFixture ? opponentLabel(playerFixture.team_h, playerFixture.team_a, player.team, bs) : null,
    minutes: liveEl?.stats.minutes ?? 0,
    goals: liveEl?.stats.goals_scored ?? 0,
    assists: liveEl?.stats.assists ?? 0,
    cleanSheets: liveEl?.stats.clean_sheets ?? 0,
    defContributions: liveEl?.stats.defensive_contribution ?? 0,
    bonus: liveEl?.stats.bonus ?? 0,
    bps: liveEl?.stats.bps ?? 0,
    totalPoints: liveEl?.stats.total_points ?? 0,
  };

  // Season aggregates from bootstrap + history.
  const finishedEvents = bs.events.filter((e) => e.finished).length || 1;
  const history = elementSummary?.history ?? [];
  const playedHistory = history.filter((h) => h.minutes > 0);
  const startedCount = history.filter((h) => h.minutes >= 60).length;
  const appearancesCount = playedHistory.length;
  const startsLeaguePct = (startedCount / finishedEvents) * 100;
  // FPL "effective" appearances counts cameos at 0.5 weight — we mirror that.
  const startsEffectivePct = ((startedCount + 0.5 * Math.max(0, appearancesCount - startedCount)) / finishedEvents) * 100;

  let ownedLeaguePct: number | null = null;
  if (ownershipMap) {
    const row = ownershipMap.players.find((p) => p.playerId === player.id);
    ownedLeaguePct = row?.eoPct ?? 0;
  }

  const season: PlayerDetailSeasonStats = {
    startsLeaguePct: Number(startsLeaguePct.toFixed(1)),
    startsEffectivePct: Number(startsEffectivePct.toFixed(1)),
    ownedLeaguePct: ownedLeaguePct === null ? null : Number(ownedLeaguePct.toFixed(1)),
    ownedLeagueDenominator: ownershipMap?.topN ?? 10,
    ownedOverallPct: Number(player.selected_by_percent) || 0,
    pricePoundsMillions: Number((player.now_cost / 10).toFixed(1)),
    totalPoints: player.total_points,
  };

  // Recent history — last 3 GWs that have data.
  const recent = [...history]
    .sort((a, b) => b.round - a.round)
    .slice(0, 3)
    .reverse()
    .map((h) => {
      const opp = bs.teams.find((t) => t.id === h.opponent_team);
      return {
        gw: h.round,
        opp: `${opp?.short_name ?? "?"} (${h.was_home ? "H" : "A"})`,
        minutes: h.minutes,
        totalPoints: h.total_points,
      } as PlayerDetailHistoryEntry;
    });

  // Upcoming fixtures — next 3 events.
  const upcoming: PlayerDetailUpcomingEntry[] = (elementSummary?.fixtures ?? [])
    .filter((f) => !f.finished && f.event !== null)
    .slice(0, 3)
    .map((f) => {
      const oppTeamId = f.is_home ? f.team_a : f.team_h;
      const opp = bs.teams.find((t) => t.id === oppTeamId);
      return {
        gw: f.event ?? 0,
        opp: `${opp?.short_name ?? "?"} (${f.is_home ? "H" : "A"})`,
        difficulty: f.difficulty,
      };
    });

  // Owners in league (top-N). Skip when no league context.
  const ownersInLeague: PlayerDetailOwnerEntry[] = ownershipMap
    ? (() => {
        const row = ownershipMap.players.find((p) => p.playerId === player.id);
        if (!row) return [];
        return row.occurrences.map((occ) => {
          const owner = ownershipMap.owners.find((o) => o.entryId === occ.entryId);
          return {
            entryId: occ.entryId,
            entryName: owner?.entryName ?? "?",
            rank: owner?.rank ?? 0,
            isCaptain: occ.isCaptain,
          };
        });
      })()
    : [];

  return {
    player: {
      id: player.id,
      code: player.code ?? 0,
      webName: player.web_name,
      fullName: `${player.first_name} ${player.second_name}`.trim(),
      teamShort: team?.short_name ?? "?",
      teamName: team?.name ?? "?",
      teamCode: team?.code ?? 0,
      position: POS_BY_ID[player.element_type] ?? "MID",
      elementType: (player.element_type as 1 | 2 | 3 | 4) || 3,
    },
    gw: targetGw,
    gwStats,
    season,
    history: recent,
    upcoming,
    ownersInLeague,
  };
}
