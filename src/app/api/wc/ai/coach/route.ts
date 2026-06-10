// Matchday coach endpoint: needs the user's squad (by uid or inline) and
// returns the round plan. Cached per uid+round for 15 min.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiEnabled } from "@/lib/env";
import { kvGet, kvSet } from "@/lib/store/redis";
import { getWcContext } from "@/lib/wc/context";
import { ensureSnapshot } from "@/lib/wc/snapshot";
import { isWcSquadState, type WcSquadState } from "@/lib/wc/squad/types";
import { runCoach, type CoachResult } from "@/lib/wc/ai/coach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

    const result = await runCoach(ctx, squad);
    await kvSet(cacheKey, result, 15 * 60);
    return NextResponse.json({ ...result, cached: false });
  } catch (err) {
    console.error("[wc/ai/coach]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
