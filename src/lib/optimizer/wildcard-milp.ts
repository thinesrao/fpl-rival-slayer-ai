// Exact wildcard squad optimiser.
//
// A wildcard rebuilds all 15 players against one budget, so unlike the
// single-swap suggester in ./transfers this is a genuine combinatorial
// problem: choose 15 players AND the XI you'd start from them, subject to
// FPL's squad shape, the budget, and the three-per-club cap. Greedy
// selection gets this wrong in a specific way — it spends early on the best
// available player and then cannot afford a legal back five — so we solve it
// as a mixed-integer program and take the optimum.
//
// The formulation, per candidate i:
//
//   s_i ∈ {0,1}   i is in the 15
//   x_i ∈ {0,1}   i starts          (x_i ≤ s_i)
//   c_i ∈ {0,1}   i wears the armband (c_i ≤ x_i)
//
//   maximise  Σ benchWeight·xp_i·s_i + (1−benchWeight)·xp_i·x_i + capXp_i·c_i
//
// A starter therefore scores its full xp (both terms), a benched player only
// `benchWeight` of it, and the captain adds a second helping. Bench fodder
// being worth a fraction of its xp is what stops the solver from spending
// £20m on players who will never start.
//
// Solve time is driven by the candidate count, so ./wildcard-pool prunes the
// ~650-player pool to the couple of hundred that can appear in an optimal
// squad. Measured against real bootstrap data, the objective is identical at
// pool sizes 83 through 474 — the pruning costs nothing and is ~10x faster.

import solver from "javascript-lp-solver";
import type { LpConstraint, LpVariable } from "javascript-lp-solver";

/** FPL squad shape: 2 GK, 5 DEF, 5 MID, 3 FWD. */
export const SQUAD_SHAPE: Record<1 | 2 | 3 | 4, number> = { 1: 2, 2: 5, 3: 5, 4: 3 };

/** Legal starting-XI bounds per position (1 GK, 3-5 DEF, 2-5 MID, 1-3 FWD). */
export const XI_BOUNDS: Record<1 | 2 | 3 | 4, { min: number; max: number }> = {
  1: { min: 1, max: 1 },
  2: { min: 3, max: 5 },
  3: { min: 2, max: 5 },
  4: { min: 1, max: 3 },
};

const POS_KEY: Record<1 | 2 | 3 | 4, string> = { 1: "gkp", 2: "def", 3: "mid", 4: "fwd" };

export interface WildcardCandidate {
  playerId: number;
  teamId: number;
  elementType: 1 | 2 | 3 | 4;
  /** Tenths of a million. */
  cost: number;
  /** Horizon-weighted expected points — what the squad is optimised on. */
  xp: number;
  /** Next gameweek's expected points. Only next week's armband is being chosen. */
  captainXp: number;
}

export interface WildcardOptions {
  /** Tenths of a million: bank + the sale value of the squad being replaced. */
  budget: number;
  /**
   * What a benched player's xp is worth relative to a starter's, 0..1.
   * Low but non-zero: a bench that never plays still covers rotation and
   * autosubs, and a squad of 11 stars plus four £3.9m ghosts is fragile.
   */
  benchWeight?: number;
  maxPerTeam?: number;
  /** Players the squad must contain (e.g. one the manager refuses to sell). */
  lockedIds?: readonly number[];
  excludedIds?: readonly number[];
}

export interface WildcardSolution {
  feasible: boolean;
  /** Set when `feasible` is false — why no legal squad exists. */
  reason?: string;
  /** All 15, in FPL slot order: GK1, GK2, DEF1..5, MID1..5, FWD1..3. */
  squad: number[];
  startingXI: number[];
  /** Autosub order: bench GK first, then outfield subs best-first. */
  bench: number[];
  captainId: number | null;
  viceId: number | null;
  formation: string;
  /** Tenths of a million. */
  totalCost: number;
  /** Expected points of the XI, captain doubled, for the next gameweek. */
  startingXp: number;
  /** Horizon-weighted xp across all 15. */
  squadXp: number;
}

const INFEASIBLE: WildcardSolution = {
  feasible: false,
  squad: [],
  startingXI: [],
  bench: [],
  captainId: null,
  viceId: null,
  formation: "",
  totalCost: 0,
  startingXp: 0,
  squadXp: 0,
};

/** Cheapest legal squad, used to tell "budget too low" from "no legal shape". */
function cheapestLegalCost(pool: WildcardCandidate[]): number | null {
  let total = 0;
  for (const et of [1, 2, 3, 4] as const) {
    const byCost = pool.filter((p) => p.elementType === et).sort((a, b) => a.cost - b.cost);
    if (byCost.length < SQUAD_SHAPE[et]) return null;
    total += byCost.slice(0, SQUAD_SHAPE[et]).reduce((s, p) => s + p.cost, 0);
  }
  return total;
}

/**
 * Pick the highest-scoring legal 15 and the XI to start from it.
 *
 * Deterministic: candidates are sorted by id before the model is built, so
 * the solver explores the same branches in the same order every call.
 */
