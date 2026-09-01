// Enumerates the small set of actions worth simulating.
//
// Deliberately small: every candidate costs a full paired simulation, and a
// surface that has to be readable in one glance cannot rank forty options.

import type { Evidence } from "@/lib/decision/types";
import type { TransferOption } from "@/lib/optimizer/transfer-options";
import type { ManagerSquad, SquadProjection } from "@/lib/types";

/** How many captain alternatives to weigh, beyond the current pick. */
export const CAPTAIN_ALTERNATIVES = 3;

/** Points deducted for a transfer beyond the free allowance. */
const HIT_COST = -4;

export interface Candidate {
  kind: "transfer" | "captain";
  headline: string;
  detail: string;
  hitCost: number;
  variant: SquadProjection;
  evidence: Evidence[];
}

/** Baseline projection shifted by a change to the starting-XI total. */
function shifted(base: SquadProjection, delta: number): SquadProjection {
  return {
    ...base,
    startingXIPoints: Number((base.startingXIPoints + delta).toFixed(2)),
    totalExpected: Number((base.totalExpected + delta).toFixed(2)),
  };
}

export function captainCandidates(squad: ManagerSquad, projection: SquadProjection): Candidate[] {
  const current = squad.captain;
  if (!current) return [];

  const byId = new Map(projection.perPlayer.map((p) => [p.playerId, p]));
  const currentXp = byId.get(current.player.id)?.xPoints ?? 0;

  const alternatives = squad.starters
    .filter((s) => s.player.id !== current.player.id)
    .map((s) => ({ slot: s, xPoints: byId.get(s.player.id)?.xPoints ?? 0 }))
    .sort((a, b) => b.xPoints - a.xPoints)
    .slice(0, CAPTAIN_ALTERNATIVES);

  return alternatives.map(({ slot, xPoints }) => ({
    kind: "captain" as const,
    headline: `Captain ${slot.player.web_name}`,
    detail: `Instead of ${current.player.web_name}. Armband doubles this pick.`,
    hitCost: 0,
    // Swapping the armband removes one copy of the old captain's points and
    // adds one copy of the new one's.
    variant: shifted(projection, xPoints - currentXp),
    evidence: [
      { label: `${slot.player.web_name} vs ${current.player.web_name}`, tab: "squad" },
    ],
  }));
}

export function transferCandidates(
  options: TransferOption[],
  projection: SquadProjection,
  freeTransfers: number,
): Candidate[] {
  return options.map((option) => {
    const hitCost = freeTransfers > 0 ? 0 : HIT_COST;
    return {
      kind: "transfer" as const,
      headline: `Bring in ${option.inWebName}`,
      detail: `Sell ${option.outWebName} (${option.outTeamShort}) for ${option.inWebName} (${option.inTeamShort}).`,
      hitCost,
      variant: shifted(projection, option.netGainXi + hitCost),
      evidence: [
        { label: `${option.outWebName} → ${option.inWebName}`, tab: "squad" },
        { label: "Effect on your rivals", tab: "rival" },
      ],
    };
  });
}
