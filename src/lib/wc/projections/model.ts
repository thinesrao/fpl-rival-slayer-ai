// Pre-tournament value model for WC26 players. Before any rounds complete
// there is no form/xG history in the feed, so value composes what we do have:
// FIFA's own pricing (squad quality signal), the crowd (ownership), team
// strength vs the round's actual opponent, the scoring table's position
// asymmetry, and editorial "one to watch" flags. Once rounds complete, feed
// form blends in with rising weight.

import type { WcPlayer, WcRound } from "@/lib/wc/fifa/types";
import type { WcTeamIndex } from "@/lib/wc/fifa/teams";
import { opponentInRound } from "@/lib/wc/context";

export interface WcProjection {
  playerId: number;
  /** Expected fantasy points for the round (directional, not calibrated). */
  xPts: number;
  /** Pull-everything-together desirability used by the optimizer. */
  value: number;
}

// How much a goal/CS is worth per position relative to a FWD goal — encodes
// that attacking DEFs and goal-scoring MIDs out-earn their price tier.
const POSITION_MULT = { GK: 0.92, DEF: 1.06, MID: 1.1, FWD: 1.0 } as const;

/** 0..1 — how favourable the round's matchup is for this team. */
function fixtureEase(teamRank: number, oppRank: number | null): number {
  if (oppRank == null) return 0.5;
  // rank 1 vs rank 48 → ~0.93; mirror → ~0.07; even → 0.5
  return 1 / (1 + Math.exp((teamRank - oppRank) / 12));
}

export function projectWcPlayer(
  p: WcPlayer,
  round: WcRound,
  teamIndex: WcTeamIndex,
  completedRounds: number,
): WcProjection {
  const team = teamIndex.byId.get(p.squadId);
  const opp = opponentInRound(round, p.squadId);
  const oppTeam = opp
    ? teamIndex.byId.get(
        opp.match.homeSquadId === p.squadId
          ? opp.match.awaySquadId ?? -1
          : opp.match.homeSquadId ?? -1,
      )
    : undefined;

  const playsThisRound = opp != null;
  const ease = fixtureEase(team?.strengthRank ?? 48, oppTeam?.strengthRank ?? null);

  // Price 3.5..10.5 → baseline ~2..6.5 xPts: FIFA prices ARE a quality model.
  const priceBase = 2 + (p.price - 3.5) * 0.64;

  // Crowd wisdom — log-scaled so 40% owned isn't 40x a 1% pick.
  const ownership = Math.log10(Math.max(p.percentSelected, 0.1) + 1); // ~0.04..1.7

  const watch = p.oneToWatch ? 0.35 : 0;
  const unavailable = p.status !== "playing" ? -100 : 0;

  // Blend in real form once rounds complete (w grows 0 → 0.6 over 3 rounds).
  const formWeight = Math.min(completedRounds, 3) * 0.2;
  const priceWeight = 1 - formWeight;
  const base = priceBase * priceWeight + (p.stats.form || p.stats.avgPoints) * formWeight;

  const xPts =
    (base * (0.55 + 0.9 * ease) + ownership * 0.8 + watch) *
      POSITION_MULT[p.position] *
      (playsThisRound ? 1 : 0.1) +
    unavailable;

  // Value adds a mild cheap-player bonus so the optimizer fills bench slots
  // with playing 3.5-4.5m bodies instead of mid-priced passengers.
  const value = xPts + (p.price <= 4.5 && p.status === "playing" ? 0.3 : 0);

  return { playerId: p.id, xPts: Math.max(0, Math.round(xPts * 100) / 100), value };
}

export function projectAll(
  players: WcPlayer[],
  round: WcRound,
  teamIndex: WcTeamIndex,
  completedRounds: number,
): Map<number, WcProjection> {
  const out = new Map<number, WcProjection>();
  for (const p of players) {
    if (p.status === "transferred") continue;
    out.set(p.id, projectWcPlayer(p, round, teamIndex, completedRounds));
  }
  return out;
}
