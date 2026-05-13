// Thin wrapper around `web-push`: configures VAPID once, exposes a typed
// `sendPush(subscriptions, payload)` that prunes expired endpoints. Returns
// a list of subscriptions to drop so the caller can update its store.

import webpush, { type PushSubscription as WebPushSubscription } from "web-push";

const PUBLIC = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:owner@example.com";

let configured = false;
function configure() {
  if (configured) return;
  if (!PUBLIC || !PRIVATE) {
    throw new Error("Web push not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY missing).");
  }
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
  configured = true;
}

export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  subscribedAt: string;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  data?: { url?: string; [k: string]: unknown };
}

export const pushEnabled = Boolean(PUBLIC && PRIVATE);

export async function sendPush(
  subscriptions: StoredSubscription[],
  payload: PushPayload,
): Promise<{ sent: number; expired: StoredSubscription[] }> {
  configure();
  const expired: StoredSubscription[] = [];
  let sent = 0;
  await Promise.all(
    subscriptions.map(async (sub) => {
      const wpSub: WebPushSubscription = { endpoint: sub.endpoint, keys: sub.keys };
      try {
        await webpush.sendNotification(wpSub, JSON.stringify(payload));
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          expired.push(sub);
        } else {
          console.warn("[push] send failed", status, (err as Error).message);
        }
      }
    }),
  );
  return { sent, expired };
}
