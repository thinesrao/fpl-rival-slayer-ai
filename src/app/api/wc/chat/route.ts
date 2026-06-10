// WC26 chat endpoint — SSE stream. History is client-held (sent with each
// request) so the chat works with zero server storage.

import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { aiEnabled } from "@/lib/env";
import { getWcContext } from "@/lib/wc/context";
import { ensureSnapshot } from "@/lib/wc/snapshot";
import { buildWcDigest } from "@/lib/wc/digest";
import { isWcSquadState } from "@/lib/wc/squad/types";
import { wcChatStream, type WcChatMessage } from "@/lib/wc/ai/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "model"]), text: z.string().max(8000) }))
    .max(24)
    .default([]),
  squad: z.unknown().optional(),
});

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
  const squad = isWcSquadState(parsed.data.squad) ? parsed.data.squad : null;

  await ensureSnapshot().catch(() => {});
  const ctx = await getWcContext();
  const digest = await buildWcDigest(ctx, squad);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        for await (const evt of wcChatStream(history as WcChatMessage[], message, digest)) {
          if (evt.delta) send({ type: "delta", text: evt.delta });
          if (evt.done) {
            send({ type: "done", citations: evt.citations, searchQueries: evt.searchQueries });
          }
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
