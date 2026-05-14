// Top-N ownership map for the user's mini-league.
//
//   GET /api/league-ownership?leagueId&gw=current&top=10
//
// `gw` defaults to the latest GW picks are available for (the same one the
// dashboard uses). Bounded to top≤25 to keep fan-out reasonable.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FplError, currentEvent, getBootstrap, previousEvent } from "@/lib/fpl/client";
import { computeLeagueOwnership } from "@/lib/intel/league-ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  leagueId: z.coerce.number().int().positive(),
  gw: z.coerce.number().int().min(1).max(38).optional(),
  top: z.coerce.number().int().min(1).max(25).default(10),
});

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const bs = await getBootstrap();
    // Default to current GW; fall back to the previous one if current picks
    // aren't published yet (handled per-manager inside computeLeagueOwnership).
    const cur = currentEvent(bs);
    const prev = previousEvent(bs);
    const gw = parsed.data.gw ?? cur.id ?? prev?.id ?? 1;
    const result = await computeLeagueOwnership(parsed.data.leagueId, gw, bs, parsed.data.top);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof FplError) {
      return NextResponse.json(
        { error: "fpl_error", status: err.status, message: err.message },
        { status: err.status === 404 ? 404 : 502 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}
