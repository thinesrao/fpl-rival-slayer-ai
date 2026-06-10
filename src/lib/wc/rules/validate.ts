// WC26 squad + lineup validation against the per-phase rules. Isomorphic:
// the builder runs it client-side for live feedback and the squad API re-runs
// it server-side before persisting.

import type { WcPlayer, WcPosition } from "@/lib/wc/fifa/types";
import type { WcTeam } from "@/lib/wc/fifa/types";
import { FORMATION_LIMITS, SQUAD_SHAPE, type WcRoundRules } from "./config";

export interface WcSquadValidation {
  ok: boolean;
  errors: string[];
  filled: number;
  totalCost: number;
  budget: number;
  bank: number;
  positionCounts: Record<WcPosition, number>;
  nationViolations: Array<{ team: string; count: number; max: number }>;
}

const POSITIONS: WcPosition[] = ["GK", "DEF", "MID", "FWD"];

export function validateWcSquad(
  picks: number[],
  byId: Map<number, WcPlayer>,
  teamById: Map<number, WcTeam>,
  rules: WcRoundRules,
): WcSquadValidation {
  const errors: string[] = [];
  const players = picks.map((id) => byId.get(id)).filter((p): p is WcPlayer => Boolean(p));

  if (players.length < picks.length) {
    errors.push(`${picks.length - players.length} pick(s) reference unknown players`);
  }
  if (new Set(picks).size !== picks.length) {
    errors.push("Duplicate players in squad");
  }

  const positionCounts = { GK: 0, DEF: 0, MID: 0, FWD: 0 } as Record<WcPosition, number>;
  for (const p of players) positionCounts[p.position]++;
  for (const pos of POSITIONS) {
    if (positionCounts[pos] > SQUAD_SHAPE[pos]) {
      errors.push(`Too many ${pos}s (${positionCounts[pos]}/${SQUAD_SHAPE[pos]})`);
    }
  }
  if (players.length < SQUAD_SHAPE.total) {
    errors.push(`${SQUAD_SHAPE.total - players.length} empty slot(s)`);
  }

  const totalCost = Math.round(players.reduce((s, p) => s + p.price, 0) * 10) / 10;
  if (totalCost > rules.budget) {
    errors.push(`Over budget ($${totalCost.toFixed(1)}m / $${rules.budget.toFixed(1)}m)`);
  }

  const nationCounts = new Map<number, number>();
  for (const p of players) nationCounts.set(p.squadId, (nationCounts.get(p.squadId) ?? 0) + 1);
  const nationViolations = [...nationCounts.entries()]
    .filter(([, n]) => n > rules.maxPerNation)
    .map(([squadId, count]) => ({
      team: teamById.get(squadId)?.name ?? `Team ${squadId}`,
      count,
      max: rules.maxPerNation,
    }));
  if (nationViolations.length > 0) {
    errors.push(
      `Max ${rules.maxPerNation} per nation: ` +
        nationViolations.map((v) => `${v.team} ×${v.count}`).join(", "),
    );
  }

  return {
    ok: errors.length === 0 && players.length === SQUAD_SHAPE.total,
    errors,
    filled: players.length,
    totalCost,
    budget: rules.budget,
    bank: Math.round((rules.budget - totalCost) * 10) / 10,
    positionCounts,
    nationViolations,
  };
}

export interface WcLineupValidation {
  ok: boolean;
  errors: string[];
}

export function validateWcLineup(
  startingXI: number[],
  bench: number[],
  captainId: number | null,
  viceId: number | null,
  byId: Map<number, WcPlayer>,
): WcLineupValidation {
  const errors: string[] = [];
  const xi = startingXI.map((id) => byId.get(id)).filter((p): p is WcPlayer => Boolean(p));

  if (startingXI.length !== FORMATION_LIMITS.starters) {
    errors.push(`Starting XI has ${startingXI.length}/11 players`);
  }
  const overlap = startingXI.filter((id) => bench.includes(id));
  if (overlap.length > 0) errors.push("Player(s) both starting and on bench");

  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 } as Record<WcPosition, number>;
  for (const p of xi) counts[p.position]++;
  for (const pos of POSITIONS) {
    const [min, max] = FORMATION_LIMITS[pos];
    if (counts[pos] < min) errors.push(`Formation needs at least ${min} ${pos}`);
    if (counts[pos] > max) errors.push(`Formation allows at most ${max} ${pos}`);
  }

  if (captainId == null || !startingXI.includes(captainId)) {
    errors.push("Captain must be in the starting XI");
  }
  if (viceId == null || !startingXI.includes(viceId)) {
    errors.push("Vice-captain must be in the starting XI");
  } else if (viceId === captainId) {
    errors.push("Captain and vice-captain must differ");
  }

  return { ok: errors.length === 0, errors };
}