export function optimiseWildcardSquad(
  candidates: readonly WildcardCandidate[],
  options: WildcardOptions,
): WildcardSolution {
  const { budget, benchWeight = 0.12, maxPerTeam = 3 } = options;
  const locked = new Set(options.lockedIds ?? []);
  const excluded = new Set(options.excludedIds ?? []);

  const pool = candidates
    .filter((c) => !excluded.has(c.playerId) || locked.has(c.playerId))
    .slice()
    .sort((a, b) => a.playerId - b.playerId);

  if (pool.length === 0) return { ...INFEASIBLE, reason: "No candidate players available." };

  const cheapest = cheapestLegalCost(pool);
  if (cheapest === null) {
    return { ...INFEASIBLE, reason: "Not enough players in every position to fill a squad." };
  }
  if (cheapest > budget) {
    return {
      ...INFEASIBLE,
      reason: `Budget of £${(budget / 10).toFixed(1)}m can't buy a legal 15 — the cheapest is £${(cheapest / 10).toFixed(1)}m.`,
    };
  }

  const variables: Record<string, LpVariable> = {};
  const binaries: Record<string, number> = {};
  const constraints: Record<string, LpConstraint> = {
    budget: { max: budget },
    squad: { equal: 15 },
    xi: { equal: 11 },
    cap: { equal: 1 },
  };

  for (const et of [1, 2, 3, 4] as const) {
    constraints[`s_${POS_KEY[et]}`] = { equal: SQUAD_SHAPE[et] };
    constraints[`x_${POS_KEY[et]}`] = { min: XI_BOUNDS[et].min, max: XI_BOUNDS[et].max };
  }
  for (const teamId of new Set(pool.map((p) => p.teamId))) {
    constraints[`team_${teamId}`] = { max: maxPerTeam };
  }

  for (const c of pool) {
    const pos = POS_KEY[c.elementType];
    const s = `s${c.playerId}`;
    const x = `x${c.playerId}`;
    const cap = `c${c.playerId}`;

    variables[s] = {
      score: benchWeight * c.xp,
      budget: c.cost,
      squad: 1,
      [`s_${pos}`]: 1,
      [`team_${c.teamId}`]: 1,
      [`link${c.playerId}`]: -1,
    };
    variables[x] = {
      score: (1 - benchWeight) * c.xp,
      xi: 1,
      [`x_${pos}`]: 1,
      [`link${c.playerId}`]: 1,
      [`capx${c.playerId}`]: -1,
    };
    variables[cap] = { score: c.captainXp, cap: 1, [`capx${c.playerId}`]: 1 };

    // x_i - s_i <= 0 and c_i - x_i <= 0.
    constraints[`link${c.playerId}`] = { max: 0 };
    constraints[`capx${c.playerId}`] = { max: 0 };

    if (locked.has(c.playerId)) {
      constraints[`lock${c.playerId}`] = { equal: 1 };
      variables[s][`lock${c.playerId}`] = 1;
    }

    binaries[s] = 1;
    binaries[x] = 1;
    binaries[cap] = 1;
  }

  const result = solver.Solve({
    optimize: "score",
    opType: "max",
    constraints,
    variables,
    binaries,
  });

  if (!result.feasible) {
    return { ...INFEASIBLE, reason: "No squad satisfies the budget and three-per-club limits." };
  }

  const chosen = pool.filter((c) => result[`s${c.playerId}`] === 1);
  const starters = pool.filter((c) => result[`x${c.playerId}`] === 1);

  // The solver can only report a squad of the size the constraints demand, but
  // a malformed model would surface here rather than as a wrong suggestion.
  if (chosen.length !== 15 || starters.length !== 11) {
    return { ...INFEASIBLE, reason: "Solver returned an incomplete squad." };
  }

  const starterIds = new Set(starters.map((c) => c.playerId));
  const benched = chosen.filter((c) => !starterIds.has(c.playerId));

  const byXpDesc = (a: WildcardCandidate, b: WildcardCandidate) =>
    b.xp - a.xp || a.playerId - b.playerId;

  const startingXI = [1, 2, 3, 4]
    .flatMap((et) => starters.filter((c) => c.elementType === et).sort(byXpDesc))
    .map((c) => c.playerId);

  // FPL benches the reserve keeper at slot 12; the outfield subs follow in
  // autosub priority, best first.
  const benchGk = benched.filter((c) => c.elementType === 1).sort(byXpDesc);
  const benchOutfield = benched.filter((c) => c.elementType !== 1).sort(byXpDesc);
  const bench = [...benchGk, ...benchOutfield].map((c) => c.playerId);

  const squad = [1, 2, 3, 4]
    .flatMap((et) => {
      const inPos = chosen.filter((c) => c.elementType === et);
      const start = inPos.filter((c) => starterIds.has(c.playerId)).sort(byXpDesc);
      const rest = inPos.filter((c) => !starterIds.has(c.playerId)).sort(byXpDesc);
      return [...start, ...rest];
    })
    .map((c) => c.playerId);

  const captain = pool.find((c) => result[`c${c.playerId}`] === 1) ?? null;
  const vice =
    [...starters]
      .filter((c) => c.playerId !== captain?.playerId)
      .sort((a, b) => b.captainXp - a.captainXp || a.playerId - b.playerId)[0] ?? null;

  const counts = { DEF: 0, MID: 0, FWD: 0 };
  for (const c of starters) {
    if (c.elementType === 2) counts.DEF++;
    if (c.elementType === 3) counts.MID++;
    if (c.elementType === 4) counts.FWD++;
  }

  const startingXp =
    starters.reduce((sum, c) => sum + c.captainXp, 0) + (captain ? captain.captainXp : 0);

  return {
    feasible: true,
    squad,
    startingXI,
    bench,
    captainId: captain?.playerId ?? null,
    viceId: vice?.playerId ?? null,
    formation: `${counts.DEF}-${counts.MID}-${counts.FWD}`,
    totalCost: chosen.reduce((sum, c) => sum + c.cost, 0),
    startingXp: Number(startingXp.toFixed(2)),
    squadXp: Number(chosen.reduce((sum, c) => sum + c.xp, 0).toFixed(2)),
  };
}
