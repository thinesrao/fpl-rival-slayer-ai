// Turns the FPL player pool into candidates the wildcard optimiser can chew
// on: a horizon-weighted expected-points figure per player, and a pruned
// shortlist small enough to solve exactly.
//
// Why a horizon rather than one gameweek: a wildcard buys a squad you keep
// for weeks, so optimising purely on the next gameweek produces the classic
// mistake of loading up on whoever has the one good fixture and then paying
// to unwind it. Later gameweeks are discounted geometrically — they matter,
// but they are also less certain and more likely to be transferred away.
//
// Two sources for the per-gameweek number, because which one to trust is
// already a settled question in this repo. `npm run backtest` measures our
// closed-form model against FPL's own published `ep_next` on a held-out set,
// and FPL's is currently the more accurate of the two by a wide margin on
// ranking (Spearman 0.529 vs 0.158) — and ranking is exactly what a squad
// optimiser consumes. So "fpl" is the default while the ship gate fails, and
// the caller flips to "model" once it passes. Same gate, same direction, as
// the ModelTrustBadge disclosure.

import { getFixtures } from "@/lib/fpl/client";
import { projectPlayer } from "@/lib/projections/model";
import type { FplBootstrap, FplFixture, Position } from "@/lib/types";
import type { WildcardCandidate } from "./wildcard";

const POS_BY_ID: Record<number, Position> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

/** Statuses that mean the player cannot be selected at all. "d" (doubt) is
 *  kept — both xp sources already discount it by chance-of-playing. */
const UNSELECTABLE = new Set(["u", "n", "i", "s"]);

/** Each gameweek past the first is worth this much of the one before it. */
export const HORIZON_DECAY = 0.85;

export const DEFAULT_HORIZON = 5;

/**
 * How much a gameweek's fixture difficulty moves a player's baseline, per
 * point of FDR away from average. Deliberately gentle: it is a nudge across
 * later gameweeks, not a projection in its own right.
 */
const FDR_SENSITIVITY = 0.08;

/** Which expected-points number the objective is built from. */
export type XpSource = "fpl" | "model";

/** Geometric weights, first gameweek at full value. */
export function horizonWeights(n: number, decay = HORIZON_DECAY): number[] {
  return Array.from({ length: Math.max(1, n) }, (_, i) => decay ** i);
}

interface TeamGwFixtures {
  count: number;
  avgFdr: number;
}

/** Fixture count and mean difficulty per team for one gameweek. */
export function teamFixtureLoad(fixtures: readonly FplFixture[]): Map<number, TeamGwFixtures> {
  const acc = new Map<number, { count: number; fdrSum: number }>();
  const add = (teamId: number, fdr: number) => {
    const cur = acc.get(teamId) ?? { count: 0, fdrSum: 0 };
    cur.count += 1;
    cur.fdrSum += fdr;
    acc.set(teamId, cur);
  };
  for (const f of fixtures) {
    add(f.team_h, f.team_h_difficulty);
    add(f.team_a, f.team_a_difficulty);
  }
  return new Map(
    [...acc].map(([teamId, { count, fdrSum }]) => [
      teamId,
      { count, avgFdr: count > 0 ? fdrSum / count : 3 },
    ]),
  );
}

/**
 * Scale a player's baseline for a future gameweek: no fixture is worth
 * nothing, a double is worth roughly two, and an easy run is worth a little
 * more than a hard one.
 */
export function fixtureFactor(load: TeamGwFixtures | undefined): number {
  if (!load || load.count === 0) return 0;
  return load.count * Math.max(0, 1 + (3 - load.avgFdr) * FDR_SENSITIVITY);
}

export interface PoolLimits {
  /** Top N per position by weighted xp. */
  topPerPosition?: number;
  /** Top N per position *per club* — the squad may legally take three. */
  topPerPositionPerTeam?: number;
  /** Cheapest N per position, so there is always bench fodder to buy. */
  cheapestPerPosition?: number;
}

// Tuned against live data: the optimal squad is identical from ~170
// candidates up to the full 487-player pool, while solve time grows with it
// (1.4s at 173, 8.9s at 487). These limits sit just above where the answer
// stops changing. topPerPositionPerTeam stays at 3 because a squad may
// legally take three from one club and often wants to.
const DEFAULT_LIMITS: Required<PoolLimits> = {
  topPerPosition: 20,
  topPerPositionPerTeam: 3,
  cheapestPerPosition: 8,
};

/**
 * Drop players that cannot appear in an optimal squad.
 *
 * Three overlapping rules, unioned so a gap in one is covered by another:
 *
 *  - the cost/xp Pareto frontier — a player beaten on points by someone who
 *    also costs less is never worth buying;
 *  - the best few per position per club, because the three-per-club cap means
 *    the frontier's top names can be unavailable to each other;
 *  - the cheapest few per position, which is where a legal bench comes from.
 *
 * Verified against real bootstrap data: the optimum is unchanged from this
 * shortlist up to the full unpruned pool.
 */
