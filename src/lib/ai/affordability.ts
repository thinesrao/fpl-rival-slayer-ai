// Server-side affordability check for the AI's recommended transfers.
//
// Gemini doesn't know live FPL prices for unowned players — it's working from
// training-data recall, which is stale. We validate every recommended OUT→IN
// against the actual squad + bs.elements + current bank. Infeasible transfers
// are flagged (not dropped) so the user sees what the AI proposed AND why it
// can't be executed.
//
// Chain semantics: transfers are evaluated in the order the AI emitted them.
// `bank` after transfer i = bank_before + out_i.now_cost - in_i.now_cost.
// An infeasible transfer doesn't consume the bank — we keep walking the rest
// against the prior balance, so a single bad pick doesn't cascade.

import type { FplBootstrap, FplFixture, ManagerSquad } from "@/lib/types";
import { findElementByWebName } from "@/lib/projections/resolve-suggested";
import { rankReplacements } from "@/lib/optimizer/candidates";

export interface AffordabilityFinding {
  /** Index of the transfer in rec.transfers. */
  index: number;
  feasible: boolean;
  outCost: number; // tenths of £m, 0 if OUT not resolvable
  inCost: number;
  bankBefore: number;
  bankAfter: number;
  shortfall?: number; // positive tenths of £m short of affording IN
  reason?: string; // human message for the UI
}

export interface AffordabilityResult {
  findings: AffordabilityFinding[];
  allFeasible: boolean;
}

interface InfeasibleAttachment {
  shortfall_tenths: number;
  reason: string;
  outCostTenths: number;
  inCostTenths: number;
}

export function validateAffordability(
  transfers: Array<{ out: string; in: string }>,
  userSquad: ManagerSquad,
  bs: FplBootstrap,
  startingBank: number,
): AffordabilityResult {
  let bank = startingBank;
  const findings: AffordabilityFinding[] = [];

  for (let i = 0; i < transfers.length; i++) {
    const t = transfers[i];

    // OUT must be in the user's current squad.
    const outSlot =
      userSquad.picks.find((s) => s.player.web_name === t.out) ||
      userSquad.picks.find((s) => s.player.web_name.toLowerCase() === t.out.toLowerCase());
    const outCost = outSlot?.player.now_cost ?? 0;

    const inEl = findElementByWebName(t.in, bs);
    const inCost = inEl?.now_cost ?? 0;

    const bankBefore = bank;
    const bankAfter = bankBefore + outCost - inCost;

    let feasible = true;
    let reason: string | undefined;
    let shortfall: number | undefined;

    if (!outSlot) {
      feasible = false;
      reason = `OUT "${t.out}" isn't in your current squad — can't transfer them out.`;
    } else if (!inEl) {
      feasible = false;
      reason = `IN "${t.in}" not found in the FPL player pool — name might be wrong or stale.`;
    } else if (bankAfter < 0) {
      feasible = false;
      shortfall = -bankAfter;
      reason = `Over budget by £${(shortfall / 10).toFixed(1)}m. Selling ${t.out} (£${(outCost / 10).toFixed(1)}m) + bank (£${(bankBefore / 10).toFixed(1)}m) gives £${((outCost + bankBefore) / 10).toFixed(1)}m to spend; ${t.in} costs £${(inCost / 10).toFixed(1)}m.`;
    }

    findings.push({ index: i, feasible, outCost, inCost, bankBefore, bankAfter, shortfall, reason });
    if (feasible) bank = bankAfter; // only successful transfers consume the bank
  }

  return { findings, allFeasible: findings.every((f) => f.feasible) };
}

/** Helper: produce the per-transfer attachment shape the UI consumes. */
export function findingToInfeasible(f: AffordabilityFinding): InfeasibleAttachment | undefined {
  if (f.feasible) return undefined;
  return {
    shortfall_tenths: f.shortfall ?? 0,
    reason: f.reason ?? "infeasible transfer",
    outCostTenths: f.outCost,
    inCostTenths: f.inCost,
  };
}

export interface ReconciledTransfer {
  out: string;
  in: string;
  reason: string;
  rival_targeted?: string;
  hit_cost?: number;
  substituted?: {
    original_in: string;
    original_in_cost_tenths: number;
    reason: string;
  };
  infeasible?: InfeasibleAttachment;
}

export interface ReconcileResult {
  transfers: ReconciledTransfer[];
  summary: {
    substituted: number;
    stillInfeasible: number;
  };
}

/** Walk the AI's transfer chain in order. For each transfer:
 *  - If feasible as-emitted, apply it and consume the bank.
 *  - If over budget but a same-position affordable alternative exists in the
 *    FPL pool, auto-swap the IN to that alternative and tag the transfer with
 *    `substituted` so the UI can show what the AI originally proposed.
 *  - If no affordable alternative exists (or OUT/IN can't be resolved at
 *    all), keep the original infeasible flag so the UI still surfaces it.
 *
 *  Maintains ownership + per-club counts across the chain so a previously-
 *  applied transfer's effects propagate to later substitution searches.
 */
