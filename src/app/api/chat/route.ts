// Conversational AI Co-Pilot endpoint.
//
//   POST  /api/chat   { teamId, leagueId, message }  → reply + thread
//   GET   /api/chat?teamId&leagueId                  → hydrate existing thread
//   DELETE /api/chat?teamId&leagueId                 → clear the thread
//
// On POST we lazily rebuild the rival/projection context (fast cached calls)
// and pass it as a synthetic first turn so Gemini can answer hypotheticals
// using the same xP / overtake numbers the dashboard shows.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiEnabled } from "@/lib/env";
import { FplError, getEntry, getEntryHistory, getFixtures, currentEvent } from "@/lib/fpl/client";
import { buildRivalContext } from "@/lib/fpl/rivals";
import { buildProjections } from "@/lib/projections";
import { computeFreeTransfers } from "@/lib/fpl/free-transfers";
import { computeEffectiveOwnership } from "@/lib/intel/effective-ownership";
import { askChatStream } from "@/lib/ai/chat";
import { appendMessages, clearThread, readThread, type ChatMessage } from "@/lib/store/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PostBody = z.object({
  teamId: z.coerce.number().int().positive(),
  leagueId: z.coerce.number().int().positive(),
  message: z.string().min(1).max(2000),
});

const Query = z.object({
  teamId: z.coerce.number().int().positive(),
  leagueId: z.coerce.number().int().positive(),
});

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.flatten() }, { status: 400 });
  }
  const thread = await readThread(parsed.data.teamId, parsed.data.leagueId);
  return NextResponse.json({ thread });
}

export async function DELETE(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.flatten() }, { status: 400 });
  }
  await clearThread(parsed.data.teamId, parsed.data.leagueId);
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  if (!aiEnabled) {
    return NextResponse.json(
      { error: "ai_disabled", message: "Set GEMINI_API_KEY to enable chat." },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", detail: parsed.error.flatten() }, { status: 400 });
  }
  const { teamId, leagueId, message } = parsed.data;

  let context, bs, targetGw;
  try {
    const built = await buildRivalContext(leagueId, teamId, 3);
    context = built.context;
    bs = built.bs;
    targetGw = built.targetGw;
  } catch (err) {
    if (err instanceof FplError) {
      return NextResponse.json(
        { error: "fpl_error", status: err.status, message: err.message },
        { status: err.status === 404 ? 404 : 502 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "internal_error", message: msg }, { status: 500 });
  }

  const target = bs.events.find((e) => e.id === targetGw) ?? currentEvent(bs);
  const [projections, fixtures, entry, entryHistory] = await Promise.all([
    buildProjections(context, bs, targetGw),
    getFixtures(targetGw),
    getEntry(teamId).catch(() => null),
    getEntryHistory(teamId).catch(() => null),
  ]);
  const bank = entry?.last_deadline_bank ?? 0;
  const freeTransfers = entryHistory ? computeFreeTransfers(entryHistory).freeTransfers : 1;
  const eo = computeEffectiveOwnership(context, bs);
  const thread = await readThread(teamId, leagueId);

  const encoder = new TextEncoder();
  const enqueue = (controller: ReadableStreamDefaultController, event: object) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  };

  const stream = new ReadableStream({
    async start(controller) {
      let aggregated = "";
      let citations: Array<{ uri: string; title: string }> = [];
      let searchQueries: string[] = [];
      let model = "";
      try {
        for await (const evt of askChatStream(thread.messages, message, {
          gw: targetGw,
          deadline: target.deadline_time,
          ctx: context,
          userProjection: projections.user,
          rivalProjections: projections.rivals,
          overtake: projections.overtake,
          fixtures,
          bs,
          bank,
          freeTransfers,
          eo,
        })) {
          if (evt.delta) {
            aggregated += evt.delta;
            enqueue(controller, { type: "delta", text: evt.delta });
          }
          if (evt.done) {
            citations = evt.citations ?? [];
            searchQueries = evt.searchQueries ?? [];
            model = evt.model ?? "";
          }
        }

        const now = new Date().toISOString();
        const userMsg: ChatMessage = { role: "user", text: message, ts: now };
        const modelMsg: ChatMessage = {
          role: "model",
          text: aggregated,
          ts: new Date().toISOString(),
          citations: citations.length ? citations : undefined,
        };
        const updated = await appendMessages(teamId, leagueId, [userMsg, modelMsg]);

        enqueue(controller, {
          type: "done",
          reply: modelMsg,
          thread: updated,
          citations,
          searchQueries,
          model,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        enqueue(controller, { type: "error", message: msg });
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
