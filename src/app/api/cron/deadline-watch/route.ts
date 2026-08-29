// Cron: once daily on Hobby. Notifies each subscribed team if the next GW
// deadline is within ~30h of now (so today's noon UTC fire reliably catches
// any deadline that falls between now and tomorrow's fire). Pings at most
// once per GW.
//
// Also drives the gameweek snapshot capture (see @/lib/backtest/capture):
// Hobby permits only two cron jobs, so rather than a dedicated schedule for
// the snapshot route, this daily cron carries it piggyback. The capture only
// needs the store, not push, so it runs before the push-availability guard
// below and its failures are swallowed — they must never break deadline
// notifications.

import { NextResponse } from "next/server";
import { captureGameweekSnapshots } from "@/lib/backtest/capture";
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

// Slightly wider than 24h so we catch deadlines on the day-of even if the
// cron fires a bit late or the deadline drifts.
const WINDOW_HOURS = 30;
const SLOT = "daily";

function formatRelative(hoursToDeadline: number): string {
  if (hoursToDeadline < 1.5) return "in ~1h";
  if (hoursToDeadline < 24) return `in ~${Math.round(hoursToDeadline)}h`;
  return "tomorrow";
}

export async function GET() {
  let snapshot: { ok: boolean; written: string[] } = { ok: false, written: [] };
  try {
    snapshot = await captureGameweekSnapshots();
  } catch (err) {
    console.warn("[cron/deadline-watch] snapshot capture failed", err);
  }

  if (!storeEnabled || !pushEnabled) {
    return NextResponse.json({ error: "push_disabled", snapshot }, { status: 503 });
  }
  const teams = await listSubscribedTeams();
  if (teams.length === 0) return NextResponse.json({ checked: 0, sent: 0, snapshot });

  const bs = await getBootstrap();
  const target = targetEvent(bs);
  const deadlineMs = new Date(target.deadline_time).getTime();
  const hoursToDeadline = (deadlineMs - Date.now()) / (1000 * 60 * 60);
  if (hoursToDeadline <= 0 || hoursToDeadline > WINDOW_HOURS) {
    return NextResponse.json({ checked: 0, sent: 0, hoursToDeadline, snapshot });
  }

  const relative = formatRelative(hoursToDeadline);
  let totalSent = 0;
  for (const teamId of teams) {
    try {
      if (await deadlineSent(teamId, target.id, SLOT)) continue;
      const subs = await getSubscriptions(teamId);
      if (subs.length === 0) continue;
      const { sent, expired } = await sendPush(subs, {
        title: `GW${target.id} deadline ${relative}`,
        body: "Lock in your transfers, captain, and bench before kick-off.",
        tag: `deadline-${target.id}`,
        data: { url: `/dashboard/${teamId}` },
      });
      totalSent += sent;
      if (expired.length) await removeSubscriptions(teamId, expired.map((s) => s.endpoint));
      await markDeadlineSent(teamId, target.id, SLOT);
    } catch (err) {
      console.warn("[cron/deadline-watch] team", teamId, err);
    }
  }
  return NextResponse.json({ checked: teams.length, sent: totalSent, hoursToDeadline, snapshot });
}
