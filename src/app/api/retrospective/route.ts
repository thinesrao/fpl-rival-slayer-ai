import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FplError, getBootstrap, getLive, getPicks, previousFinishedEvent } from "@/lib/fpl/client";
import { readSnapshot } from "@/lib/store/cache";
import { buildRetrospective } from "@/lib/retrospective/build";
import { storeEnabled } from "@/lib/store/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  teamId: z.coerce.number().int().positive(),
  leagueId: z.coerce.number().int().positive(),
  gw: z.coerce.number().int().positive().optional(),
});

export async function GET(req: NextRequest) {
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.flatten() }, { status: 400 });
  }

  if (!storeEnabled) {
    return NextResponse.json(
      { error: "store_disabled", message: "Retrospective requires UPSTASH_REDIS_REST_* env vars." },
      { status: 503 },
    );
  }

  try {
    const bs = await getBootstrap();
    const prev = previousFinishedEvent(bs);
    const requestedGw = parsed.data.gw ?? prev?.id;
    if (!requestedGw) {
      return NextResponse.json(
        { error: "no_finished_gw", message: "No finished gameweek to retrospect yet." },
        { status: 404 },
      );
    }

    // Walk back through all finished GWs (newest first) and collect any that
    // have a snapshot. Lets us (a) pick a sensible default when the
    // most-recent finished GW has no snapshot, and (b) tell the client which
    // GWs they CAN look at.
    const finishedDesc = [...bs.events].filter((e) => e.finished).reverse();
    const snapResults = await Promise.all(
      finishedDesc.map(async (e) => ({
        gw: e.id,
        snap: await readSnapshot(parsed.data.teamId, parsed.data.leagueId, e.id),
      })),
    );
    const availableGws = snapResults.filter((r) => r.snap).map((r) => r.gw);

    if (availableGws.length === 0) {
      return NextResponse.json(
        {
          error: "no_snapshot",
          message: `No pre-GW snapshots stored for this team yet. Run the AI analysis before a deadline to start building them.`,
          availableGws,
        },
        { status: 404 },
      );
    }

    // Prefer the requested GW; otherwise fall back to the most-recent
    // finished GW that has a snapshot.
    const requestedHit = snapResults.find((r) => r.gw === requestedGw);
    const fallback = snapResults.find((r) => r.snap);
    const snapshot = requestedHit?.snap ?? fallback?.snap;
    const targetGw = requestedHit?.snap ? requestedGw : (fallback?.gw as number);

    if (!snapshot) {
      return NextResponse.json(
        {
          error: "no_snapshot",
          message: `No pre-GW snapshot stored for GW${requestedGw}. Available: ${availableGws.join(", ")}.`,
          availableGws,
          requestedGw,
        },
        { status: 404 },
      );
    }

    const payload = snapshot.payload as Parameters<typeof buildRetrospective>[0];

    const [userPicks, live] = await Promise.all([
      getPicks(parsed.data.teamId, targetGw),
      getLive(targetGw),
    ]);

    const rivalPicks = await Promise.all(
      payload.context.rivals.map(async (r) => {
        try {
          const picks = await getPicks(r.entry.id, targetGw);
          return { entryId: r.entry.id, picks };
        } catch {
          return null;
        }
      }),
    );
    const cleanRivalPicks = rivalPicks.filter((r): r is { entryId: number; picks: typeof userPicks } => r !== null);

    const result = buildRetrospective(payload, userPicks, cleanRivalPicks, live, bs);
    return NextResponse.json({
      ...result,
      snapshotTakenAt: snapshot.takenAt,
      availableGws,
      requestedGw: requestedHit?.snap ? undefined : requestedGw,
    });
  } catch (err) {
    if (err instanceof FplError) {
      return NextResponse.json({ error: "fpl_error", status: err.status, message: err.message }, {
        status: err.status === 404 ? 404 : 502,
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}
