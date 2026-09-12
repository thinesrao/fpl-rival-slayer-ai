// Suggest the best wildcard squad: the highest-scoring legal 15 the manager
// could buy with their whole team value, plus the XI and armband to start
// from it.
//
// Budget is the manager's real spending power — bank plus what the current
// squad is worth — not a flat £100m, so the suggestion is one they can
// actually execute. Pass `budget` to override (e.g. to plan a wildcard for a
// team you don't own).
//
// Returns the same DraftSeed shape as /api/my-squad-draft-seed and
// /api/my-team, so the Drafts tab opens it in the editor like any other
// squad and the manager can tweak it or run the AI critique on it.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import report from "@/data/model-report.json";
import { buildDraftSeed, type SeedPick } from "@/lib/drafts/seed";
import { FplError, getBootstrap, getEntry, targetEvent } from "@/lib/fpl/client";
import { loadLatestPicks } from "@/lib/fpl/latest-picks";
import { optimiseWildcardSquad, solveWildcardSquad } from "@/lib/optimizer/wildcard";
import { DEFAULT_HORIZON, buildWildcardPool, type XpSource } from "@/lib/optimizer/wildcard-pool";
import type { ModelReport } from "@/lib/projections/model-report";
import type { FplBootstrap } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Solving dominates; every fetch together is ~0.2s. The default search is
// sub-second, but `exact=1` runs the MILP, which has been measured as high as
// 13.5s on a real pool. Leave headroom for it.
export const maxDuration = 60;

const FALLBACK_BUDGET = 1000;

const Query = z.object({
  teamId: z.coerce.number().int().positive().optional(),
  /** Gameweeks to optimise over, the first weighted most. */
  horizon: z.coerce.number().int().min(1).max(10).default(DEFAULT_HORIZON),
  /** Tenths of a million. Overrides the manager's real spending power. */
  budget: z.coerce.number().int().min(400).max(2000).optional(),
  source: z.enum(["fpl", "model"]).optional(),
  benchWeight: z.coerce.number().min(0).max(1).optional(),
  /**
   * Solve exactly instead of with the default search. Guarantees the optimum
   * and usually costs a few hundred milliseconds, but the branch-and-bound
   * has no time bound and has been measured at 13.5s — hence not the default.
   */
  exact: z.coerce.boolean().optional(),
});

/**
 * Which expected-points source to optimise on by default.
 *
 * The repo's own backtest decides this, not a preference: while the ship gate
 * fails, our closed-form model is measurably worse than FPL's published
 * `ep_next` at ranking players, and ranking is all a squad optimiser reads.
 * The same gate drives the ModelTrustBadge disclosure, so the two never
 * disagree about which number to trust.
 */
function defaultSource(): XpSource {
  return (report as ModelReport).shipGate.passes ? "model" : "fpl";
}

/** The manager's real wildcard budget: bank + the sale value of all 15. */
async function spendingPower(
  teamId: number,
  bs: FplBootstrap,
): Promise<{ budget: number; bank: number; squadValue: number } | null> {
  try {
    const [{ picks }, entry] = await Promise.all([
      loadLatestPicks(teamId, bs),
      // The picks carry the same bank figure, so a 503 here (FPL settling
      // after a deadline) is no reason to fail the whole suggestion.
      getEntry(teamId).catch(() => null),
    ]);
    const nowCostById = new Map(bs.elements.map((e) => [e.id, e.now_cost]));
    const squadValue = picks.picks.reduce((sum, p) => sum + (nowCostById.get(p.element) ?? 0), 0);
    const bank = entry?.last_deadline_bank ?? picks.entry_history?.bank ?? 0;
    return { budget: bank + squadValue, bank, squadValue };
  } catch (err) {
    // A manager with no published picks yet (or a bad id) still gets a
    // suggestion — just against the default budget rather than their own.
    if (err instanceof FplError && err.status === 404) return null;
    throw err;
  }
}

export async function GET(req: NextRequest) {
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  }
  const {
    teamId,
    horizon,
    budget: budgetOverride,
    source: sourceOverride,
    benchWeight,
    exact = false,
  } = parsed.data;

  try {
    const bs = await getBootstrap();
    const startGw = targetEvent(bs)?.id ?? 1;
    const gws = bs.events
      .filter((e) => e.id >= startGw)
      .slice(0, horizon)
      .map((e) => e.id);

    const power = teamId ? await spendingPower(teamId, bs) : null;
    const budget = budgetOverride ?? power?.budget ?? FALLBACK_BUDGET;
    const source = sourceOverride ?? defaultSource();

    const pool = await buildWildcardPool({ bs, gws, source });
    const solve = exact ? optimiseWildcardSquad : solveWildcardSquad;
    const solution = solve(pool.candidates, { budget, benchWeight });

    if (!solution.feasible) {
      return NextResponse.json(
        { error: "infeasible", message: solution.reason ?? "No legal squad found." },
        { status: 422 },
      );
    }

    const elementTypeById = new Map(bs.elements.map((e) => [e.id, e.element_type]));
    const webNameById = new Map(bs.elements.map((e) => [e.id, e.web_name]));
    const costById = new Map(bs.elements.map((e) => [e.id, e.now_cost]));

    // FPL slot numbering: 1..11 the XI, 12 the reserve keeper, 13..15 the
    // outfield subs in autosub order. buildDraftSeed reads the bench off it.
    const slotOf = new Map<number, number>();
    solution.startingXI.forEach((id, i) => slotOf.set(id, i + 1));
    solution.bench.forEach((id, i) => slotOf.set(id, 12 + i));

    const seedPicks: SeedPick[] = solution.squad.map((id) => ({
      elementId: id,
      position: slotOf.get(id) ?? 15,
      isCaptain: id === solution.captainId,
      isVice: id === solution.viceId,
      value: costById.get(id) ?? 0,
    }));

    const seed = buildDraftSeed({
      gw: startGw,
      bank: budget - solution.totalCost,
      picks: seedPicks,
      elementTypeById,
      webNameById,
      activeChip: "wildcard",
      source: "suggested",
    });

    return NextResponse.json({
      ...seed,
      // buildDraftSeed derives the cap from bank + squad value, which for a
      // suggestion is the budget we solved against. Say so explicitly.
      budget,
      optimiser: {
        source,
        method: exact ? "exact" : "search",
        /** The search lands within ~0.3% of the optimum; the MILP is exact. */
        approximate: !exact,
        horizon: pool.gws,
        weights: pool.weights.map((w) => Number(w.toFixed(3))),
        candidatesConsidered: pool.consideredCount,
        candidatesSearched: pool.candidates.length,
        /** Expected points of the suggested XI next gameweek, captain doubled. */
        startingXp: solution.startingXp,
        horizonXp: solution.squadXp,
        spentOfBudget: solution.totalCost,
        /** Present when the budget came from the manager's own squad. */
        spendingPower: power,
      },
    });
  } catch (err) {
    if (err instanceof FplError) {
      return NextResponse.json({ error: "fpl_error", message: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "internal_error", message: msg }, { status: 500 });
  }
}
