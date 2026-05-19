// Slim player list for the squad-draft picker. Returns ~500 rows
// with just the fields we render (avoids shipping the full ~2.6MB
// bootstrap to the client). Includes each player's next-GW opponent
// so draft tiles can show fixture info like the Suggested squad does.

import { NextResponse } from "next/server";
import { FplError, currentEvent, getBootstrap, getFixtures, nextEvent } from "@/lib/fpl/client";
import type { PickerPlayer, Position } from "@/lib/drafts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POSITION_MAP: Record<number, Position> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

export async function GET() {
  try {
    const bs = await getBootstrap();
    // Use nextEvent for the opponent lookup so drafts naturally plan for the
    // NEXT GW even mid-current-GW. Falls back to current if next is unavailable
    // (end of season).
    const next = nextEvent(bs) ?? currentEvent(bs);
    const targetGw = next?.id ?? 1;
    const fixtures = await getFixtures(targetGw).catch(() => []);

    const teamShort = new Map(bs.teams.map((t) => [t.id, t.short_name]));
    const teamCode = new Map(bs.teams.map((t) => [t.id, t.code]));

    // teamId → "MUN (H)" or "WHU (A)" for the upcoming GW. DGW teams get
    // both opponents joined by '+'; blank teams stay unset.
    const opponentByTeam = new Map<number, string>();
    for (const fx of fixtures) {
      if (fx.event !== targetGw) continue;
      const homeLabel = `${teamShort.get(fx.team_a) ?? "?"} (H)`;
      const awayLabel = `${teamShort.get(fx.team_h) ?? "?"} (A)`;
      const prevH = opponentByTeam.get(fx.team_h);
      opponentByTeam.set(fx.team_h, prevH ? `${prevH} + ${homeLabel}` : homeLabel);
      const prevA = opponentByTeam.get(fx.team_a);
      opponentByTeam.set(fx.team_a, prevA ? `${prevA} + ${awayLabel}` : awayLabel);
    }

    const players: PickerPlayer[] = bs.elements.map((e) => ({
      id: e.id,
      code: e.code,
      webName: e.web_name,
      team: teamShort.get(e.team) ?? "?",
      teamCode: teamCode.get(e.team) ?? 0,
      position: POSITION_MAP[e.element_type] ?? "MID",
      price: e.now_cost / 10,
      form: Number(e.form ?? 0),
      totalPoints: e.total_points,
      selectedByPct: Number(e.selected_by_percent ?? 0),
      status: e.status,
      news: e.news || undefined,
      nextOpponent: opponentByTeam.get(e.team) ?? null,
    }));
    return NextResponse.json({ players, count: players.length, gw: targetGw }, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=600" },
    });
  } catch (err) {
    if (err instanceof FplError) {
      return NextResponse.json({ error: "fpl_error", message: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "internal_error", message: msg }, { status: 500 });
  }
}
