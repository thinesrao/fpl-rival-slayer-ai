// WC26 chat endpoint — SSE stream. History is client-held (sent with each
// request); completed turns are mirrored to Redis per uid so the thread can
// be rehydrated on a new device or after cleared storage.

import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { aiEnabled } from "@/lib/env";
import { kvGet, kvSet } from "@/lib/store/redis";
import { getWcContext } from "@/lib/wc/context";
import { ensureSnapshot } from "@/lib/wc/snapshot";
import { buildWcDigest } from "@/lib/wc/digest";
import { isWcSquadState } from "@/lib/wc/squad/types";
import { wcChatStream, type WcChatMessage } from "@/lib/wc/ai/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const THREAD_KEY = (uid: string) => `wc:chat:${uid}`;
const THREAD_TTL_S = 7 * 24 * 3600;
const THREAD_CAP = 40;

const Body = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "model"]), text: z.string().max(8000) }))
    .max(24)
    .default([]),
  squad: z.unknown().optional(),
  uid: z.string().min(1).max(64).optional(),
});

export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get("uid");
  if (!uid) return NextResponse.json({ error: "uid required" }, { status: 400 });
  const thread = (await kvGet<WcChatMessage[]>(THREAD_KEY(uid))) ?? [];
  return NextResponse.json({ thread });
}

export async function DELETE(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get("uid");
  if (uid) await kvSet(THREAD_KEY(uid), [], 60);
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  if (!aiEnabled) {
    return NextResponse.json(
      { error: "Set GEMINI_API_KEY to enable chat." },
      { status: 503 },
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { message, history } = parsed.data;
  const uid = parsed.data.uid;
  const squad = isWcSquadState(parsed.data.squad) ? parsed.data.squad : null;

  await ensureSnapshot().catch(() => {});
  const ctx = await getWcContext();
  const digest = await buildWcDigest(ctx, squad);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      let aggregated = "";
      try {
        for await (const evt of wcChatStream(history as WcChatMessage[], message, digest)) {
          if (evt.delta) {
            aggregated += evt.delta;
            send({ type: "delta", text: evt.delta });
          }
          if (evt.done) {
            send({ type: "done", citations: evt.citations, searchQueries: evt.searchQueries });
          }
        }
        // Mirror the completed turn server-side for cross-device rehydration.
        if (uid && aggregated) {
          const thread: WcChatMessage[] = [
            ...(history as WcChatMessage[]),
            { role: "user" as const, text: message },
            { role: "model" as const, text: aggregated },
          ].slice(-THREAD_CAP);
          await kvSet(THREAD_KEY(uid), thread, THREAD_TTL_S);
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
