// Orchestrator: takes a RivalContext + bootstrap + fixtures and returns
// projections for every squad plus overtake odds. Exposed via /api/projections
// and reused server-side by /api/analysis.

import { hashSeed, mulberry32 } from "@/lib/decision/rng";
import { getFixtures } from "@/lib/fpl/client";
import type { FplBootstrap, RivalContext, SquadProjection } from "@/lib/types";
import { projectSquad } from "./model";
import { computeOvertakeOdds } from "./overtake";

export interface ProjectionsResult {
  gw: number;
  user: SquadProjection;
  rivals: SquadProjection[];
  overtake: ReturnType<typeof computeOvertakeOdds>;
}

export async function buildProjections(
  ctx: RivalContext,
  bs: FplBootstrap,
  gw: number,
): Promise<ProjectionsResult> {
  const fixtures = await getFixtures(gw);
  const user = projectSquad(ctx.user, fixtures, gw);
  const rivals = ctx.rivals.map((r) => projectSquad(r, fixtures, gw));
  const overtake = computeOvertakeOdds(
    ctx,
    user,
    rivals,
    2000,
    mulberry32(hashSeed("overtake", gw, ctx.user.entry.id)),
  );
  return { gw, user, rivals, overtake };
}
