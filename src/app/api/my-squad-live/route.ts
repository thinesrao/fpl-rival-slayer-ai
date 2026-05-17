// Live pitch view of the user's current squad.
//
//   GET /api/my-squad-live?teamId=<id>&gw=<gw>?  →  MySquadLive
//
// Defaults to the current event. Caching follows the underlying `getLive`
// (60s) so polling every minute is effectively free.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FplError, currentEvent, getBootstrap, nextEvent, previousEvent } from "@/lib/fpl/client";
import { buildMySquadLive } from "@/lib/fpl/my-squad-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  teamId: z.coerce.number().int().positive(),
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
    // Default to current event; fall back to previous (post-GW) if current
    // isn't yet exposing picks; fall back to next (pre-deadline window).
    const target =
      parsed.data.gw ?? currentEvent(bs)?.id ?? previousEvent(bs)?.id ?? nextEvent(bs)?.id;
    if (!target) {
      return NextResponse.json(
        { error: "no_event", message: "No active gameweek found." },
        { status: 404 },
      );
    }
    const data = await buildMySquadLive(parsed.data.teamId, target);
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
