// MD1 squad optimizer: binary LP over a value-filtered pool, three build
// philosophies for candidate diversity, greedy fallback if the solver chokes.

import solver, { type LpModel } from "javascript-lp-solver";
import type { WcPlayer, WcPosition, WcRound } from "@/lib/wc/fifa/types";
import type { WcTeamIndex } from "@/lib/wc/fifa/teams";
import { FORMATION_LIMITS, SQUAD_SHAPE, type WcRoundRules } from "@/lib/wc/rules/config";
import { projectAll, type WcProjection } from "@/lib/wc/projections/model";

export interface CandidateSquad {
  label: "balanced" | "stars" | "differential";
  description: string;
  picks: number[];
  startingXI: number[];
  bench: number[];
  captainId: number;
  viceId: number;
  totalCost: number;
  projectedPoints: number;
}

const POSITIONS: WcPosition[] = ["GK", "DEF", "MID", "FWD"];
const POOL_PER_POSITION = 28;

interface BuildSpec {
  label: CandidateSquad["label"];
  description: string;
  /** Tweak a player's objective coefficient. */
  weight: (p: WcPlayer, proj: WcProjection) => number;
  /** Extra constraints injected into the model. */
  extraConstraints?: (model: LpModel, pool: WcPlayer[]) => void;
}

export function buildCandidates(
  players: WcPlayer[],
  round: WcRound,
  teamIndex: WcTeamIndex,
  rules: WcRoundRules,
  completedRounds: number,
): CandidateSquad[] {
  const projections = projectAll(players, round, teamIndex, completedRounds);

  // Pool: top N per position by value, available players only.
  const available = players.filter((p) => p.status === "playing" && projections.has(p.id));
  const pool: WcPlayer[] = [];
  for (const pos of POSITIONS) {
    const ranked = available
      .filter((p) => p.position === pos)
      .sort((a, b) => projections.get(b.id)!.value - projections.get(a.id)!.value);
    pool.push(...ranked.slice(0, POOL_PER_POSITION));
    // Make sure cheap enablers are in the pool even if mid-value.
    pool.push(
      ...ranked.filter((p) => p.price <= 4.5 && !pool.includes(p)).slice(0, 6),
    );
  }

  const specs: BuildSpec[] = [
    {
      label: "balanced",
      description: "Maximum projected points within budget",
      weight: (_p, proj) => proj.value,
    },
    {
      label: "stars",
      description: "Premium-heavy: at least three $9m+ stars, value bench",
      weight: (p, proj) => proj.value + (p.price >= 9 ? 0.6 : 0),
      extraConstraints: (model, poolPlayers) => {
        model.constraints["premiums"] = { min: 3 };
        for (const p of poolPlayers) {
          if (p.price >= 9) model.variables[`p${p.id}`]["premiums"] = 1;
        }
      },
    },
    {
      label: "differential",
      description: "Low-ownership tilt to chase Scouting Bonuses and rank jumps",
      weight: (p, proj) => proj.value - Math.log10(Math.max(p.percentSelected, 0.1) + 1) * 0.9,
    },
  ];

  const out: CandidateSquad[] = [];
  for (const spec of specs) {
    const picks = solveSquad(pool, projections, rules, spec) ?? greedySquad(pool, projections, rules);
    if (!picks) continue;
    out.push(assembleSquad(spec, picks, projections));
  }
  return out;
}

function solveSquad(
  pool: WcPlayer[],
  projections: Map<number, WcProjection>,
  rules: WcRoundRules,
  spec: BuildSpec,
): WcPlayer[] | null {
  const model: LpModel = {
    optimize: "value",
    opType: "max",
    constraints: {
      cost: { max: rules.budget },
      total: { equal: SQUAD_SHAPE.total },
      GK: { equal: SQUAD_SHAPE.GK },
      DEF: { equal: SQUAD_SHAPE.DEF },
      MID: { equal: SQUAD_SHAPE.MID },
      FWD: { equal: SQUAD_SHAPE.FWD },
    },
    variables: {},
    binaries: {},
  };

  const nationVar = new Map<number, string>();
  for (const p of pool) {
    const key = `p${p.id}`;
    const nationKey = `nation_${p.squadId}`;
    if (!nationVar.has(p.squadId)) {
      nationVar.set(p.squadId, nationKey);
      model.constraints[nationKey] = { max: rules.maxPerNation };
    }
    model.variables[key] = {
      value: spec.weight(p, projections.get(p.id)!),
      cost: p.price,
      total: 1,
      GK: p.position === "GK" ? 1 : 0,
      DEF: p.position === "DEF" ? 1 : 0,
      MID: p.position === "MID" ? 1 : 0,
      FWD: p.position === "FWD" ? 1 : 0,
      [nationKey]: 1,
    };
    model.binaries![key] = 1;
  }
  spec.extraConstraints?.(model, pool);

  try {
    const result = solver.Solve(model);
    if (!result.feasible) return null;
    const picks = pool.filter((p) => (result[`p${p.id}`] as number | undefined ?? 0) >= 0.99);
    return picks.length === SQUAD_SHAPE.total ? picks : null;
  } catch (err) {
    console.warn(`[wc/optimizer] LP solve failed for ${spec.label}`, err);
    return null;
  }
}

