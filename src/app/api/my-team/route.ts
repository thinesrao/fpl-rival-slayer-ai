// Seed a SquadDraft from the squad the manager has saved for the UPCOMING
// deadline — the wildcard team they picked in the FPL app but which the
// public API won't serve until the deadline passes.
//
// POST because the request body carries the manager's FPL login cookie. It is
// used for exactly one upstream call and is never stored or logged; see
// @/lib/fpl/my-team for the constraints on it.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FplError, getBootstrap, targetEvent } from "@/lib/fpl/client";
import { FplAuthError, activeChipOf, getMyTeam } from "@/lib/fpl/my-team";
import { buildDraftSeed, type SeedPick } from "@/lib/drafts/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  teamId: z.coerce.number().int().positive(),
  cookie: z.string().min(1).max(8192),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  }
  const { teamId, cookie } = parsed.data;

  try {
    const [bs, team] = await Promise.all([getBootstrap(), getMyTeam(teamId, cookie)]);

    const elementTypeById = new Map(bs.elements.map((e) => [e.id, e.element_type]));
    const webNameById = new Map(bs.elements.map((e) => [e.id, e.web_name]));
    const nowCostById = new Map(bs.elements.map((e) => [e.id, e.now_cost]));

    const picks: SeedPick[] = team.picks.map((p) => ({
      elementId: p.element,
      position: p.position,
      isCaptain: p.is_captain ?? false,
      isVice: p.is_vice_captain ?? false,
      // Selling price is what this manager would actually get back, which is
      // the right basis for the wildcard budget. now_cost is the fallback.
      value: p.selling_price ?? nowCostById.get(p.element) ?? 0,
    }));

    const seed = buildDraftSeed({
      gw: targetEvent(bs)?.id ?? 1,
      bank: team.transfers?.bank ?? 0,
      picks,
      elementTypeById,
      webNameById,
      activeChip: activeChipOf(team),
      source: "pending",
    });

    return NextResponse.json(seed, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof FplAuthError) {
      return NextResponse.json({ error: "fpl_auth", message: err.message }, { status: 401 });
    }
    if (err instanceof FplError) {
      return NextResponse.json({ error: "fpl_error", message: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "internal_error", message: msg }, { status: 500 });
  }
}
