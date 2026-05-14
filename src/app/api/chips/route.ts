// Chip status for the user + each rival in the mini-league context.
//
//   GET /api/chips?teamId&leagueId   →  { user: ChipStatus, rivals: Array<{ entryId, name, status }> }
//
// Lightweight — only fetches each manager's history (already cached server-side)
// plus the next 3 GWs of fixtures for the DGW/BGW behaviour hint.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FplError, getEntryHistory, getFixtures } from "@/lib/fpl/client";
import { buildRivalContext } from "@/lib/fpl/rivals";
import { analyseChips } from "@/lib/intel/rival-chips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  teamId: z.coerce.number().int().positive(),
  leagueId: z.coerce.number().int().positive(),
});

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const { context, bs, targetGw } = await buildRivalContext(parsed.data.leagueId, parsed.data.teamId, 3);
    const horizonGws = bs.events.filter((e) => e.id >= targetGw).slice(0, 3).map((e) => e.id);
    const horizonFixtures = await Promise.all(
      horizonGws.map((g) => getFixtures(g).then((fixtures) => ({ gw: g, fixtures }))),
    );

    const entryIds = [parsed.data.teamId, ...context.rivals.map((r) => r.entry.id)];
    const histories = await Promise.all(entryIds.map((id) => getEntryHistory(id).catch(() => null)));

    const userStatus = analyseChips({
      history: histories[0],
      squad: context.user,
      bs,
      horizonFixtures,
    });

    const rivals = context.rivals.map((r, i) => ({
      entryId: r.entry.id,
      name: r.entry.name,
      playerName: r.entry.player_name,
      activeChip: r.activeChip,
      status: analyseChips({
        history: histories[i + 1],
        squad: r,
        bs,
        horizonFixtures,
      }),
    }));

    return NextResponse.json({
      targetGw,
      horizonGws,
      user: {
        entryId: context.user.entry.id,
        name: context.user.entry.name,
        activeChip: context.user.activeChip,
        status: userStatus,
      },
      rivals,
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
