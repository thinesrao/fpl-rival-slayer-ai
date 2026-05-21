import { NextResponse } from "next/server";
import { clearActiveTeamCookie } from "@/lib/auth/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await clearActiveTeamCookie();
  return NextResponse.json({ ok: true });
}
