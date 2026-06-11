// AI MD1 draft endpoint. Result is squad-agnostic pre-lock, so it's cached
// in Redis for 30 min to spare Gemini quota; POST { fresh: true } re-rolls.

import { NextRequest, NextResponse } from "next/server";
import { aiEnabled } from "@/lib/env";
import { kvGet, kvSet } from "@/lib/store/redis";
import { getWcContext } from "@/lib/wc/context";
import { runAiDraft, type DraftResult } from "@/lib/wc/ai/draft";
import { friendlyGeminiError, isTransientGeminiError } from "@/lib/wc/ai/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Grounded Gemini 2.5 Pro draft review takes 50-90s; Fluid Compute allows
// up to 300s even on Hobby.
export const maxDuration = 300;

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
    console.error("[wc/ai/draft]", err);
    return NextResponse.json(
      { error: friendlyGeminiError(err) },
      { status: isTransientGeminiError(err) ? 503 : 500 },
    );
  }
}
