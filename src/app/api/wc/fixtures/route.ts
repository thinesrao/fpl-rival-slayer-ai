// Schedule + group tables, derived entirely from the official feed.

import { NextResponse } from "next/server";
import { getWcContext } from "@/lib/wc/context";
import { buildGroupTables, toScheduleMatch } from "@/lib/wc/fixtures";
import { WcFeedError } from "@/lib/wc/fifa/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getWcContext();
    const matches = ctx.rounds.flatMap((r) => r.tournaments.map((m) => toScheduleMatch(r, m)));
    const groups = Object.fromEntries(buildGroupTables(ctx.rounds, ctx.teamIndex));
    return NextResponse.json({
      matches,
      groups,
      activeRoundId: ctx.active?.id ?? null,
      targetRoundId: ctx.target.id,
    });
  } catch (err) {
    const status = err instanceof WcFeedError ? 502 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status },
    );
  }
}
