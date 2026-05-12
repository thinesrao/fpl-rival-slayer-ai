import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FplError } from "@/lib/fpl/client";
import { buildRivalContext, computeDifferentials } from "@/lib/fpl/rivals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  teamId: z.coerce.number().int().positive(),
  leagueId: z.coerce.number().int().positive(),
  n: z.coerce.number().int().min(1).max(5).default(3),
});

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { context, targetGw } = await buildRivalContext(
      parsed.data.leagueId,
      parsed.data.teamId,
      parsed.data.n,
    );
    const differentials = computeDifferentials(context);
    return NextResponse.json({ context, targetGw, differentials });
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
