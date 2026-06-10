// Lazy player-feed snapshotting + delta detection. Vercel Hobby crons are
// daily, so freshness comes from request handlers calling ensureSnapshot()
// inline: if the stored snapshot is >15 min old, diff the live feed against
// it and append meaningful changes (availability flips, big ownership moves)
// to a capped delta list. The cron route is just a once-a-day backstop.

import { kvGet, kvSet, storeEnabled } from "@/lib/store/redis";
import { getWcPlayers, displayName } from "./fifa/client";
import type { WcPlayer } from "./fifa/types";

const SNAPSHOT_KEY = "wc:snapshot:players";
const SNAPSHOT_TS_KEY = "wc:snapshot:ts";
const DELTAS_KEY = "wc:deltas";
const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;
const DELTAS_TTL_S = 72 * 3600;
const DELTAS_CAP = 200;

interface SnapshotEntry {
  status: string;
  percentSelected: number;
  price: number;
}

export interface WcDelta {
  at: string;
  playerId: number;
  player: string;
  kind: "status" | "ownership";
  detail: string;
}

function toEntry(p: WcPlayer): SnapshotEntry {
  return { status: p.status, percentSelected: p.percentSelected, price: p.price };
}

export async function ensureSnapshot(): Promise<void> {
  if (!storeEnabled) return;
  const ts = await kvGet<number>(SNAPSHOT_TS_KEY);
  if (ts && Date.now() - ts < SNAPSHOT_MAX_AGE_MS) return;
  // Claim the slot immediately so concurrent requests don't re-diff.
  await kvSet(SNAPSHOT_TS_KEY, Date.now());

  const players = await getWcPlayers();
  const prev = await kvGet<Record<string, SnapshotEntry>>(SNAPSHOT_KEY);

  if (prev) {
    const deltas: WcDelta[] = [];
    const now = new Date().toISOString();
    for (const p of players) {
      const old = prev[String(p.id)];
      if (!old) continue;
      if (old.status !== p.status) {
        deltas.push({
          at: now,
          playerId: p.id,
          player: displayName(p),
          kind: "status",
          detail: `${old.status} → ${p.status}`,
        });
      } else if (
        p.percentSelected >= 3 &&
        Math.abs(p.percentSelected - old.percentSelected) >= 2
      ) {
        deltas.push({
          at: now,
          playerId: p.id,
          player: displayName(p),
          kind: "ownership",
          detail: `ownership ${old.percentSelected.toFixed(1)}% → ${p.percentSelected.toFixed(1)}%`,
        });
      }
    }
    if (deltas.length > 0) {
      const existing = (await kvGet<WcDelta[]>(DELTAS_KEY)) ?? [];
      await kvSet(DELTAS_KEY, [...deltas, ...existing].slice(0, DELTAS_CAP), DELTAS_TTL_S);
    }
  }

  const entries: Record<string, SnapshotEntry> = {};
  for (const p of players) entries[String(p.id)] = toEntry(p);
  await kvSet(SNAPSHOT_KEY, entries);
}

export async function recentDeltas(limit = 30): Promise<WcDelta[]> {
  const deltas = (await kvGet<WcDelta[]>(DELTAS_KEY)) ?? [];
  return deltas.slice(0, limit);
}
