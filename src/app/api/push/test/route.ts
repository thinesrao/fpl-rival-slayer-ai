import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSubscriptions, removeSubscriptions } from "@/lib/store/push";
import { pushEnabled, sendPush } from "@/lib/notify/push";
import { storeEnabled } from "@/lib/store/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ teamId: z.coerce.number().int().positive() });

export async function POST(req: NextRequest) {
  if (!storeEnabled || !pushEnabled) {
    return NextResponse.json({ error: "push_disabled" }, { status: 503 });
  }
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }
  const subs = await getSubscriptions(parsed.data.teamId);
  if (subs.length === 0) {
    return NextResponse.json({ error: "no_subscriptions", message: "No push subscriptions for this team." }, { status: 404 });
  }
  const { sent, expired } = await sendPush(subs, {
    title: "Rival Slayer · test",
    body: "Push is wired up. You'll get pinged for injury news + deadline reminders.",
    tag: "test",
    data: { url: "/" },
  });
  if (expired.length) await removeSubscriptions(parsed.data.teamId, expired.map((s) => s.endpoint));
  return NextResponse.json({ sent, expired: expired.length });
}
