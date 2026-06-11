// Matchday coach endpoint: needs the user's squad (by uid or inline) and
// returns the round plan. Cached per uid+round for 15 min.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiEnabled } from "@/lib/env";
import { kvGet, kvSet } from "@/lib/store/redis";
import { getWcContext } from "@/lib/wc/context";
import { ensureSnapshot } from "@/lib/wc/snapshot";
import { isWcSquadState, type WcSquadState } from "@/lib/wc/squad/types";
import { runCoach, toCoachMemory, type CoachMemory, type CoachResult } from "@/lib/wc/ai/coach";
import { friendlyGeminiError, isTransientGeminiError } from "@/lib/wc/ai/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Grounded coach call mirrors the draft flow's latency profile.
export const maxDuration = 300;

const Body = z.object({
  uid: z.string().min(1).max(64),
  fresh: z.boolean().optional(),
  squad: z.unknown().optional(),
});

export async function POST(req: NextRequest) {
  if (!aiEnabled) {
    return NextResponse.json(
      { error: "Set GEMINI_API_KEY to enable the AI coach." },
      { status: 503 },
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { uid, fresh } = parsed.data;

  try {
    // Squad: inline (always freshest from the client) or stored.
    let squad: WcSquadState | null = isWcSquadState(parsed.data.squad) ? parsed.data.squad : null;
    if (!squad) squad = await kvGet<WcSquadState>(`wc:squad:${uid}`);
    if (!squad || squad.picks.length !== 15) {
      return NextResponse.json(
        { error: "Build your 15-player squad first — the coach plans around it." },
        { status: 422 },
      );
    }

    await ensureSnapshot().catch(() => {});
    const ctx = await getWcContext();
    const cacheKey = `wc:ai:coach:${uid}:${ctx.target.id}`;
    if (!fresh) {
      const cached = await kvGet<CoachResult>(cacheKey);
      if (cached) return NextResponse.json({ ...cached, cached: true });
    }

    const memory = await kvGet<CoachMemory>(`wc:ai:coach:memory:${uid}`);
    const result = await runCoach(ctx, squad, memory);
    await kvSet(cacheKey, result, 15 * 60);
    // Remember this plan for a week so the next run keeps continuity.
    await kvSet(`wc:ai:coach:memory:${uid}`, toCoachMemory(result, ctx.target.id), 7 * 24 * 3600);
    return NextResponse.json({ ...result, cached: false });
  } catch (err) {
    console.error("[wc/ai/coach]", err);
    return NextResponse.json(
      { error: friendlyGeminiError(err) },
      { status: isTransientGeminiError(err) ? 503 : 500 },
    );
  }
}
