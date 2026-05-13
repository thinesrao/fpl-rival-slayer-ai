// End-to-end orchestrator: fetch rivals + projections, build a transfer
// shortlist, then ask Gemini for the final structured recommendation.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiEnabled } from "@/lib/env";
import { FplError, getEntry, getEntryHistory, getFixtures, currentEvent } from "@/lib/fpl/client";
import { buildRivalContext, computeDifferentials } from "@/lib/fpl/rivals";
import { computeFreeTransfers } from "@/lib/fpl/free-transfers";
import { buildProjections } from "@/lib/projections";
import { projectPlayer } from "@/lib/projections/model";
import { suggestTransfers } from "@/lib/optimizer/transfers";
import { askStrategist } from "@/lib/ai/gemini";
import { readAnalysis, writeAnalysis, writeSnapshot } from "@/lib/store/cache";
import { storeEnabled } from "@/lib/store/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Query = z.object({
  teamId: z.coerce.number().int().positive(),
  leagueId: z.coerce.number().int().positive(),
  n: z.coerce.number().int().min(1).max(5).default(3),
  refresh: z.coerce.boolean().default(false),
});

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.flatten() }, { status: 400 });
  }

  if (!aiEnabled) {
    return NextResponse.json(
      { error: "ai_disabled", message: "Set GEMINI_API_KEY to enable the AI strategist." },
      { status: 503 },
    );
  }

  try {
    const { context, bs, targetGw } = await buildRivalContext(
      parsed.data.leagueId,
      parsed.data.teamId,
      parsed.data.n,
    );

    // Cache lookup — skip when ?refresh=1.
    if (!parsed.data.refresh) {
      const cached = await readAnalysis(parsed.data.teamId, parsed.data.leagueId, targetGw);
      if (cached) {
        return NextResponse.json({
          ...(cached.payload as object),
          cachedAt: cached.cachedAt,
          cacheStatus: "hit" as const,
        });
      }
    }
    // Pull current-GW fixtures + a multi-GW horizon (next 3 GWs) so the AI
    // can pre-plan, plus history to derive the exact free-transfer count.
    const HORIZON_GWS = 3;
    const horizon = bs.events
      .filter((e) => e.id >= targetGw)
      .slice(0, HORIZON_GWS)
      .map((e) => e.id);

    const [projections, fixtures, horizonFixtures, entry, entryHistory] = await Promise.all([
      buildProjections(context, bs, targetGw),
      getFixtures(targetGw),
      Promise.all(horizon.map((g) => getFixtures(g).then((fx) => ({ gw: g, fixtures: fx })))),
      getEntry(parsed.data.teamId).catch(() => null),
      getEntryHistory(parsed.data.teamId).catch(() => null),
    ]);

    const differentials = computeDifferentials(context);

    // Compute xPts for differentials so the prompt is rich.
    const userOnlyEnriched = differentials.userOnly.slice(0, 6).map((s) => ({
      name: s.player.web_name,
      xPts: projectPlayer({ player: s.player, team: s.team, position: s.position, fixtures, gw: targetGw, bs }).xPoints,
    }));
    const rivalOnlyEnriched = differentials.rivalOnly.slice(0, 8).map((r) => ({
      name: r.slot.player.web_name,
      rival: r.rivalName,
      xPts: projectPlayer({
        player: r.slot.player,
        team: r.slot.team,
        position: r.slot.position,
        fixtures,
        gw: targetGw,
        bs,
      }).xPoints,
    }));

    const bank = entry?.last_deadline_bank ?? 0;
    const freeTransfers = entryHistory ? computeFreeTransfers(entryHistory).freeTransfers : 1;
    const shortlist = suggestTransfers(context.user, bank, bs, fixtures, targetGw);

    const target = bs.events.find((e) => e.id === targetGw) ?? currentEvent(bs);

    const ai = await askStrategist({
      ctx: context,
      gw: targetGw,
      deadline: target.deadline_time,
      userProjection: projections.user,
      rivalProjections: projections.rivals,
      overtake: projections.overtake,
      bank,
      freeTransfers,
      shortlist,
      differentials: { userOnly: userOnlyEnriched, rivalOnly: rivalOnlyEnriched },
      fixtures,
      horizonFixtures,
      bs,
    });

    const payload = {
      context,
      targetGw,
      deadline: target.deadline_time,
      projections,
      differentials: { userOnly: userOnlyEnriched, rivalOnly: rivalOnlyEnriched },
      shortlist,
      freeTransfers,
      bank,
      ai,
    };

    // Persist to cache + snapshot (best-effort; never blocks the response on failure).
    let cachedAt = new Date().toISOString();
    if (storeEnabled) {
      const stored = await writeAnalysis(
        parsed.data.teamId,
        parsed.data.leagueId,
        targetGw,
        payload,
        target.deadline_time,
      );
      cachedAt = stored.cachedAt;
      // Fire-and-forget snapshot — used later by the Retrospective tab.
      writeSnapshot(parsed.data.teamId, parsed.data.leagueId, targetGw, payload).catch(() => {});
    }

    return NextResponse.json({
      ...payload,
      cachedAt,
      cacheStatus: parsed.data.refresh ? ("refreshed" as const) : ("miss" as const),
    });
  } catch (err) {
    if (err instanceof FplError) {
      return NextResponse.json({ error: "fpl_error", status: err.status, message: err.message }, {
        status: err.status === 404 ? 404 : 502,
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    const rawText = (err as { rawText?: string }).rawText;
    return NextResponse.json(
      rawText ? { error: "internal_error", message, rawText } : { error: "internal_error", message },
      { status: 500 },
    );
  }
}

