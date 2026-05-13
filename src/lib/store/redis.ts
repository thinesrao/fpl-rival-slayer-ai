// Thin Upstash Redis wrapper with graceful fallback. If no creds are present
// the helpers return `null`/throw silently so the app still works without a
// store (AI cache becomes per-request, retrospective + push disabled).
//
// Accepts both the canonical Upstash env names AND the aliases the Upstash
// Vercel integration injects (KV_REST_API_URL / KV_REST_API_TOKEN), so the
// wizard-driven setup "just works" without extra config.

import { Redis } from "@upstash/redis";

function readUrl(): string | undefined {
  return (
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.STORAGE_REST_API_URL ||
    undefined
  );
}

function readToken(): string | undefined {
  return (
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN ||
    undefined
  );
}

let cached: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (cached !== undefined) return cached;
  const url = readUrl();
  const token = readToken();
  if (!url || !token) {
    cached = null;
    return null;
  }
  cached = new Redis({ url, token });
  return cached;
}

export const storeEnabled = Boolean(readUrl() && readToken());

export async function kvGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return (await r.get<T>(key)) ?? null;
  } catch (err) {
    console.warn("[store] get failed", key, err);
    return null;
  }
}

export async function kvSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    if (ttlSeconds && ttlSeconds > 0) {
      await r.set(key, value, { ex: ttlSeconds });
    } else {
      await r.set(key, value);
    }
  } catch (err) {
    console.warn("[store] set failed", key, err);
  }
}

export async function kvDel(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(key);
  } catch (err) {
    console.warn("[store] del failed", key, err);
  }
}
