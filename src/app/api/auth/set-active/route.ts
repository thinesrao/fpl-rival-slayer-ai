import { NextResponse } from "next/server";
import { setActiveTeamCookie } from "@/lib/auth/cookie";
import { validateTeamAndLeague } from "@/lib/auth/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { teamId?: unknown; leagueId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request", message: "Invalid JSON body." }, { status: 400 });
  }

  const teamId = Number(body.teamId);
  const leagueId = Number(body.leagueId);

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

  // Re-validate server-side so a hand-crafted POST can't set a cookie pointing
  // at random IDs.
  const result = await validateTeamAndLeague(teamId, leagueId);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  await setActiveTeamCookie(teamId, leagueId);
  return NextResponse.json({ ok: true });
}