export function reconcileTransfers(args: {
  transfers: Array<{ out: string; in: string; reason: string; rival_targeted?: string; hit_cost?: number }>;
  userSquad: ManagerSquad;
  bs: FplBootstrap;
  fixtures: FplFixture[];
  gw: number;
  startingBank: number;
}): ReconcileResult {
  const { transfers, userSquad, bs, fixtures, gw, startingBank } = args;

  let bank = startingBank;
  const ownedIds = new Set<number>(userSquad.picks.map((s) => s.player.id));
  const teamCounts = new Map<number, number>();
  for (const s of userSquad.picks) {
    teamCounts.set(s.player.team, (teamCounts.get(s.player.team) ?? 0) + 1);
  }

  const out: ReconciledTransfer[] = [];
  let substituted = 0;
  let stillInfeasible = 0;

  for (const t of transfers) {
    // Resolve OUT — must be in the (current, post-prior-transfers) owned set.
    const outSlot =
      userSquad.picks.find((s) => s.player.web_name === t.out && ownedIds.has(s.player.id)) ||
      userSquad.picks.find(
        (s) => s.player.web_name.toLowerCase() === t.out.toLowerCase() && ownedIds.has(s.player.id),
      );

    if (!outSlot) {
      out.push({
        ...t,
        infeasible: {
          shortfall_tenths: 0,
          reason: `OUT "${t.out}" isn't in your current squad — can't transfer them out.`,
          outCostTenths: 0,
          inCostTenths: 0,
        },
      });
      stillInfeasible++;
      continue;
    }

    const outCost = outSlot.player.now_cost;
    const inEl = findElementByWebName(t.in, bs);
    const inCost = inEl?.now_cost ?? 0;
    const bankAfter = bank + outCost - inCost;

    // Path A: AI's IN is feasible — apply as-is.
    if (inEl && bankAfter >= 0 && !ownedIds.has(inEl.id)) {
      const incomingTeamCount = teamCounts.get(inEl.team) ?? 0;
      // 3-per-team cap (the OUT player has been pre-counted; if they're on
      // the IN's team that subtracts one).
      const sameTeam = outSlot.player.team === inEl.team ? 1 : 0;
      if (incomingTeamCount - sameTeam < 3) {
        bank = bankAfter;
        ownedIds.delete(outSlot.player.id);
        ownedIds.add(inEl.id);
        teamCounts.set(outSlot.player.team, (teamCounts.get(outSlot.player.team) ?? 1) - 1);
        teamCounts.set(inEl.team, (teamCounts.get(inEl.team) ?? 0) + 1);
        out.push(t);
        continue;
      }
    }

    // Path B: AI's IN is not feasible — try to substitute with the best
    // affordable upgrade at the same position.
    // teamCounts for rankReplacements must exclude the OUT player.
    const teamCountsForRank = new Map(teamCounts);
    teamCountsForRank.set(outSlot.player.team, (teamCountsForRank.get(outSlot.player.team) ?? 1) - 1);

    const candidates = rankReplacements({
      outPlayer: outSlot.player,
      bank,
      ownedIds,
      teamCounts: teamCountsForRank,
      bs,
      fixtures,
      gw,
      limit: 1,
    });

    if (candidates.length > 0) {
      const best = candidates[0];
      const newBank = bank + outCost - best.cost;
      bank = newBank;
      ownedIds.delete(outSlot.player.id);
      ownedIds.add(best.playerId);
      teamCounts.set(outSlot.player.team, (teamCounts.get(outSlot.player.team) ?? 1) - 1);
      teamCounts.set(best.teamId, (teamCounts.get(best.teamId) ?? 0) + 1);

      const reasonAddendum = inEl
        ? ` [Auto-substituted: ${t.in} costs £${(inCost / 10).toFixed(1)}m which is over your £${((bank + best.cost - outCost) / 10).toFixed(1)}m+£${(outCost / 10).toFixed(1)}m budget. ${best.webName} (£${(best.cost / 10).toFixed(1)}m, xP ${best.xPoints.toFixed(1)}) is the highest-rated affordable upgrade.]`
        : ` [Auto-substituted: "${t.in}" couldn't be resolved in the current FPL pool. ${best.webName} (£${(best.cost / 10).toFixed(1)}m, xP ${best.xPoints.toFixed(1)}) is the highest-rated affordable upgrade.]`;

      out.push({
        ...t,
        in: best.webName,
        reason: t.reason + reasonAddendum,
        substituted: {
          original_in: t.in,
          original_in_cost_tenths: inCost,
          reason: inEl
            ? `${t.in} (£${(inCost / 10).toFixed(1)}m) was over budget — swapped to ${best.webName} (£${(best.cost / 10).toFixed(1)}m), the best affordable upgrade.`
            : `${t.in} couldn't be resolved — swapped to ${best.webName} (£${(best.cost / 10).toFixed(1)}m), the best affordable upgrade.`,
        },
      });
      substituted++;
      continue;
    }

    // Path C: no affordable substitute either — surface the infeasible flag.
    const shortfall = Math.max(0, -bankAfter);
    out.push({
      ...t,
      infeasible: {
        shortfall_tenths: shortfall,
        reason: !inEl
          ? `IN "${t.in}" not found in the FPL player pool and no affordable upgrade exists for ${outSlot.player.web_name}'s slot.`
          : `Over budget by £${(shortfall / 10).toFixed(1)}m and no affordable upgrade exists for ${outSlot.player.web_name}'s slot.`,
        outCostTenths: outCost,
        inCostTenths: inCost,
      },
    });
    stillInfeasible++;
  }

  return { transfers: out, summary: { substituted, stillInfeasible } };
}
