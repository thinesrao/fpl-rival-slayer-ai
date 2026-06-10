// Group tables + schedule derived purely from the official feed.

import type { WcMatch, WcRound } from "./fifa/types";
import type { WcTeamIndex } from "./fifa/teams";

export interface GroupRow {
  teamId: number;
  name: string;
  abbr: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
}

export function buildGroupTables(
  rounds: WcRound[],
  teamIndex: WcTeamIndex,
): Map<string, GroupRow[]> {
  const rows = new Map<number, GroupRow>();
  for (const team of teamIndex.teams) {
    rows.set(team.id, {
      teamId: team.id,
      name: team.name,
      abbr: team.abbr,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      points: 0,
    });
  }

  for (const round of rounds) {
    if (round.stage !== "GROUP") continue;
    for (const m of round.tournaments) {
      if (m.status !== "complete" || m.homeScore == null || m.awayScore == null) continue;
      const home = m.homeSquadId != null ? rows.get(m.homeSquadId) : undefined;
      const away = m.awaySquadId != null ? rows.get(m.awaySquadId) : undefined;
      if (!home || !away) continue;
      home.played++;
      away.played++;
      home.gf += m.homeScore;
      home.ga += m.awayScore;
      away.gf += m.awayScore;
      away.ga += m.homeScore;
      if (m.homeScore > m.awayScore) {
        home.won++;
        away.lost++;
        home.points += 3;
      } else if (m.homeScore < m.awayScore) {
        away.won++;
        home.lost++;
        away.points += 3;
      } else {
        home.drawn++;
        away.drawn++;
        home.points++;
        away.points++;
      }
    }
  }

  const tables = new Map<string, GroupRow[]>();
  for (const team of teamIndex.teams) {
    const row = rows.get(team.id)!;
    row.gd = row.gf - row.ga;
    if (!tables.has(team.group)) tables.set(team.group, []);
    tables.get(team.group)!.push(row);
  }
  for (const list of tables.values()) {
    list.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name));
  }
  return new Map([...tables.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export interface ScheduleMatch {
  id: number;
  roundId: number;
  stage: string;
  date: string;
  venueName: string | null;
  venueCity: string | null;
  status: string;
  period: string;
  minutes: number;
  home: { id: number | null; name: string | null; abbr: string | null; score: number | null; penScore: number | null };
  away: { id: number | null; name: string | null; abbr: string | null; score: number | null; penScore: number | null };
}

export function toScheduleMatch(round: WcRound, m: WcMatch): ScheduleMatch {
  return {
    id: m.id,
    roundId: round.id,
    stage: round.stage,
    date: m.date,
    venueName: m.venueName,
    venueCity: m.venueCity,
    status: m.status,
    period: m.period,
    minutes: m.minutes,
    home: { id: m.homeSquadId, name: m.homeSquadName, abbr: m.homeSquadAbbr, score: m.homeScore, penScore: m.homePenaltyScore },
    away: { id: m.awaySquadId, name: m.awaySquadName, abbr: m.awaySquadAbbr, score: m.awayScore, penScore: m.awayPenaltyScore },
  };
}
