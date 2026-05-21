import { NextResponse } from "next/server";
import { FplError, getEntry } from "@/lib/fpl/client";
import type { MiniLeagueOption } from "@/lib/auth/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const teamId = Number(url.searchParams.get("teamId"));

  if (!Number.isInteger(teamId) || teamId <= 0) {
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "teamId must be a positive integer." },
      { status: 400 },
    );
  }

  try {
    const entry = await getEntry(teamId);
    const miniLeagues: MiniLeagueOption[] = (entry.leagues?.classic ?? [])
      .filter((l) => l.league_type === "x")
      .map((l) => ({ id: l.id, name: l.name, rank: l.entry_rank, size: l.rank_count }))
      .sort((a, b) => a.size - b.size);
    return NextResponse.json({ ok: true, miniLeagues });
  } catch (err) {
    if (err instanceof FplError) {
      const error = err.status === 404 ? "team_not_found" : "fpl_error";
      return NextResponse.json({ ok: false, error, message: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: "fpl_error", message: msg }, { status: 500 });
  }
}
