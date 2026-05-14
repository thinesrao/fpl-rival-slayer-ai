// What-If swap simulator.
//
//   GET  /api/whatif?teamId&leagueId&outId             → candidate list for that OUT player
//   POST /api/whatif  { teamId, leagueId, outId, inId } → simulate the swap end-to-end
//
// Exploratory only — never persists anything. Re-uses the same rival context
// + projection model the dashboard already shows so deltas are apples-to-apples.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FplError, getEntry, getFixtures } from "@/lib/fpl/client";
import { buildRivalContext } from "@/lib/fpl/rivals";
import { buildProjections } from "@/lib/projections";
import { rankReplacements } from "@/lib/optimizer/candidates";
import { simulateSwap } from "@/lib/optimizer/whatif";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Query = z.object({
  teamId: z.coerce.number().int().positive(),
  leagueId: z.coerce.number().int().positive(),
  outId: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

const PostBody = z.object({
  teamId: z.coerce.number().int().positive(),
  leagueId: z.coerce.number().int().positive(),
  outId: z.coerce.number().int().positive(),
  inId: z.coerce.number().int().positive(),
});

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const { context, bs, targetGw } = await buildRivalContext(parsed.data.leagueId, parsed.data.teamId, 3);
    const [fixtures, entry] = await Promise.all([
      getFixtures(targetGw),
      getEntry(parsed.data.teamId).catch(() => null),
    ]);
    const bank = entry?.last_deadline_bank ?? 0;

    const outSlot = context.user.picks.find((s) => s.player.id === parsed.data.outId);
    if (!outSlot) {
      return NextResponse.json({ error: "not_in_squad", message: "Player isn't in your current squad." }, { status: 400 });
    }
    const ownedIds = new Set(context.user.picks.map((s) => s.player.id));
    const teamCounts = new Map<number, number>();
    for (const s of context.user.picks) {
      if (s.player.id === parsed.data.outId) continue;
      teamCounts.set(s.player.team, (teamCounts.get(s.player.team) ?? 0) + 1);
    }
    const candidates = rankReplacements({
      outPlayer: outSlot.player,
      bank,
      ownedIds,
      teamCounts,
      bs,
      fixtures,
      gw: targetGw,
      limit: parsed.data.limit,
    });
    return NextResponse.json({
      outPlayer: {
        id: outSlot.player.id,
        webName: outSlot.player.web_name,
        teamShort: outSlot.team.short_name,
        cost: outSlot.player.now_cost,
        position: outSlot.position,
      },
      bank,
      candidates,
    });
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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", detail: parsed.error.flatten() }, { status: 400 });
  }
  const { teamId, leagueId, outId, inId } = parsed.data;
  try {
    const { context, bs, targetGw } = await buildRivalContext(leagueId, teamId, 3);
    const [projections, fixtures, entry] = await Promise.all([
      buildProjections(context, bs, targetGw),
      getFixtures(targetGw),
      getEntry(teamId).catch(() => null),
    ]);
    const bank = entry?.last_deadline_bank ?? 0;

    const result = simulateSwap({
      ctx: context,
      userSquad: context.user,
      userProjection: projections.user,
      rivalProjections: projections.rivals,
      baselineOvertake: projections.overtake,
      bank,
      outId,
      inId,
      bs,
      fixtures,
      gw: targetGw,
    });

    return NextResponse.json({
      result,
      baseline: {
        startingXi: projections.user.startingXIPoints,
        overtake: projections.overtake,
      },
    });
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
