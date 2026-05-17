// Player detail endpoint for the Pitch tab modal.
//
//   GET /api/player-detail?playerId=<id>&teamId=<id>?&leagueId=<id>?&gw=<gw>?
//
// teamId and leagueId are optional — when supplied, the response includes
// per-league "started by" rows (top-N managers in the league who own this
// player). Without them, that section is empty.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FplError } from "@/lib/fpl/client";
import { buildPlayerDetail } from "@/lib/fpl/player-detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  playerId: z.coerce.number().int().positive(),
  teamId: z.coerce.number().int().positive().optional(),
  leagueId: z.coerce.number().int().positive().optional(),
  gw: z.coerce.number().int().min(1).max(38).optional(),
});

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const data = await buildPlayerDetail(parsed.data);
    return NextResponse.json(data);
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
