// Seed a new SquadDraft from the user's current FPL squad. Used by the
// Drafts tab so "New draft" pre-populates with the user's latest picks,
// captain, vice, bench order, bank balance, and squad value. The user then
// makes transfers and saves it as their plan for the next gameweek.
//
// "Latest" means the most recent gameweek the public API will actually serve:
// `/entry/{id}/event/{gw}/picks/` 404s until that gameweek's deadline has
// passed. So the moment a deadline goes by, this picks up the squad that just
// locked in — a wildcard team included — instead of staying a gameweek behind.
// Before the deadline, /api/my-team is the only route to a pending squad.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FplError, getBootstrap, getEntry, getEntryHistory } from "@/lib/fpl/client";
import { loadLatestPicks } from "@/lib/fpl/latest-picks";
import { buildDraftSeed, type SeedPick } from "@/lib/drafts/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  teamId: z.coerce.number().int().positive(),
});

export async function GET(req: NextRequest) {
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  }
  const { teamId } = parsed.data;

  try {
    const bs = await getBootstrap();
    const [{ gw, picks }, entry, history] = await Promise.all([
      loadLatestPicks(teamId, bs),
      // Both are conveniences with a fallback below, and both 503 while FPL
      // settles after a deadline. Neither is worth failing the request over.
      getEntry(teamId).catch(() => null),
      getEntryHistory(teamId).catch(() => null),
    ]);

    const elementTypeById = new Map(bs.elements.map((e) => [e.id, e.element_type]));
    const webNameById = new Map(bs.elements.map((e) => [e.id, e.web_name]));
    const nowCostById = new Map(bs.elements.map((e) => [e.id, e.now_cost]));

    // Squad value = sum of current now_cost across the 15 picks. This
    // matches the FPL app's "Squad Value" display (modulo selling-price
    // half-rise rounding, which is at most a few tenths). Bank comes
    // straight from entry.last_deadline_bank since that's exactly what
    // the FPL app reads. Cap = bank + squad_value (the real spendable
    // budget if you sold everyone at now_cost).
    //
    // We deliberately DON'T use entry.last_deadline_value as the cap
    // because that field stores sum(purchase prices) + bank — locked at
    // last deadline. If a player's now_cost dropped since purchase, the
    // cap would over-report by the drop amount and the implied bank
    // (cap − current squad value) would be too high. Issue surfaced
    // for team 942359: API value=£100.1m, true cap=£99.9m, drift
    // matched two £0.1m price drops since purchase.
    const seedPicks: SeedPick[] = picks.picks.map((p) => ({
      elementId: p.element,
      position: p.position,
      isCaptain: p.is_captain,
      isVice: p.is_vice_captain,
      value: nowCostById.get(p.element) ?? 0,
    }));

    // Preference order: the entry's own figure, then the bank recorded
    // against the picks we loaded (the same number, at that gameweek's
    // deadline), then the history row. Each is a real reading, not a guess.
    let bank: number;
    if (entry?.last_deadline_bank != null) {
      bank = entry.last_deadline_bank;
    } else if (picks.entry_history?.bank != null) {
      bank = picks.entry_history.bank;
    } else {
      const finished = history?.current.filter((c) => c.event <= gw) ?? [];
      bank = finished[finished.length - 1]?.bank ?? 0;
    }

    const seed = buildDraftSeed({
      gw,
      bank,
      picks: seedPicks,
      elementTypeById,
      webNameById,
      activeChip: picks.active_chip,
      source: "confirmed",
    });

    return NextResponse.json(seed);
  } catch (err) {
    if (err instanceof FplError) {
      return NextResponse.json({ error: "fpl_error", message: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "internal_error", message: msg }, { status: 500 });
  }
}
