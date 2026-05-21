import { NextResponse } from "next/server";
import { validateTeam } from "@/lib/auth/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const teamId = Number(url.searchParams.get("teamId"));
  const leagueIdRaw = url.searchParams.get("leagueId");
  const leagueId = leagueIdRaw ? Number(leagueIdRaw) : null;

  if (!Number.isInteger(teamId) || teamId <= 0) {
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "teamId must be a positive integer." },
      { status: 400 },
    );
  }
  if (leagueId !== null && (!Number.isInteger(leagueId) || leagueId <= 0)) {
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "leagueId must be a positive integer." },
      { status: 400 },
    );
  }

  const result = await validateTeam(teamId, leagueId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
