// Cron: twice daily. Captures the pre-deadline feature set for the upcoming
// gameweek, and the settled actuals for any finished gameweek not yet stored.

import { NextResponse } from "next/server";

import {
  buildPreDeadlineSnapshot,
  buildSettledSnapshot,
  snapshotKey,
} from "@/lib/backtest/snapshot";
import { currentEvent, getBootstrap, getLive, nextEvent } from "@/lib/fpl/client";
import { kvGet, kvSet, storeEnabled } from "@/lib/store/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RETENTION_SECONDS = 60 * 60 * 24 * 400;

export async function GET() {
  if (!storeEnabled) {
    return NextResponse.json({ ok: false, reason: "redis not configured" }, { status: 200 });
  }

  try {
    const bs = await getBootstrap();
    const capturedAt = new Date().toISOString();
    const upcoming = nextEvent(bs);
    const current = currentEvent(bs);
    const written: string[] = [];

    const preKey = snapshotKey("pre", upcoming.id);
    if ((await kvGet(preKey)) === null) {
      await kvSet(preKey, buildPreDeadlineSnapshot(bs, upcoming.id, capturedAt), RETENTION_SECONDS);
      written.push(preKey);
    }

    if (current.finished) {
      const settledKey = snapshotKey("settled", current.id);
      if ((await kvGet(settledKey)) === null) {
        const live = await getLive(current.id);
        await kvSet(settledKey, buildSettledSnapshot(live, current.id, capturedAt), RETENTION_SECONDS);
        written.push(settledKey);
      }
    }

    return NextResponse.json({ ok: true, written });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
