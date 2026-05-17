// GW-wide match composer. Joins fixtures + live + bootstrap into a slim,
// fully-resolved payload the Matches tab can render without doing any
// player/team lookups client-side.
//
// DGW handling: when a team plays twice in the GW, the live endpoint returns
// the player's aggregated stats for the whole GW (no per-fixture breakdown).
// We attribute the totals to their team's FIRST chronological fixture and tag
// the player as DGW in that match. Subsequent fixtures for that team show no
// stats for those players. Acceptable approximation for the rare DGW; precise
// per-fixture breakdown would require the live endpoint's `explain` array.

import type { FplBootstrap, FplFixture, FplElement } from "@/lib/types";
import type { FplLive } from "./client";
import { getBootstrap, getFixtures, getLive } from "./client";

export type MatchStatus = "live" | "upcoming" | "finished";

export interface MatchPlayerStat {
  playerId: number;
  webName: string;
  teamShort: string;
  count: number;
}

export interface MatchCardEntry {
  playerId: number;
  webName: string;
  teamShort: string;
  yellow: boolean;
  red: boolean;
}

export interface MatchBreakdown {
  goals: MatchPlayerStat[];
  assists: MatchPlayerStat[];
  bonusPts: MatchPlayerStat[];
  bps: MatchPlayerStat[];
  cards: MatchCardEntry[];
  defContrib: MatchPlayerStat[];
  saves: MatchPlayerStat[];
  penaltiesSaved: MatchPlayerStat[];
  penaltiesMissed: MatchPlayerStat[];
}

export interface MatchTeam {
  id: number;
  short: string;
  name: string;
}

export interface Match {
  fixtureId: number;
  gw: number;
  status: MatchStatus;
  kickoffIso: string | null;
  teamH: MatchTeam;
  teamA: MatchTeam;
  scoreH: number | null;
  scoreA: number | null;
  breakdown?: MatchBreakdown;
  /** Player IDs whose stats reflect a DGW aggregate (team has ≥2 fixtures). */
  dgwPlayers: number[];
}

function fixtureStatus(f: FplFixture, now: number): MatchStatus {
  if (f.finished) return "finished";
  if (!f.kickoff_time) return "upcoming";
  return new Date(f.kickoff_time).getTime() <= now ? "live" : "upcoming";
}

function sortDescByCount<T extends { count: number }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => b.count - a.count);
}

interface AccArgs {
  bs: FplBootstrap;
  live: FplLive;
  fixture: FplFixture;
  teamPlayers: FplElement[]; // players whose team is team_h or team_a
  isFirstFixtureForTeam: Map<number, number>; // teamId → first fixture id chronologically
}

function buildBreakdown(args: AccArgs): { breakdown: MatchBreakdown; dgwPlayers: number[] } {
  const { bs, live, fixture, teamPlayers, isFirstFixtureForTeam } = args;
  const teamsById = new Map(bs.teams.map((t) => [t.id, t]));
  const liveById = new Map(live.elements.map((e) => [e.id, e]));

  const goals: MatchPlayerStat[] = [];
  const assists: MatchPlayerStat[] = [];
  const bonusPts: MatchPlayerStat[] = [];
  const bps: MatchPlayerStat[] = [];
  const cards: MatchCardEntry[] = [];
  const defContrib: MatchPlayerStat[] = [];
  const saves: MatchPlayerStat[] = [];
  const penaltiesSaved: MatchPlayerStat[] = [];
  const penaltiesMissed: MatchPlayerStat[] = [];
  const dgwPlayers: number[] = [];

  for (const el of teamPlayers) {
    const liveEl = liveById.get(el.id);
    if (!liveEl) continue;
    const minutes = liveEl.stats.minutes ?? 0;
    if (minutes <= 0) continue;

    // For DGW players: only attribute their (aggregated) stats to the first
    // chronological fixture of their team. Skip otherwise.
    const firstFixtureForTeam = isFirstFixtureForTeam.get(el.team);
    if (firstFixtureForTeam !== undefined && firstFixtureForTeam !== fixture.id) {
      continue;
    }
    // Tag DGW players (team has ≥2 fixtures this GW).
    if (firstFixtureForTeam === fixture.id) {
      // Walk all fixtures in this GW to see if this team appears more than once.
      // Done outside this hot loop via isFirstFixtureForTeam — we still flag the
      // player here if their team's fixture count > 1 (computed by caller).
    }

    const teamShort = teamsById.get(el.team)?.short_name ?? "?";
    const base = { playerId: el.id, webName: el.web_name, teamShort };

    if ((liveEl.stats.goals_scored ?? 0) > 0) {
      goals.push({ ...base, count: liveEl.stats.goals_scored });
    }
    if ((liveEl.stats.assists ?? 0) > 0) {
      assists.push({ ...base, count: liveEl.stats.assists });
    }
    if ((liveEl.stats.bonus ?? 0) > 0) {
      bonusPts.push({ ...base, count: liveEl.stats.bonus });
    }
    if ((liveEl.stats.bps ?? 0) > 0) {
      bps.push({ ...base, count: liveEl.stats.bps });
    }
    if ((liveEl.stats.yellow_cards ?? 0) > 0 || (liveEl.stats.red_cards ?? 0) > 0) {
      cards.push({
        ...base,
        yellow: (liveEl.stats.yellow_cards ?? 0) > 0,
        red: (liveEl.stats.red_cards ?? 0) > 0,
      });
    }
    if ((liveEl.stats.defensive_contribution ?? 0) > 0) {
      defContrib.push({ ...base, count: liveEl.stats.defensive_contribution ?? 0 });
    }
    if ((liveEl.stats.saves ?? 0) > 0) {
      saves.push({ ...base, count: liveEl.stats.saves });
    }
    if ((liveEl.stats.penalties_saved ?? 0) > 0) {
      penaltiesSaved.push({ ...base, count: liveEl.stats.penalties_saved });
    }
    if ((liveEl.stats.penalties_missed ?? 0) > 0) {
      penaltiesMissed.push({ ...base, count: liveEl.stats.penalties_missed });
    }
  }

  return {
    breakdown: {
      goals: sortDescByCount(goals),
      assists: sortDescByCount(assists),
      bonusPts: sortDescByCount(bonusPts),
      bps: sortDescByCount(bps).slice(0, 10),
      cards,
      defContrib: sortDescByCount(defContrib).slice(0, 10),
      saves: sortDescByCount(saves),
      penaltiesSaved,
      penaltiesMissed,
    },
    dgwPlayers,
  };
}

