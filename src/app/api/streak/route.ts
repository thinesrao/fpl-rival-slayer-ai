// Tiny derivation route — computes a "consecutive GWs above your own
// season average" streak from /entry/{id}/history. Cheap (one upstream
// FPL call); the bootstrap cache amortizes the rest.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FplError, getEntryHistory } from "@/lib/fpl/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  teamId: z.coerce.number().int().positive(),
});

export async function GET(req: NextRequest) {
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }
  try {
    const h = await getEntryHistory(parsed.data.teamId);
    const rows = (h.current ?? []).map((c) => ({
      event: c.event,
      net: c.points - c.event_transfers_cost,
    }));
    if (rows.length === 0) {
      return NextResponse.json({ count: 0, average: 0, sample: 0, currentGwNet: 0 });
    }
    const average = rows.reduce((s, r) => s + r.net, 0) / rows.length;

    // Walk backward from the most recent GW: count consecutive entries
    // whose net points are strictly greater than the season average.
    let count = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].net > average) count++;
      else break;
    }
    return NextResponse.json({
      count,
      average: Math.round(average * 10) / 10,
      sample: rows.length,
      currentGwNet: rows[rows.length - 1].net,
    });
  } catch (err) {
    if (err instanceof FplError) {
      return NextResponse.json({ error: "fpl_error", message: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "internal_error", message: msg }, { status: 500 });
  }
}
