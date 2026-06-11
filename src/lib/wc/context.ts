// Server-side assembly of everything the WC dashboard needs per request:
// feed data + derived teams + the round being planned for + its rules.
// Every /api/wc/* handler starts here.

import { getWcPlayers, getWcRounds, activeRound, targetRound, roundLockTime } from "./fifa/client";
import { buildTeamIndex, type WcTeamIndex } from "./fifa/teams";
import { rulesForRound, type WcRoundRules } from "./rules/config";
import type { WcMatch, WcPlayer, WcRound } from "./fifa/types";

export interface WcContext {
  players: WcPlayer[];
  playerById: Map<number, WcPlayer>;
  teamIndex: WcTeamIndex;
  rounds: WcRound[];
  /** Round currently in play, if any. */
  active: WcRound | null;
  /** Round we plan FOR (next scheduled, else the live one). */
  target: WcRound;
  targetRules: WcRoundRules;
  targetLockIso: string;
}

export async function getWcContext(): Promise<WcContext> {
  const [players, rounds] = await Promise.all([getWcPlayers(), getWcRounds()]);
  const teamIndex = buildTeamIndex(rounds, players);
  const target = targetRound(rounds);
  return {
    players,
    playerById: new Map(players.map((p) => [p.id, p])),
    teamIndex,
    rounds,
    active: activeRound(rounds),
    target,
    targetRules: rulesForRound(target),
    targetLockIso: roundLockTime(target).toISOString(),
  };
}

/** True while the user is still building the initial squad: Round 1 exists
 *  but hasn't locked. Transfer limits only begin once Round 1 locks. */
export function isPreTournamentLock(ctx: Pick<WcContext, "target" | "targetLockIso">): boolean {
  return ctx.target.id === 1 && Date.now() < new Date(ctx.targetLockIso).getTime();
}

/** The opponent label for a team in a given round, e.g. "vs RSA" / "@ MEX". */
export function opponentInRound(round: WcRound, squadId: number): { match: WcMatch; label: string } | null {
  for (const m of round.tournaments) {
    if (m.homeSquadId === squadId && m.awaySquadAbbr) {
      return { match: m, label: `vs ${m.awaySquadAbbr}` };
    }
    if (m.awaySquadId === squadId && m.homeSquadAbbr) {
      return { match: m, label: `vs ${m.homeSquadAbbr}` };
    }
  }
  return null;
}
