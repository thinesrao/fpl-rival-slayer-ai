// Captures our own copy of each gameweek so the backtest benchmark doesn't
// depend on the archive's patchy xP coverage. Two captures per gameweek: the
// pre-deadline feature set for the upcoming gameweek, and the settled actuals
// for the current gameweek once it has finished.
//
// This is invoked from the daily deadline-watch cron (Hobby plan allows only
// two cron jobs, so this piggybacks on the one that already runs daily) and
// from the manually-invocable /api/cron/snapshot route.

import {
  buildPreDeadlineSnapshot,
  buildSettledSnapshot,
  snapshotKey,
} from "@/lib/backtest/snapshot";
import { currentEvent, getBootstrap, getLive, nextEvent } from "@/lib/fpl/client";
import { getRedis, storeEnabled } from "@/lib/store/redis";

const RETENTION_SECONDS = 60 * 60 * 24 * 400;

export interface CaptureResult {
  ok: boolean;
  written: string[];
  reason?: string;
}

export async function captureGameweekSnapshots(): Promise<CaptureResult> {
  if (!storeEnabled) {
    return { ok: false, written: [], reason: "redis not configured" };
  }
  const redis = getRedis();
  if (!redis) {
    return { ok: false, written: [], reason: "redis not configured" };
  }

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

  return { ok: true, written };
}
