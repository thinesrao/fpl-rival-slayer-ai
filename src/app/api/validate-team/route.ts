import { NextResponse } from "next/server";
import { validateTeamAndLeague } from "@/lib/auth/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const teamId = Number(url.searchParams.get("teamId"));
  const leagueId = Number(url.searchParams.get("leagueId"));

  if (!Number.isInteger(teamId) || teamId <= 0) {
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "teamId must be a positive integer." },
      { status: 400 },
    );
  }
  if (!Number.isInteger(leagueId) || leagueId <= 0) {
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "leagueId must be a positive integer." },
      { status: 400 },
    );
  }

  const result = await validateTeamAndLeague(teamId, leagueId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
