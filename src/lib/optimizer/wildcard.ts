// Shared vocabulary for wildcard squad building: what a candidate is, what a
// legal squad looks like, how a squad is scored, and the local-search solver
// the app actually runs.
//
// There are two solvers. ./wildcard-milp states the problem exactly as a
// mixed-integer program and is the reference answer. It is not what serves
// requests: `javascript-lp-solver`'s branch-and-bound has no time bound and
// its cost swings wildly with how tight the budget is — measured on one real
// gameweek it ranged from 10ms to 13.5s, with the worst cases landing on
// exactly the budget a real manager has (their whole team value, spent to the
// last £0.1m), and a symmetric synthetic pool of only 144 variables never
// finished at all. A user-facing route cannot take that.
//
// So the default is `solveWildcardSquad` below: a deterministic multi-start
// search over same-position swaps, plus the two-move exchange that funds an
// upgrade with a downgrade elsewhere. On the real pool it runs in 96-698ms
// and lands within 0.29% of the exact optimum; wildcard.test.ts records the
// full measurement and guards against the search regressing.

import {
  SQUAD_SHAPE,
  type WildcardCandidate,
  type WildcardOptions,
  type WildcardSolution,
} from "./wildcard-milp";

export {
  SQUAD_SHAPE,
  XI_BOUNDS,
  optimiseWildcardSquad,
  type WildcardCandidate,
  type WildcardOptions,
  type WildcardSolution,
} from "./wildcard-milp";

/** The legal DEF-MID-FWD shapes an XI can take. */
export const FORMATIONS: Array<[def: number, mid: number, fwd: number]> = [
  [3, 4, 3],
  [3, 5, 2],
  [4, 3, 3],
  [4, 4, 2],
  [4, 5, 1],
  [5, 3, 2],
  [5, 4, 1],
];

export const DEFAULT_BENCH_WEIGHT = 0.12;

const byXpDesc = (a: WildcardCandidate, b: WildcardCandidate) =>
  b.xp - a.xp || a.playerId - b.playerId;

export interface SquadEvaluation {
  /** Objective value: XI xp + benchWeight × bench xp + the captain's second helping. */
  score: number;
  startingXI: WildcardCandidate[];
  bench: WildcardCandidate[];
  captain: WildcardCandidate | null;
  formation: string;
}

/**
 * Score a legal 15 by picking the best XI, bench and armband from it.
 *
 * Every formation is tried because the best XI is not simply the eleven
 * highest scorers — the shape bounds (at least three defenders, at most three
 * forwards) can make a lower-scoring player compulsory.
 */
