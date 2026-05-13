// Heuristic price-change forecast from bootstrap transfer counters.
//
// FPL doesn't expose the rise/fall thresholds. Community-derived estimates
// put the net transfer count needed for a £0.1m change at roughly +0.7%-1%
// of the active manager pool (~120-180k as of the 2025-26 season). The
// threshold itself drifts as more managers join (bigger denominator). We
// use a conservative ~0.9% rule, capped, and emit a confidence band.
//
// This intentionally favours specificity over precision — the goal is to
// nudge the AI / user to "buy tonight or wait", not to perfectly predict
// the FPL price-change algorithm.

import type { FplBootstrap, FplElement } from "@/lib/types";

export interface PriceMove {
  playerId: number;
  webName: string;
  position: number;
  netTransfers: number;
  pctOfPool: number;
  confidence: "low" | "medium" | "high";
  direction: "rise" | "fall";
  alreadyChangedThisGw: number; // raw cost_change_event (£0.1m units)
}

export interface PriceMoveReport {
  rising: PriceMove[];
  falling: PriceMove[];
  byId: Record<number, PriceMove>;
}

function classify(netPct: number, alreadyChanged: number): {
  direction: "rise" | "fall" | "none";
  confidence: "low" | "medium" | "high";
} {
  const abs = Math.abs(netPct);
  // If FPL has already moved the price this GW, the next move requires
  // ~2× the threshold, so we down-weight.
  const threshold = alreadyChanged !== 0 ? 1.6 : 0.8;
  if (abs < threshold * 0.6) return { direction: "none", confidence: "low" };
  let confidence: "low" | "medium" | "high" = "low";
  if (abs >= threshold * 1.4) confidence = "high";
  else if (abs >= threshold) confidence = "medium";
  return {
    direction: netPct > 0 ? "rise" : "fall",
    confidence,
  };
}

export function computePriceMoves(bs: FplBootstrap): PriceMoveReport {
  const pool = bs.total_players || 1;
  const moves: PriceMove[] = [];
  for (const el of bs.elements) {
    const net = (el.transfers_in_event ?? 0) - (el.transfers_out_event ?? 0);
    const pct = (net / pool) * 100;
    const { direction, confidence } = classify(pct, el.cost_change_event ?? 0);
    if (direction === "none") continue;
    moves.push({
      playerId: el.id,
      webName: el.web_name,
      position: el.element_type,
      netTransfers: net,
      pctOfPool: pct,
      confidence,
      direction,
      alreadyChangedThisGw: el.cost_change_event ?? 0,
    });
  }
  const rising = moves
    .filter((m) => m.direction === "rise")
    .sort((a, b) => b.pctOfPool - a.pctOfPool)
    .slice(0, 25);
  const falling = moves
    .filter((m) => m.direction === "fall")
    .sort((a, b) => a.pctOfPool - b.pctOfPool)
    .slice(0, 25);
  const byId: Record<number, PriceMove> = {};
  [...rising, ...falling].forEach((m) => (byId[m.playerId] = m));
  return { rising, falling, byId };
}

/** Quickly assess price risk for an arbitrary player id (used to flag user
 *  squad players that are about to fall, or transfer targets that are about
 *  to rise). */
export function priceRiskFor(
  playerId: number,
  report: PriceMoveReport,
  bsElementsById: Map<number, FplElement>,
): { text: string; tone: "warn" | "info" | null } {
  const move = report.byId[playerId];
  if (move) {
    if (move.direction === "rise") {
      return {
        text: `likely to rise tonight (${move.confidence})`,
        tone: "info",
      };
    }
    return {
      text: `likely to drop tonight (${move.confidence})`,
      tone: "warn",
    };
  }
  // No prediction — but flag if FPL has already moved it this GW.
  const el = bsElementsById.get(playerId);
  if (el && el.cost_change_event && el.cost_change_event !== 0) {
    const dir = el.cost_change_event > 0 ? "rose" : "dropped";
    return {
      text: `${dir} £${Math.abs(el.cost_change_event / 10).toFixed(1)}m this GW`,
      tone: "info",
    };
  }
  return { text: "", tone: null };
}
