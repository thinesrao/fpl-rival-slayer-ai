// Adapts the live FPL bootstrap into the same PlayerFeatures shape the backtest
// builds from history, so both paths score through scorePlayer.
//
// Bootstrap exposes real per-90 rates for expected goals and expected assists,
// so xg90 and xa90 are per-player here, same as in the backtest. It exposes no
// per-90 BPS or defensive-contribution rate, so bps90 and dcPer90 are always
// position medians in this path — there is no per-player signal in them and
// no fallback logic. Consequently the bonus and defensive-contribution score
// components do not discriminate between same-position players in the live
// app, while the backtest feeds scorePlayer real rolling per-90 values for
// both. The two paths share the same scoring function and interface, but
// these two components are not statistically comparable between them, so
// backtest correlation figures should not be read as characterising live
// ranking quality for bonus- or DC-driven differences.

import type { FplElement, FplFixture, FplTeam, Position } from "@/lib/types";
import type { FixtureContext, PlayerFeatures } from "@/lib/projections/features";

/** Median BPS per 90 by position, used when a player has no usable history. */
const DEFAULT_BPS90: Record<Position, number> = { GKP: 18, DEF: 16, MID: 14, FWD: 14 };
/** Median defensive-contribution count per 90 by position. */
const DEFAULT_DC90: Record<Position, number> = { GKP: 0, DEF: 6, MID: 5, FWD: 2 };
/** League-average expected goals conceded per 90, used when unknown. */
const LEAGUE_XGC90 = 1.35;

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function fixtureContextFor(
  fixtures: FplFixture[],
  teamId: number,
  gw: number,
): FixtureContext {
  const matching = fixtures.filter(
    (f) => f.event === gw && (f.team_h === teamId || f.team_a === teamId),
  );
  if (matching.length === 0) {
    return { fdr: 3, isHome: true, fixtureCount: 0, opponentXgcPer90: LEAGUE_XGC90 };
  }

  const isHome = matching[0].team_h === teamId;
  const fdr =
    matching.reduce(
      (sum, f) => sum + (f.team_h === teamId ? f.team_h_difficulty : f.team_a_difficulty),
      0,
    ) / matching.length;

  // FDR 1 (easiest opponent) implies a weak attack, so a low expected goals
  // conceded for us. This is the single place fixture difficulty enters.
  const opponentXgcPer90 = LEAGUE_XGC90 * (0.55 + 0.225 * (fdr - 1));

  return { fdr, isHome, fixtureCount: matching.length, opponentXgcPer90 };
}

export function liveFeatures(args: {
  player: FplElement;
  team: FplTeam;
  position: Position;
  fixtures: FplFixture[];
  gw: number;
}): PlayerFeatures {
  const { player, team, position, fixtures, gw } = args;
  const chance = player.chance_of_playing_next_round;
  const availability = chance === null || chance === undefined ? 1 : Math.max(0, Math.min(1, chance / 100));
  const startRate = Math.max(0, Math.min(1, num(player.starts_per_90, 1)));

  return {
    playerId: player.id,
    webName: player.web_name,
    position,
    xg90: num(player.expected_goals_per_90),
    xa90: num(player.expected_assists_per_90),
    bps90: DEFAULT_BPS90[position],
    dcPer90: DEFAULT_DC90[position],
    startRate,
    minutesPerStart: startRate > 0 ? 90 : 0,
    availability,
    ...fixtureContextFor(fixtures, team.id, gw),
    sampleRounds: 0,
  };
}
