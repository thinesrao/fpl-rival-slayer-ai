// Cron: twice daily. Captures the pre-deadline feature set for the upcoming
// gameweek, and the settled actuals for the current gameweek once it has
// finished. Only ever touches the single upcoming/current gameweek on each
// run — it does not backfill a settled snapshot missed during a cron outage.

import { NextResponse } from "next/server";

import {
  buildPreDeadlineSnapshot,
  buildSettledSnapshot,
  snapshotKey,
} from "@/lib/backtest/snapshot";
import { currentEvent, getBootstrap, getLive, nextEvent } from "@/lib/fpl/client";
import { getRedis, storeEnabled } from "@/lib/store/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RETENTION_SECONDS = 60 * 60 * 24 * 400;

export async function GET() {
  if (!storeEnabled) {
    return NextResponse.json({ ok: false, reason: "redis not configured" }, { status: 200 });
  }
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ ok: false, reason: "redis not configured" }, { status: 200 });
  }

  try {
    const bs = await getBootstrap();
    const capturedAt = new Date().toISOString();
    const upcoming = nextEvent(bs);
    const current = currentEvent(bs);
    const written: string[] = [];

    // set with { nx: true } only writes if the key is absent, and reports back
    // via its return value ("OK" = created, null = already existed) — so the
    // existence check and the write are one atomic Redis operation. A prior
    // pre-deadline snapshot can never be clobbered by post-deadline data, even
    // if an earlier read of the key failed transiently.
    const preKey = snapshotKey("pre", upcoming.id);
    const preResult = await redis.set(preKey, buildPreDeadlineSnapshot(bs, upcoming.id, capturedAt), {
      ex: RETENTION_SECONDS,
      nx: true,
    });
    if (preResult === "OK") written.push(preKey);

    if (current.finished) {
      const settledKey = snapshotKey("settled", current.id);
      const live = await getLive(current.id);
      const settledResult = await redis.set(
        settledKey,
        buildSettledSnapshot(live, current.id, capturedAt),
        { ex: RETENTION_SECONDS, nx: true },
      );
      if (settledResult === "OK") written.push(settledKey);
    }

    return NextResponse.json({ ok: true, written });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
