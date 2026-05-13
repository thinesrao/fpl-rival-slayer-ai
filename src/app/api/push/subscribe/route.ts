import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addSubscription } from "@/lib/store/push";
import { storeEnabled } from "@/lib/store/redis";
import { pushEnabled } from "@/lib/notify/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  teamId: z.coerce.number().int().positive(),
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
});

export async function POST(req: NextRequest) {
  if (!storeEnabled || !pushEnabled) {
    return NextResponse.json(
      { error: "push_disabled", message: "Push notifications require UPSTASH_REDIS_REST_* and VAPID_* env vars." },
      { status: 503 },
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", detail: parsed.error.flatten() }, { status: 400 });
  }
  await addSubscription(parsed.data.teamId, {
    endpoint: parsed.data.subscription.endpoint,
    keys: parsed.data.subscription.keys,
    subscribedAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}