/** Greedy fallback: fill premium slots by value, then cheapest enablers. */
function greedySquad(
  pool: WcPlayer[],
  projections: Map<number, WcProjection>,
  rules: WcRoundRules,
): WcPlayer[] | null {
  const picks: WcPlayer[] = [];
  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 } as Record<WcPosition, number>;
  const nations = new Map<number, number>();
  let spent = 0;

  const ranked = [...pool].sort(
    (a, b) => projections.get(b.id)!.value - projections.get(a.id)!.value,
  );
  const fits = (p: WcPlayer, budgetCap: number) =>
    !picks.includes(p) &&
    counts[p.position] < SQUAD_SHAPE[p.position] &&
    (nations.get(p.squadId) ?? 0) < rules.maxPerNation &&
    spent + p.price <= budgetCap;

  // Keep headroom: reserve minimum spend for unfilled slots (3.5m floor each).
  for (const p of ranked) {
    const remainingSlots = SQUAD_SHAPE.total - picks.length - 1;
    if (!fits(p, rules.budget - remainingSlots * 3.5)) continue;
    picks.push(p);
    counts[p.position]++;
    nations.set(p.squadId, (nations.get(p.squadId) ?? 0) + 1);
    spent += p.price;
    if (picks.length === SQUAD_SHAPE.total) return picks;
  }
  return picks.length === SQUAD_SHAPE.total ? picks : null;
}

function assembleSquad(
  spec: BuildSpec,
  picks: WcPlayer[],
  projections: Map<number, WcProjection>,
): CandidateSquad {
  const xPts = (p: WcPlayer) => projections.get(p.id)?.xPts ?? 0;
  const { startingXI, bench } = pickLineup(picks, xPts);
  const sortedXI = [...startingXI].sort((a, b) => xPts(b) - xPts(a));
  const totalCost = Math.round(picks.reduce((s, p) => s + p.price, 0) * 10) / 10;
  return {
    label: spec.label,
    description: spec.description,
    picks: picks.map((p) => p.id),
    startingXI: startingXI.map((p) => p.id),
    bench: bench.map((p) => p.id),
    captainId: sortedXI[0].id,
    viceId: sortedXI[1].id,
    totalCost,
    projectedPoints: Math.round(startingXI.reduce((s, p) => s + xPts(p), 0) * 10) / 10,
  };
}

/** Best legal XI: strongest GK, formation bounds via marginal-value fill. */
export function pickLineup(
  picks: WcPlayer[],
  score: (p: WcPlayer) => number,
): { startingXI: WcPlayer[]; bench: WcPlayer[] } {
  const byPos = (pos: WcPosition) =>
    picks.filter((p) => p.position === pos).sort((a, b) => score(b) - score(a));

  const gks = byPos("GK");
  const xi: WcPlayer[] = [gks[0]];
  const defs = byPos("DEF");
  const mids = byPos("MID");
  const fwds = byPos("FWD");

  // Minimums first…
  xi.push(...defs.slice(0, FORMATION_LIMITS.DEF[0]));
  xi.push(...mids.slice(0, FORMATION_LIMITS.MID[0]));
  xi.push(...fwds.slice(0, FORMATION_LIMITS.FWD[0]));
  // …then best remaining outfielders up to caps.
  const rest = [
    ...defs.slice(FORMATION_LIMITS.DEF[0]),
    ...mids.slice(FORMATION_LIMITS.MID[0]),
    ...fwds.slice(FORMATION_LIMITS.FWD[0]),
  ].sort((a, b) => score(b) - score(a));
  for (const p of rest) {
    if (xi.length >= FORMATION_LIMITS.starters) break;
    const posCount = xi.filter((q) => q.position === p.position).length;
    const cap = FORMATION_LIMITS[p.position][1];
    if (posCount < cap) xi.push(p);
  }

  const bench = picks
    .filter((p) => !xi.includes(p))
    // Outfielders by score first, backup GK last (convention).
    .sort((a, b) => (a.position === "GK" ? 1 : 0) - (b.position === "GK" ? 1 : 0) || score(b) - score(a));
  return { startingXI: xi, bench };
}
