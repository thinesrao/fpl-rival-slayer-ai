// Seed a new SquadDraft from the user's current FPL squad. Used by the
// Drafts tab so "New draft" pre-populates with the user's GW N picks,
// captain, vice, bank balance, and squad value. The user then makes
// transfers and saves it as their plan for GW N+1.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  FplError,
  getBootstrap,
  getEntry,
  getEntryHistory,
  currentEvent,
} from "@/lib/fpl/client";
import { buildMySquadLive } from "@/lib/fpl/my-squad-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  teamId: z.coerce.number().int().positive(),
});

const POSITIONS = ["?", "GKP", "DEF", "MID", "FWD"] as const;

interface SeedPlayer {
  id: number;
  webName: string;
  position: "GKP" | "DEF" | "MID" | "FWD";
  isStarter: boolean;
}

export async function GET(req: NextRequest) {
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  }
  const { teamId } = parsed.data;

  try {
    const bs = await getBootstrap();
    const current = currentEvent(bs);
    const targetGw = current?.id ?? 1;
    const [squad, entry, history] = await Promise.all([
      buildMySquadLive(teamId, targetGw),
      getEntry(teamId),
      getEntryHistory(teamId),
    ]);

    const all = [...squad.starters, ...squad.bench];

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
    const nowCostById = new Map(bs.elements.map((e) => [e.id, e.now_cost]));
    const squadValue = all.reduce((s, p) => s + (nowCostById.get(p.playerId) ?? 0), 0);

    let bank: number;
    if (entry.last_deadline_bank != null) {
      bank = entry.last_deadline_bank;
    } else {
      const finished = history.current.filter((c) => c.event <= targetGw);
      const lastRow = finished[finished.length - 1] ?? null;
      bank = lastRow?.bank ?? 0;
    }
    const cap = bank + squadValue;

    // Order picks slot-by-slot to match SquadDraft.picks contract:
    // GK1, GK2, DEF1..5, MID1..5, FWD1..3.
    const groups: Record<1 | 2 | 3 | 4, typeof all> = { 1: [], 2: [], 3: [], 4: [] };
    for (const p of all) groups[p.elementType].push(p);

    const ordered: typeof all = [
      ...groups[1].slice(0, 2),
      ...groups[2].slice(0, 5),
      ...groups[3].slice(0, 5),
      ...groups[4].slice(0, 3),
    ];

    const picks: (number | null)[] = ordered.map((p) => p.playerId);
    // Pad to 15 in case the user is mid-season with incomplete data.
    while (picks.length < 15) picks.push(null);

    const captain = all.find((p) => p.isCaptain);
    const vice = all.find((p) => p.isVice);

    const startingXI = all.filter((p) => p.isStarter).map((p) => p.playerId);

    // Pick the active formation from the actual starting XI counts.
    const counts = { DEF: 0, MID: 0, FWD: 0 };
    for (const p of all) {
      if (!p.isStarter) continue;
      if (p.elementType === 2) counts.DEF++;
      if (p.elementType === 3) counts.MID++;
      if (p.elementType === 4) counts.FWD++;
    }
    const formation = `${counts.DEF}-${counts.MID}-${counts.FWD}`;

    const summary: SeedPlayer[] = ordered.map((p) => ({
      id: p.playerId,
      webName: p.webName,
      position: POSITIONS[p.elementType] as SeedPlayer["position"],
      isStarter: p.isStarter,
    }));

    return NextResponse.json({
      gw: targetGw,
      bank,
      squadValue,
      budget: cap,
      picks,
      captainId: captain?.playerId ?? null,
      viceId: vice?.playerId ?? null,
      startingXI,
      formation,
      summary,
    });
  } catch (err) {
    if (err instanceof FplError) {
      return NextResponse.json({ error: "fpl_error", message: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "internal_error", message: msg }, { status: 500 });
  }
}
