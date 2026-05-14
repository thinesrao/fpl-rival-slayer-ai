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
    const targetGw = parsed.data.gw ?? prev?.id;
    if (!targetGw) {
      return NextResponse.json(
        { error: "no_finished_gw", message: "No finished gameweek to retrospect yet." },
        { status: 404 },
      );
    }

    const snapshot = await readSnapshot(parsed.data.teamId, parsed.data.leagueId, targetGw);
    if (!snapshot) {
      return NextResponse.json(
        {
          error: "no_snapshot",
          message: `No pre-GW snapshot stored for GW${targetGw}. Run the AI analysis before deadline to build one for next week.`,
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
    return NextResponse.json({ ...result, snapshotTakenAt: snapshot.takenAt });
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
