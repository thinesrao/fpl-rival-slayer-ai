// The decision spine's data source. Deterministic and AI-free: it composes the
// rival context, projections and transfer options the app already builds, then
// runs the paired simulation and the recommendation rule over them.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { decide } from "@/lib/decision/decide";
import { FplError, getEntry, getEntryHistory, getFixtures, targetEvent } from "@/lib/fpl/client";
import { computeFreeTransfers } from "@/lib/fpl/free-transfers";
import { buildRivalContext } from "@/lib/fpl/rivals";
import { generateTransferOptions } from "@/lib/optimizer/transfer-options";
import { buildProjections } from "@/lib/projections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Below this gameweek the rolling window has too little history to trust. */
const MIN_GW_FOR_HISTORY = 4;

const Query = z.object({
  teamId: z.coerce.number().int().positive(),
  leagueId: z.coerce.number().int().positive(),
  n: z.coerce.number().int().min(1).max(5).default(3),
});

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { context, bs, targetGw } = await buildRivalContext(
      parsed.data.leagueId,
      parsed.data.teamId,
      parsed.data.n,
    );
    const [projections, fixtures, entry, entryHistory] = await Promise.all([
      buildProjections(context, bs, targetGw),
      getFixtures(targetGw),
      getEntry(parsed.data.teamId).catch(() => null),
      getEntryHistory(parsed.data.teamId).catch(() => null),
    ]);

    const bank = entry?.last_deadline_bank ?? 0;
    // Assume no free transfer when we cannot read the history. Charging a hit we
    // might not owe suppresses a recommendation; skipping one we do owe invents a
    // 4-point edge, so the safe direction is to assume the cost.
    const freeTransfers = entryHistory ? computeFreeTransfers(entryHistory).freeTransfers : 0;

    const transferOptions = generateTransferOptions({
      ctx: context,
      userProjection: projections.user,
      rivalProjections: projections.rivals,
      baselineOvertake: projections.overtake,
      bank,
      bs,
      fixtures,
      gw: targetGw,
    });

    const event = targetEvent(bs);
    const decision = decide({
      squad: context.user,
      userProjection: projections.user,
      rivals: context.rivals.map((r, i) => ({
        entryId: r.entry.id,
        name: r.entry.name,
        projection: projections.rivals[i],
        pointsBehind: Math.max(0, r.entry.total - context.user.entry.total),
      })),
      transferOptions,
      freeTransfers,
      deadline: { gw: targetGw, iso: event.deadline_time },
      now: Date.now(),
      minHistoryMet: targetGw >= MIN_GW_FOR_HISTORY,
    });

    return NextResponse.json(decision, { headers: { "cache-control": "no-store" } });
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
