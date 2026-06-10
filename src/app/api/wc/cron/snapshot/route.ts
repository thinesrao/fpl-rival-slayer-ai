// Daily backstop for the lazy snapshot refresh (freshness normally comes
// from request-path ensureSnapshot calls). Guarded by CRON_SECRET when set.

import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { ensureSnapshot } from "@/lib/wc/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (env.CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  await ensureSnapshot();
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