export function evaluateSquad(
  squad: readonly WildcardCandidate[],
  benchWeight = DEFAULT_BENCH_WEIGHT,
): SquadEvaluation {
  const byPos: Record<1 | 2 | 3 | 4, WildcardCandidate[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const c of squad) byPos[c.elementType].push(c);
  for (const et of [1, 2, 3, 4] as const) byPos[et].sort(byXpDesc);

  const totalXp = squad.reduce((sum, c) => sum + c.xp, 0);
  let best: SquadEvaluation | null = null;

  for (const [def, mid, fwd] of FORMATIONS) {
    if (byPos[1].length < 1 || byPos[2].length < def) continue;
    if (byPos[3].length < mid || byPos[4].length < fwd) continue;

    const xi = [
      ...byPos[1].slice(0, 1),
      ...byPos[2].slice(0, def),
      ...byPos[3].slice(0, mid),
      ...byPos[4].slice(0, fwd),
    ];
    const xiXp = xi.reduce((sum, c) => sum + c.xp, 0);
    const captain = xi.reduce<WildcardCandidate | null>(
      (top, c) => (!top || c.captainXp > top.captainXp ? c : top),
      null,
    );
    // Starters score in full, the bench at `benchWeight`, so the whole squad
    // at bench rate plus the starters' remaining share.
    const score =
      benchWeight * totalXp + (1 - benchWeight) * xiXp + (captain?.captainXp ?? 0);

    if (!best || score > best.score) {
      const xiIds = new Set(xi.map((c) => c.playerId));
      const benchGk = byPos[1].filter((c) => !xiIds.has(c.playerId));
      const benchOutfield = [...byPos[2], ...byPos[3], ...byPos[4]]
        .filter((c) => !xiIds.has(c.playerId))
        .sort(byXpDesc);
      best = {
        score,
        startingXI: xi,
        // FPL benches the reserve keeper at slot 12; outfield subs follow in
        // autosub priority, best first.
        bench: [...benchGk, ...benchOutfield],
        captain,
        formation: `${def}-${mid}-${fwd}`,
      };
    }
  }

  return (
    best ?? {
      score: -Infinity,
      startingXI: [],
      bench: [],
      captain: null,
      formation: "",
    }
  );
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

function toSolution(squad: readonly WildcardCandidate[], benchWeight: number): WildcardSolution {
  const evaluation = evaluateSquad(squad, benchWeight);
  const { startingXI, bench, captain } = evaluation;
  const vice =
    startingXI
      .filter((c) => c.playerId !== captain?.playerId)
      .sort((a, b) => b.captainXp - a.captainXp || a.playerId - b.playerId)[0] ?? null;

  const ordered = [1, 2, 3, 4].flatMap((et) => {
    const starters = startingXI.filter((c) => c.elementType === et).sort(byXpDesc);
    const benched = bench.filter((c) => c.elementType === et).sort(byXpDesc);
    return [...starters, ...benched];
  });

  const startingXp =
    startingXI.reduce((sum, c) => sum + c.captainXp, 0) + (captain?.captainXp ?? 0);

  return {
    feasible: true,
    squad: ordered.map((c) => c.playerId),
    startingXI: startingXI.map((c) => c.playerId),
    bench: bench.map((c) => c.playerId),
    captainId: captain?.playerId ?? null,
    viceId: vice?.playerId ?? null,
    formation: evaluation.formation,
    totalCost: squad.reduce((sum, c) => sum + c.cost, 0),
    startingXp: Number(startingXp.toFixed(2)),
    squadXp: Number(squad.reduce((sum, c) => sum + c.xp, 0).toFixed(2)),
  };
}

/** Cheapest legal squad, used to tell "budget too low" from "no legal shape". */
function cheapestLegalCost(pool: readonly WildcardCandidate[]): number | null {
  let total = 0;
  for (const et of [1, 2, 3, 4] as const) {
    const byCost = pool.filter((p) => p.elementType === et).sort((a, b) => a.cost - b.cost);
    if (byCost.length < SQUAD_SHAPE[et]) return null;
    total += byCost.slice(0, SQUAD_SHAPE[et]).reduce((s, p) => s + p.cost, 0);
  }
  return total;
}

interface Seed {
  /** Ranking used to fill the squad greedily; ties break on id for determinism. */
  rank: (c: WildcardCandidate) => number;
}

/**
 * Several greedy starting points, because each is blind in a different way:
 * pure points overspends on premiums and cannot afford a legal bench, pure
 * value buys fifteen cheap players, and the blends sit between. Steepest
 * ascent from all of them, best result wins.
 */
const SEEDS: Seed[] = [
  { rank: (c) => c.xp },
  { rank: (c) => c.xp / Math.max(1, c.cost) },
  { rank: (c) => c.xp - c.cost / 100 },
  { rank: (c) => c.xp - c.cost / 40 },
  { rank: (c) => c.xp - c.cost / 15 },
  // Cheapest-first. Never a good squad, but it is the seed most likely to
  // find *a* legal squad when the budget barely covers one, and the ascent
  // takes it from there.
  { rank: (c) => -c.cost },
];

/**
 * Fill a legal 15 greedily by `rank`, skipping anyone who would break the
 * budget, the club cap, or leave too little money for the slots still empty.
 */
function greedySquad(
  pool: readonly WildcardCandidate[],
  budget: number,
  rank: (c: WildcardCandidate) => number,
  locked: ReadonlySet<number>,
  maxPerTeam: number,
): WildcardCandidate[] | null {
  const need: Record<1 | 2 | 3 | 4, number> = { ...SQUAD_SHAPE };
  const squad: WildcardCandidate[] = [];
  const clubs = new Map<number, number>();
  let spent = 0;

  const take = (c: WildcardCandidate) => {
    squad.push(c);
    need[c.elementType]--;
    clubs.set(c.teamId, (clubs.get(c.teamId) ?? 0) + 1);
    spent += c.cost;
  };

  for (const c of pool.filter((p) => locked.has(p.playerId))) {
    if (need[c.elementType] <= 0) return null;
    take(c);
  }
  if (spent > budget) return null;

  // Cheapest still-unpicked option per position, so the greedy pass can tell
  // whether a purchase leaves enough to fill the slots that remain. These
  // must shrink as players are taken — counting an already-bought player as
  // still available understates the reserve and lets the pass overspend into
  // a dead end it then reports as infeasible.
  const remainingCosts: Record<1 | 2 | 3 | 4, number[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const et of [1, 2, 3, 4] as const) {
    remainingCosts[et] = pool
      .filter((p) => p.elementType === et && !locked.has(p.playerId))
      .map((p) => p.cost)
      .sort((a, b) => a - b);
  }
  const dropCost = (et: 1 | 2 | 3 | 4, cost: number) => {
    const at = remainingCosts[et].indexOf(cost);
    if (at >= 0) remainingCosts[et].splice(at, 1);
  };
  for (const c of squad) dropCost(c.elementType, c.cost);

  const reserveFor = (skip: 1 | 2 | 3 | 4, skipCost: number) => {
    let reserve = 0;
    for (const et of [1, 2, 3, 4] as const) {
      const count = et === skip ? need[et] - 1 : need[et];
      if (count <= 0) continue;
      const costs = remainingCosts[et];
      let taken = 0;
      let skipped = false;
      for (const cost of costs) {
        if (taken >= count) break;
        // The player being bought is no longer available to cover a later slot.
        if (et === skip && !skipped && cost === skipCost) {
          skipped = true;
          continue;
        }
        reserve += cost;
        taken++;
      }
      if (taken < count) return Number.POSITIVE_INFINITY;
    }
    return reserve;
  };

  const ranked = [...pool]
    .filter((p) => !locked.has(p.playerId))
    .sort((a, b) => rank(b) - rank(a) || a.playerId - b.playerId);

  while (squad.length < 15) {
    let picked: WildcardCandidate | null = null;
    for (const c of ranked) {
      if (need[c.elementType] <= 0) continue;
      if (squad.some((s) => s.playerId === c.playerId)) continue;
      if ((clubs.get(c.teamId) ?? 0) >= maxPerTeam) continue;
      if (spent + c.cost + reserveFor(c.elementType, c.cost) > budget) continue;
      picked = c;
      break;
    }
    if (!picked) return null;
    take(picked);
    dropCost(picked.elementType, picked.cost);
  }
  return squad;
}

/**
 * Steepest ascent over same-position swaps.
 *
 * Swapping like for like keeps 2/5/5/3 intact automatically, and since every
 * legal squad has that shape, the neighbourhood reaches the whole feasible
 * space. Each pass takes the single best improving swap; multi-start covers
 * the local optima one swap at a time cannot escape.
 */
function improve(
  squad: WildcardCandidate[],
  pool: readonly WildcardCandidate[],
  options: { budget: number; benchWeight: number; maxPerTeam: number; locked: ReadonlySet<number> },
  maxPasses = 60,
): WildcardCandidate[] {
  const { budget, benchWeight, maxPerTeam, locked } = options;
  let current = squad;
  let currentScore = evaluateSquad(current, benchWeight).score;

  for (let pass = 0; pass < maxPasses; pass++) {
    let bestSquad: WildcardCandidate[] | null = null;
    let bestScore = currentScore;

    const owned = new Set(current.map((c) => c.playerId));
    const spent = current.reduce((s, c) => s + c.cost, 0);
    const clubs = new Map<number, number>();
    for (const c of current) clubs.set(c.teamId, (clubs.get(c.teamId) ?? 0) + 1);

    for (let i = 0; i < current.length; i++) {
      const out = current[i];
      if (locked.has(out.playerId)) continue;

      for (const inc of pool) {
        if (inc.elementType !== out.elementType) continue;
        if (owned.has(inc.playerId)) continue;
        if (spent - out.cost + inc.cost > budget) continue;
        const clubCount = (clubs.get(inc.teamId) ?? 0) - (out.teamId === inc.teamId ? 1 : 0);
        if (clubCount >= maxPerTeam) continue;

        const next = current.slice();
        next[i] = inc;
        const score = evaluateSquad(next, benchWeight).score;
        // Strict improvement only, so the search always terminates.
        if (score > bestScore + 1e-9) {
          bestScore = score;
          bestSquad = next;
        }
      }
    }

    // One swap at a time cannot reach a squad that needs an upgrade funded by
    // a downgrade elsewhere — each half is a loss on its own. When the plain
    // ascent stalls, look for those two moves together. Restricted to the
    // upgrades worth wanting and the cheap players a downgrade lands on, so
    // the pass stays bounded.
    if (!bestSquad) {
      const paired = bestFundedUpgrade(current, pool, {
        budget,
        benchWeight,
        maxPerTeam,
        locked,
        floor: currentScore,
      });
      if (paired) {
        bestSquad = paired.squad;
        bestScore = paired.score;
      }
    }

    if (!bestSquad) break;
    current = bestSquad;
    currentScore = bestScore;
  }

  return current;
}

/** How many of the best unowned players are treated as upgrades worth funding. */
const FUNDED_UPGRADE_TARGETS = 30;
/** How many of the cheapest per position a downgrade may land on. */
const DOWNGRADE_TARGETS_PER_POSITION = 12;

/**
 * Find the best "sell two, buy two" move: bring in one player the squad
 * cannot currently afford, and pay for them by downgrading one other slot.
 */
function bestFundedUpgrade(
  current: readonly WildcardCandidate[],
  pool: readonly WildcardCandidate[],
  options: {
    budget: number;
    benchWeight: number;
    maxPerTeam: number;
    locked: ReadonlySet<number>;
    floor: number;
  },
): { squad: WildcardCandidate[]; score: number } | null {
  const { budget, benchWeight, maxPerTeam, locked, floor } = options;
  const owned = new Set(current.map((c) => c.playerId));
  const spent = current.reduce((s, c) => s + c.cost, 0);

  const upgrades = pool
    .filter((c) => !owned.has(c.playerId))
    .sort(byXpDesc)
    .slice(0, FUNDED_UPGRADE_TARGETS);

  const cheapByPos: Record<1 | 2 | 3 | 4, WildcardCandidate[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const et of [1, 2, 3, 4] as const) {
    cheapByPos[et] = pool
      .filter((c) => c.elementType === et && !owned.has(c.playerId))
      .sort((a, b) => a.cost - b.cost || byXpDesc(a, b))
      .slice(0, DOWNGRADE_TARGETS_PER_POSITION);
  }

  let best: { squad: WildcardCandidate[]; score: number } | null = null;
  let bestScore = floor;

  const clubCount = (squad: readonly WildcardCandidate[], teamId: number) =>
    squad.reduce((n, c) => n + (c.teamId === teamId ? 1 : 0), 0);

  for (const inc of upgrades) {
    for (let i = 0; i < current.length; i++) {
      const out = current[i];
      if (out.elementType !== inc.elementType || locked.has(out.playerId)) continue;

      const shortfall = spent - out.cost + inc.cost - budget;
      // Affordable outright: the plain one-swap scan already covered it.
      if (shortfall <= 0) continue;

      const afterFirst = current.slice();
      afterFirst[i] = inc;
      if (clubCount(afterFirst, inc.teamId) > maxPerTeam) continue;

      for (let j = 0; j < afterFirst.length; j++) {
        if (j === i) continue;
        const out2 = afterFirst[j];
        if (locked.has(out2.playerId)) continue;

        for (const inc2 of cheapByPos[out2.elementType]) {
          if (inc2.playerId === inc.playerId) continue;
          if (inc2.cost > out2.cost - shortfall) continue;

          const next = afterFirst.slice();
          next[j] = inc2;
          if (clubCount(next, inc2.teamId) > maxPerTeam) continue;

          const score = evaluateSquad(next, benchWeight).score;
          if (score > bestScore + 1e-9) {
            bestScore = score;
            best = { squad: next, score };
          }
        }
      }
    }
  }

  return best;
}

/**
 * Pick the highest-scoring legal 15 and the XI to start from it.
 *
 * Deterministic for a given pool and options: the seeds, the scan order and
 * every tie-break are fixed.
 */
export function solveWildcardSquad(
  candidates: readonly WildcardCandidate[],
  options: WildcardOptions,
): WildcardSolution {
  const { budget, benchWeight = DEFAULT_BENCH_WEIGHT, maxPerTeam = 3 } = options;
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

  let best: WildcardCandidate[] | null = null;
  let bestScore = -Infinity;

  const ascendFrom = (start: WildcardCandidate[] | null) => {
    if (!start) return;
    const improved = improve(start, pool, { budget, benchWeight, maxPerTeam, locked });
    const score = evaluateSquad(improved, benchWeight).score;
    if (score > bestScore) {
      bestScore = score;
      best = improved;
    }
  };

  for (const seed of SEEDS) {
    ascendFrom(greedySquad(pool, budget, seed.rank, locked, maxPerTeam));
  }



  if (!best) {
    return {
      ...INFEASIBLE,
      reason: "No squad satisfies the budget and three-per-club limits.",
    };
  }

  return toSolution(best, benchWeight);
}