export async function buildMatches(gw: number): Promise<Match[]> {
  const [bs, fixtures, live] = await Promise.all([getBootstrap(), getFixtures(gw), getLive(gw)]);
  const teamsById = new Map(bs.teams.map((t) => [t.id, t]));
  const playersByTeam = new Map<number, FplElement[]>();
  for (const el of bs.elements) {
    const list = playersByTeam.get(el.team) ?? [];
    list.push(el);
    playersByTeam.set(el.team, list);
  }

  // Per-team count of fixtures this GW + first-chronological fixture per team.
  const teamFixtureIds = new Map<number, number[]>();
  const sortedFixtures = [...fixtures].sort((a, b) => {
    const ta = a.kickoff_time ? new Date(a.kickoff_time).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.kickoff_time ? new Date(b.kickoff_time).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
  for (const f of sortedFixtures) {
    for (const tid of [f.team_h, f.team_a]) {
      const list = teamFixtureIds.get(tid) ?? [];
      list.push(f.id);
      teamFixtureIds.set(tid, list);
    }
  }
  const firstFixtureForTeam = new Map<number, number>();
  for (const [tid, ids] of teamFixtureIds) firstFixtureForTeam.set(tid, ids[0]);

  const now = Date.now();
  const matches: Match[] = sortedFixtures.map((f) => {
    const status = fixtureStatus(f, now);
    const teamH = teamsById.get(f.team_h);
    const teamA = teamsById.get(f.team_a);
    const base: Match = {
      fixtureId: f.id,
      gw,
      status,
      kickoffIso: f.kickoff_time,
      teamH: {
        id: f.team_h,
        short: teamH?.short_name ?? "?",
        name: teamH?.name ?? "?",
      },
      teamA: {
        id: f.team_a,
        short: teamA?.short_name ?? "?",
        name: teamA?.name ?? "?",
      },
      scoreH: f.team_h_score,
      scoreA: f.team_a_score,
      dgwPlayers: [],
    };

    if (status === "upcoming") return base;

    // Combine player rosters from both teams.
    const teamPlayers = [
      ...(playersByTeam.get(f.team_h) ?? []),
      ...(playersByTeam.get(f.team_a) ?? []),
    ];
    const { breakdown } = buildBreakdown({
      bs,
      live,
      fixture: f,
      teamPlayers,
      isFirstFixtureForTeam: firstFixtureForTeam,
    });
    // DGW tag: any player from a team with >1 fixture this GW whose stats we
    // attributed here.
    const dgwTeamIds = new Set<number>();
    for (const [tid, ids] of teamFixtureIds) {
      if (ids.length > 1) dgwTeamIds.add(tid);
    }
    const dgwPlayers: number[] = [];
    for (const stat of [...breakdown.goals, ...breakdown.assists, ...breakdown.bps]) {
      const el = bs.elements.find((e) => e.id === stat.playerId);
      if (el && dgwTeamIds.has(el.team)) dgwPlayers.push(el.id);
    }
    return { ...base, breakdown, dgwPlayers: [...new Set(dgwPlayers)] };
  });

  return matches;
}
