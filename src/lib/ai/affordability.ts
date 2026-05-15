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

import type { FplBootstrap, ManagerSquad } from "@/lib/types";
import { findElementByWebName } from "@/lib/projections/resolve-suggested";

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
