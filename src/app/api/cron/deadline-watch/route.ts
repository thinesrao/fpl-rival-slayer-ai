// Cron: hourly. Notify each subscribed team T-4h and T-1h before the next
// gameweek deadline (each window pings at most once per GW).

import { NextResponse } from "next/server";
import { getBootstrap, targetEvent } from "@/lib/fpl/client";
import {
  deadlineSent,
  getSubscriptions,
  listSubscribedTeams,
  markDeadlineSent,
  removeSubscriptions,
} from "@/lib/store/push";
import { pushEnabled, sendPush } from "@/lib/notify/push";
import { storeEnabled } from "@/lib/store/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOWS_HOURS = [4, 1] as const;

export async function GET() {
  if (!storeEnabled || !pushEnabled) {
    return NextResponse.json({ error: "push_disabled" }, { status: 503 });
  }
  const teams = await listSubscribedTeams();
  if (teams.length === 0) return NextResponse.json({ checked: 0, sent: 0 });

  const bs = await getBootstrap();
  const target = targetEvent(bs);
  const deadlineMs = new Date(target.deadline_time).getTime();
  const hoursToDeadline = (deadlineMs - Date.now()) / (1000 * 60 * 60);
  if (hoursToDeadline <= 0 || hoursToDeadline > 4.5) {
    return NextResponse.json({ checked: 0, sent: 0, hoursToDeadline });
  }

  // Pick the closest matching window we haven't fired yet.
  const matchedWindow = WINDOWS_HOURS.find((w) => hoursToDeadline <= w + 0.5 && hoursToDeadline >= w - 0.5);
  if (!matchedWindow) return NextResponse.json({ checked: 0, sent: 0, hoursToDeadline });
  const slot = `t-${matchedWindow}h`;

  let totalSent = 0;
  for (const teamId of teams) {
    try {
      if (await deadlineSent(teamId, target.id, slot)) continue;
      const subs = await getSubscriptions(teamId);
      if (subs.length === 0) continue;
      const { sent, expired } = await sendPush(subs, {
        title: `GW${target.id} deadline in ~${matchedWindow}h`,
        body: "Lock in your transfers, captain, and bench before kick-off.",
        tag: `deadline-${target.id}-${slot}`,
        data: { url: `/dashboard/${teamId}` },
      });
      totalSent += sent;
      if (expired.length) await removeSubscriptions(teamId, expired.map((s) => s.endpoint));
      await markDeadlineSent(teamId, target.id, slot);
    } catch (err) {
      console.warn("[cron/deadline-watch] team", teamId, err);
    }
  }
  return NextResponse.json({ checked: teams.length, sent: totalSent, slot });
}
