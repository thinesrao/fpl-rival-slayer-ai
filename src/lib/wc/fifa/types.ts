// Types for the official FIFA World Cup 2026™ Fantasy public JSON feed
// (play.fifa.com/json/fantasy/*). Shapes verified against the live feed on
// 2026-06-10. Only players.json + rounds.json are consumed — squads_fifa.json
// still serves the 2022 tournament and is ignored (see teams.ts).

export type WcPosition = "GK" | "DEF" | "MID" | "FWD";

/** "playing" = in a confirmed 26-man squad; "transferred" = removed/not in squad.
 *  The feed may emit further values (injured/suspended) once the tournament runs. */
export type WcPlayerStatus = "playing" | "transferred" | string;

export interface WcPlayerStats {
  totalPoints: number;
  avgPoints: number;
  form: number;
  lastRoundPoints: number;
  /** Points per completed/active round, parallel to round ids encountered so far. */
  roundPoints: number[];
  nextFixtureFromActiveRound: number | null;
  nextFixtureFromScheduledRound: number | null;
}

export interface WcPlayer {
  id: number;
  firstName: string | null;
  lastName: string | null;
  knownName: string | null;
  /** Small-int team id (1..48) — joins to matches' home/awaySquadId. */
  squadId: number;
  position: WcPosition;
  /** $m — fixed for the whole tournament. */
  price: number;
  status: WcPlayerStatus;
  matchStatus: string | null;
  percentSelected: number;
  roundsSelected: Record<string, number>;
  stats: WcPlayerStats;
  oneToWatch: boolean;
  oneToWatchText: string | null;
  qualificationRoundIds: number[];
  fifaId: number | null;
}

export type WcMatchPeriod =
  | "pre_match"
  | "first_half"
  | "half_time"
  | "second_half"
  | "extra_time"
  | "penalties"
  | "full_time"
  | string;

export interface WcMatch {
  id: number;
  period: WcMatchPeriod;
  minutes: number;
  extraMinutes: number;
  venueName: string | null;
  venueCity: string | null;
  venueId: number | null;
  /** Kickoff, ISO with offset. */
  date: string;
  status: "scheduled" | "active" | "complete" | string;
  isSuspended: boolean;
  homeSquadId: number | null;
  awaySquadId: number | null;
  homeSquadName: string | null;
  awaySquadName: string | null;
  homeSquadAbbr: string | null;
  awaySquadAbbr: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homePenaltyScore: number | null;
  awayPenaltyScore: number | null;
  homeGoalScorersAssists: unknown;
  awayGoalScorersAssists: unknown;
}

export type WcStage = "GROUP" | "R32" | "R16" | "QF" | "SF" | "F";

export interface WcRound {
  /** 1..8 — 1-3 group MDs, 4 R32, 5 R16, 6 QF, 7 SF, 8 Final. */
  id: number;
  status: "scheduled" | "active" | "complete" | string;
  startDate: string;
  endDate: string;
  stage: WcStage;
  /** The feed calls matches "tournaments". */
  tournaments: WcMatch[];
}

/** A 2026 team derived from rounds.json matches (the feed's stale squads file
 *  is unusable) — see teams.ts for the derivation. */
export interface WcTeam {
  /** Small-int id matching players' squadId and matches' home/awaySquadId. */
  id: number;
  name: string;
  abbr: string;
  /** "A".."L", derived from the group-stage pairing graph. */
  group: string;
  /** Sum of the team's 11 priciest active players, $m — strength proxy. */
  strength: number;
  /** 1 = strongest by `strength` ranking across all 48. */
  strengthRank: number;
}
