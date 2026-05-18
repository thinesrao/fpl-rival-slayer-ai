// Shared FPL + domain types used across the FPL data layer, projections, and UI.

export type Position = "GKP" | "DEF" | "MID" | "FWD";

export interface FplElementType {
  id: number;
  singular_name_short: Position;
  plural_name_short: string;
}

export interface FplTeam {
  id: number;
  code: number; // numeric code used in kit-image URLs (separate from `id`)
  name: string;
  short_name: string;
  strength: number;
  strength_overall_home: number;
  strength_overall_away: number;
  strength_attack_home: number;
  strength_attack_away: number;
  strength_defence_home: number;
  strength_defence_away: number;
}

export interface FplElement {
  id: number;
  code: number; // numeric code used in player photo URLs (separate from `id`)
  web_name: string;
  first_name: string;
  second_name: string;
  team: number;
  element_type: number; // 1=GKP, 2=DEF, 3=MID, 4=FWD
  now_cost: number; // tenths of a million
  status: "a" | "d" | "i" | "n" | "s" | "u"; // available/doubtful/injured/news/suspended/unavailable
  news: string;
  news_added: string | null;
  chance_of_playing_next_round: number | null;
  form: string;
  points_per_game: string;
  total_points: number;
  minutes: number;
  selected_by_percent: string;
  ep_next: string;
  ep_this: string;
  expected_goals: string;
  expected_assists: string;
  expected_goal_involvements: string;
  expected_goals_conceded: string;
  expected_goals_per_90: number;
  expected_assists_per_90: number;
  expected_goal_involvements_per_90: number;
  expected_goals_conceded_per_90: number;
  saves_per_90: number;
  clean_sheets_per_90: number;
  starts_per_90: number;
  ict_index: string;
  bps: number;
  transfers_in_event: number;
  transfers_out_event: number;
  cost_change_event: number; // tenths of £m moved this GW (positive = rise, negative = drop)
  cost_change_start: number; // tenths of £m moved since season start
}

export interface FplEvent {
  id: number;
  name: string;
  deadline_time: string;
  deadline_time_epoch: number;
  finished: boolean;
  is_current: boolean;
  is_next: boolean;
  is_previous: boolean;
  average_entry_score: number;
  highest_score: number | null;
}

export interface FplBootstrap {
  events: FplEvent[];
  teams: FplTeam[];
  elements: FplElement[];
  element_types: FplElementType[];
  total_players: number;
}

export interface FplFixture {
  id: number;
  code: number;
  event: number | null;
  kickoff_time: string | null;
  finished: boolean;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  team_h_difficulty: number;
  team_a_difficulty: number;
}

export interface FplLeagueStandingEntry {
  id: number;
  entry: number; // team_id
  player_name: string;
  entry_name: string;
  rank: number;
  last_rank: number;
  total: number;
  event_total: number;
}

export interface FplLeagueStandings {
  league: { id: number; name: string };
  standings: { has_next: boolean; page: number; results: FplLeagueStandingEntry[] };
}

export interface FplPick {
  element: number; // player id
  position: number; // 1..15
  multiplier: number; // 0 bench, 1 starter, 2 captain, 3 triple-captain
  is_captain: boolean;
  is_vice_captain: boolean;
}

export interface FplPicksResponse {
  active_chip: string | null;
  entry_history: {
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
  };
  picks: FplPick[];
}

export interface FplEntry {
  id: number;
  name: string;
  player_first_name: string;
  player_last_name: string;
  summary_overall_rank: number | null;
  summary_overall_points: number | null;
  current_event: number | null;
  last_deadline_bank: number | null;
  last_deadline_value: number | null;
}

// Domain types ---------------------------------------------------------------

export interface SquadSlot {
  pick: FplPick;
  player: FplElement;
  team: FplTeam;
  position: Position;
}

export interface ManagerSquad {
  entry: { id: number; name: string; player_name: string; total: number; rank: number };
  gw: number;
  picks: SquadSlot[];
  starters: SquadSlot[];
  bench: SquadSlot[];
  captain: SquadSlot | undefined;
  viceCaptain: SquadSlot | undefined;
  activeChip: string | null;
}

export interface RivalContext {
  user: ManagerSquad;
  rivals: ManagerSquad[]; // ordered: closest rival first (the manager one rank above user)
  leagueName: string;
}

export interface PlayerProjection {
  playerId: number;
  webName: string;
  position: Position;
  xPoints: number; // expected points for the upcoming GW
  variance: number; // variance estimate for Monte-Carlo
  injuryRisk: number; // 0..1 — 1-chance_of_playing_next_round normalized
  fixtureDifficulty: number; // 1..5 FDR
  notes: string[]; // human-readable factors (e.g. "Easy home fixture", "Injury doubt")
}

export interface SquadProjection {
  entryId: number;
  startingXIPoints: number; // sum incl. captain multiplier
  benchPoints: number;
  totalExpected: number;
  stdev: number;
  perPlayer: PlayerProjection[];
}

export interface OvertakeOdds {
  rivalEntryId: number;
  rivalName: string;
  rivalRank: number;
  userExpected: number;
  rivalExpected: number;
  expectedDelta: number; // user - rival
  overtakeProbability: number; // P(user_score > rival_score) over one GW
  pointsBehind: number; // current standings gap
}
