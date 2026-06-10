// Daily backstop that pre-warms API-Football lineups for matches kicking off
// within the next window (request-path polling normally triggers this).

import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getWcContext } from "@/lib/wc/context";
import { getLineupsIfDue } from "@/lib/wc/apifootball/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (env.CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const ctx = await getWcContext();
  const round = ctx.active ?? ctx.target;
  let fetched = 0;
  for (const m of round.tournaments) {
    const got = await getLineupsIfDue(m).catch(() => null);
    if (got) fetched++;
  }
  return NextResponse.json({ ok: true, lineupsFetched: fetched });
}
