// AI MD1 draft endpoint. Result is squad-agnostic pre-lock, so it's cached
// in Redis for 30 min to spare Gemini quota; POST { fresh: true } re-rolls.

import { NextRequest, NextResponse } from "next/server";
import { aiEnabled } from "@/lib/env";
import { kvGet, kvSet } from "@/lib/store/redis";
import { getWcContext } from "@/lib/wc/context";
import { runAiDraft, type DraftResult } from "@/lib/wc/ai/draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_KEY = "wc:ai:draft:v1";
const CACHE_TTL = 30 * 60;

export async function POST(req: NextRequest) {
  let fresh = false;
  try {
    const body = await req.json();
    fresh = Boolean((body as { fresh?: boolean })?.fresh);
  } catch {
    // empty body is fine
  }

  try {
    if (!fresh && aiEnabled) {
      const cached = await kvGet<DraftResult>(CACHE_KEY);
      if (cached) return NextResponse.json({ ...cached, cached: true });
    }

    const ctx = await getWcContext();
    const result = await runAiDraft(ctx, aiEnabled);
    if (result.aiUsed) await kvSet(CACHE_KEY, result, CACHE_TTL);
    return NextResponse.json({ ...result, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[wc/ai/draft]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
