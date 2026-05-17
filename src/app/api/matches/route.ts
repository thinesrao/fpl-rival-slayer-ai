// GW-wide match list endpoint.
//
//   GET /api/matches?gw=<gw>   →  Match[] for the requested (or current) GW
//
// Defaults to the current event when gw isn't supplied. Caching is governed
// by the underlying `getLive` (CACHE_LIVE_GW = 60s) so this endpoint is
// effectively free to poll every minute.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FplError, currentEvent, getBootstrap, nextEvent } from "@/lib/fpl/client";
import { buildMatches } from "@/lib/fpl/matches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  gw: z.coerce.number().int().min(1).max(38).optional(),
  refresh: z.coerce.number().int().min(0).max(1).default(0),
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
    const bs = await getBootstrap();
    // Default to current event; fall back to next if current is unresolvable.
    const target = parsed.data.gw ?? currentEvent(bs)?.id ?? nextEvent(bs)?.id;
    if (!target) {
      return NextResponse.json({ error: "no_event", message: "No active gameweek found." }, { status: 404 });
    }
    const matches = await buildMatches(target);
    return NextResponse.json({ gw: target, matches });
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
