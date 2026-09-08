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

// Chips (`squad.activeChip`) are not read anywhere in this file. The armband
// below is hardcoded at x2 and transferCandidates always charges a hit when
// freeTransfers is exhausted, but under Triple Captain the true point delta
// is 2 * (alt - cur) and the variance delta is 8 * dVar, and under Wildcard
// or Free Hit there is no hit to charge. Every one of those errors currently
// understates a candidate's value or overstates its cost — never the other
// way — so nothing here is overclaimed, but that is luck, not design.
// Anyone adding chip support must preserve that conservative direction: it
// is safer to undersell a chip week than to oversell one.

export interface Candidate {
  kind: "transfer" | "captain";
  headline: string;
  detail: string;
  hitCost: number;
  variant: SquadProjection;
  evidence: Evidence[];
}

/** Baseline projection shifted by a change to the starting-XI total. */
function shifted(base: SquadProjection, delta: number, stdev?: number): SquadProjection {
  return {
    ...base,
    startingXIPoints: Number((base.startingXIPoints + delta).toFixed(2)),
    totalExpected: Number((base.totalExpected + delta).toFixed(2)),
    ...(stdev !== undefined && { stdev }),
  };
}

export function captainCandidates(squad: ManagerSquad, projection: SquadProjection): Candidate[] {
  const current = squad.captain;
  if (!current) return [];

  const byId = new Map(projection.perPlayer.map((p) => [p.playerId, p]));
  const currentXp = byId.get(current.player.id)?.xPoints ?? 0;
  const currentVar = byId.get(current.player.id)?.variance ?? 0;

  const alternatives = squad.starters
    .filter((s) => s.player.id !== current.player.id)
    .map((s) => ({ slot: s, xPoints: byId.get(s.player.id)?.xPoints ?? 0, variance: byId.get(s.player.id)?.variance ?? 0 }))
    .sort((a, b) => b.xPoints - a.xPoints)
    .slice(0, CAPTAIN_ALTERNATIVES);

  return alternatives.map(({ slot, xPoints, variance }) => {
    // Moving the armband changes total variance by 3 * (newVariance - currentVariance).
    // Captain's variance is multiplied by 4 (multiplier 2^2), everyone else by 1.
    const totalVar = projection.stdev ** 2 + 3 * (variance - currentVar);
    const stdev = Number(Math.sqrt(Math.max(1, totalVar)).toFixed(2));

    return {
      kind: "captain" as const,
      headline: `Captain ${slot.player.web_name}`,
      detail: `Instead of ${current.player.web_name}. Armband doubles this pick.`,
      hitCost: 0,
      // Swapping the armband removes one copy of the old captain's points and
      // adds one copy of the new one's.
      variant: shifted(projection, xPoints - currentXp, stdev),
      evidence: [
        { label: `${slot.player.web_name} vs ${current.player.web_name}`, tab: "squad" },
      ],
    };
  });
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
      // Both names, because several options can share an incoming player and
      // a list of identical headlines defeats the point of showing what lost.
      headline: `Swap ${option.outWebName} for ${option.inWebName}`,
      detail: `Sell ${option.outWebName} (${option.outTeamShort}) for ${option.inWebName} (${option.inTeamShort}).`,
      hitCost,
      // variantStdev is the post-swap squad's own stdev, already computed by
      // simulateSwap when the option was generated — a transfer to a more
      // volatile player widens the spread, same as a captain change does.
      variant: shifted(projection, option.netGainXi + hitCost, option.variantStdev),
      evidence: [
        { label: `${option.outWebName} → ${option.inWebName}`, tab: "squad" },
        { label: "Effect on your rivals", tab: "vs" },
      ],
    };
  });
}
