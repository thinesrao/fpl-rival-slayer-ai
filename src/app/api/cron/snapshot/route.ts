// Not on the Vercel cron schedule: Hobby permits only two cron jobs, so this
// capture is driven by the daily deadline-watch cron instead (see
// src/app/api/cron/deadline-watch/route.ts, which calls
// captureGameweekSnapshots() directly). This route stays for manual
// invocation during testing, and for a future move to a paid plan where it
// could get its own schedule again.

import { NextResponse } from "next/server";

import { captureGameweekSnapshots } from "@/lib/backtest/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const result = await captureGameweekSnapshots();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
