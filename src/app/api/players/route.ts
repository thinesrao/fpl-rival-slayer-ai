// Slim player list for the squad-draft picker. Returns ~500 rows
// with just the fields we render (avoids shipping the full ~2.6MB
// bootstrap to the client).

import { NextResponse } from "next/server";
import { FplError, getBootstrap } from "@/lib/fpl/client";
import type { PickerPlayer, Position } from "@/lib/drafts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POSITION_MAP: Record<number, Position> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

export async function GET() {
  try {
    const bs = await getBootstrap();
    const teamShort = new Map(bs.teams.map((t) => [t.id, t.short_name]));
    const teamCode = new Map(bs.teams.map((t) => [t.id, t.code]));
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
    }));
    return NextResponse.json({ players, count: players.length }, {
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
