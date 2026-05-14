import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { FplError, bustBootstrap } from "@/lib/fpl/client";
import { buildRivalContext } from "@/lib/fpl/rivals";
import { buildProjections } from "@/lib/projections";
import { buildHorizon } from "@/lib/projections/horizon";
import { computeEffectiveOwnership } from "@/lib/intel/effective-ownership";
import { computePriceMoves } from "@/lib/intel/price-changes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  teamId: z.coerce.number().int().positive(),
  leagueId: z.coerce.number().int().positive(),
  n: z.coerce.number().int().min(1).max(5).default(3),
  refresh: z.coerce.number().int().min(0).max(1).default(0),
  horizon: z.coerce.number().int().min(1).max(5).default(3),
});

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.refresh) {
    bustBootstrap();
    revalidateTag("fpl-live");
    revalidateTag("fpl-fixtures");
    revalidateTag("fpl-element-summary");
  }

  try {
    const { context, bs, targetGw } = await buildRivalContext(
      parsed.data.leagueId,
      parsed.data.teamId,
      parsed.data.n,
    );
    const [projections, horizon] = await Promise.all([
      buildProjections(context, bs, targetGw),
      buildHorizon(context, bs, targetGw, parsed.data.horizon),
    ]);
    const eo = computeEffectiveOwnership(context, bs);
    const priceMoves = computePriceMoves(bs);
    return NextResponse.json({
      context,
      projections,
      horizon,
      targetGw,
      eo,
      priceMoves,
      teams: bs.teams,
    });
  } catch (err) {
    if (err instanceof FplError) {
      return NextResponse.json({ error: "fpl_error", status: err.status, message: err.message }, {
        status: err.status === 404 ? 404 : 502,
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}
