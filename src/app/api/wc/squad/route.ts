// Cross-device persistence for the in-app WC26 squad. Redis-backed when
// configured; clients always keep a localStorage copy so this is best-effort.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { kvDel, kvGet, kvSet, storeEnabled } from "@/lib/store/redis";
import { isWcSquadState, type WcSquadState } from "@/lib/wc/squad/types";
import { getWcContext } from "@/lib/wc/context";
import { validateWcSquad } from "@/lib/wc/rules/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = (uid: string) => `wc:squad:${uid}`;

const uidSchema = z.string().min(1).max(64);

export async function GET(req: NextRequest) {
  const uid = uidSchema.safeParse(req.nextUrl.searchParams.get("uid"));
  if (!uid.success) return NextResponse.json({ error: "uid required" }, { status: 400 });
  const squad = await kvGet<WcSquadState>(KEY(uid.data));
  return NextResponse.json({ squad, storeEnabled });
}

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { uid, squad } = (body ?? {}) as { uid?: unknown; squad?: unknown };
  const uidOk = uidSchema.safeParse(uid);
  if (!uidOk.success || !isWcSquadState(squad) || squad.uid !== uidOk.data) {
    return NextResponse.json({ error: "invalid squad payload" }, { status: 400 });
  }

  // Validate against current-round rules when the squad is complete. Partial
  // squads (mid-build) are stored as-is so work in progress isn't lost.
  let validation = null;
  if (squad.picks.length === 15) {
    const ctx = await getWcContext();
    validation = validateWcSquad(squad.picks, ctx.playerById, ctx.teamIndex.byId, ctx.targetRules);
    if (!validation.ok) {
      return NextResponse.json(
        { error: "squad fails rules validation", validation },
        { status: 422 },
      );
    }
  }

  await kvSet(KEY(uidOk.data), squad);
  return NextResponse.json({ ok: true, storeEnabled, validation });
}

export async function DELETE(req: NextRequest) {
  const uid = uidSchema.safeParse(req.nextUrl.searchParams.get("uid"));
  if (!uid.success) return NextResponse.json({ error: "uid required" }, { status: 400 });
  await kvDel(KEY(uid.data));
  return NextResponse.json({ ok: true });
}