export function pruneCandidates(
  candidates: readonly WildcardCandidate[],
  limits: PoolLimits = {},
): WildcardCandidate[] {
  const { topPerPosition, topPerPositionPerTeam, cheapestPerPosition } = {
    ...DEFAULT_LIMITS,
    ...limits,
  };
  const keep = new Set<number>();
  const byXpDesc = (a: WildcardCandidate, b: WildcardCandidate) =>
    b.xp - a.xp || a.playerId - b.playerId;

  for (const et of [1, 2, 3, 4] as const) {
    const group = candidates.filter((c) => c.elementType === et);

    [...group].sort(byXpDesc).slice(0, topPerPosition).forEach((c) => keep.add(c.playerId));

    [...group]
      .sort((a, b) => a.cost - b.cost || byXpDesc(a, b))
      .slice(0, cheapestPerPosition)
      .forEach((c) => keep.add(c.playerId));

    const perTeam = new Map<number, WildcardCandidate[]>();
    for (const c of group) {
      const list = perTeam.get(c.teamId) ?? [];
      list.push(c);
      perTeam.set(c.teamId, list);
    }
    for (const list of perTeam.values()) {
      list.sort(byXpDesc);
      list.slice(0, topPerPositionPerTeam).forEach((c) => keep.add(c.playerId));
    }

    // Pareto frontier on (cost ascending, xp): keep anyone who beats every
    // cheaper option in the same position.
    let bestSoFar = -Infinity;
    for (const c of [...group].sort((a, b) => a.cost - b.cost || byXpDesc(a, b))) {
      if (c.xp > bestSoFar) {
        bestSoFar = c.xp;
        keep.add(c.playerId);
      }
    }
  }

  return candidates.filter((c) => keep.has(c.playerId));
}

export interface BuildPoolArgs {
  bs: FplBootstrap;
  /** Gameweeks to project over, soonest first. */
  gws: readonly number[];
  /** Same length as `gws`; defaults to geometric decay. */
  weights?: readonly number[];
  limits?: PoolLimits;
  source?: XpSource;
  /** Injected in tests so the fixture fetch can be stubbed. */
  fetchFixtures?: (gw: number) => Promise<FplFixture[]>;
}

export interface WildcardPool {
  candidates: WildcardCandidate[];
  gws: number[];
  weights: number[];
  source: XpSource;
  /** Before pruning — reported so the API can show how much was considered. */
  consideredCount: number;
}

/** Project every selectable player across the horizon and prune the result. */
export async function buildWildcardPool(args: BuildPoolArgs): Promise<WildcardPool> {
  const { bs, gws, limits, source = "fpl" } = args;
  const fetchFixtures = args.fetchFixtures ?? getFixtures;
  const weights = [...(args.weights ?? horizonWeights(gws.length))];

  const fixturesByGw = await Promise.all(gws.map((gw) => fetchFixtures(gw).catch(() => [])));
  const loadByGw = fixturesByGw.map(teamFixtureLoad);
  const teamsById = new Map(bs.teams.map((t) => [t.id, t]));

  const selectable = bs.elements.filter((e) => {
    if (UNSELECTABLE.has(e.status)) return false;
    if (!POS_BY_ID[e.element_type]) return false;
    return teamsById.has(e.team);
  });

  const candidates: WildcardCandidate[] = selectable.map((player) => {
    const team = teamsById.get(player.team)!;
    const position = POS_BY_ID[player.element_type];

    let xp = 0;
    let captainXp = 0;

    if (source === "fpl") {
      // FPL's own next-gameweek number already prices in that gameweek's
      // opponent, so it is used as-is for the first week and scaled by
      // fixture load for the rest.
      const baseline = Number(player.ep_next) || 0;
      captainXp = baseline;
      gws.forEach((_gw, i) => {
        const factor = i === 0 ? 1 : fixtureFactor(loadByGw[i].get(player.team));
        xp += (weights[i] ?? 0) * baseline * factor;
      });
    } else {
      gws.forEach((gw, i) => {
        const { xPoints } = projectPlayer({ player, team, position, fixtures: fixturesByGw[i], gw });
        xp += (weights[i] ?? 0) * xPoints;
        if (i === 0) captainXp = xPoints;
      });
    }

    return {
      playerId: player.id,
      teamId: player.team,
      elementType: player.element_type as 1 | 2 | 3 | 4,
      cost: player.now_cost,
      xp: Number(xp.toFixed(4)),
      captainXp: Number(captainXp.toFixed(4)),
    };
  });

  return {
    candidates: pruneCandidates(candidates, limits),
    gws: [...gws],
    weights,
    source,
    consideredCount: candidates.length,
  };
}
