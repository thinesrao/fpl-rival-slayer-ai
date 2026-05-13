// Cron: every 30 minutes. For each subscribed team, fetch their latest picks
// and look for FPL `news_added` timestamps newer than the per-team marker.
// Notify once per news event.

import { NextResponse } from "next/server";
import { getBootstrap, getPicks, previousFinishedEvent, targetEvent } from "@/lib/fpl/client";
import {
  getSubscriptions,
  listSubscribedTeams,
  readNewsMarker,
  removeSubscriptions,
  writeNewsMarker,
} from "@/lib/store/push";
import { pushEnabled, sendPush } from "@/lib/notify/push";
import { storeEnabled } from "@/lib/store/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!storeEnabled || !pushEnabled) {
    return NextResponse.json({ error: "push_disabled" }, { status: 503 });
  }
  const teams = await listSubscribedTeams();
  if (teams.length === 0) return NextResponse.json({ checked: 0, sent: 0 });

  const bs = await getBootstrap();
  const upcoming = targetEvent(bs);
  const fallback = previousFinishedEvent(bs);
  const pickGw = upcoming.id ?? fallback?.id;
  if (!pickGw) return NextResponse.json({ checked: 0, sent: 0, note: "no_gw" });

  const elementsById = new Map(bs.elements.map((e) => [e.id, e]));

  let totalSent = 0;
  for (const teamId of teams) {
    try {
      const picks = await getPicks(teamId, pickGw).catch(() => null);
      if (!picks) continue;
      const marker = (await readNewsMarker(teamId)) ?? new Date(0).toISOString();
      const newItems: Array<{ name: string; news: string; addedAt: string }> = [];
      let maxNewsAt = marker;
      for (const p of picks.picks) {
        const el = elementsById.get(p.element);
        if (!el || !el.news_added || !el.news) continue;
        if (el.news_added > marker) {
          newItems.push({ name: el.web_name, news: el.news, addedAt: el.news_added });
          if (el.news_added > maxNewsAt) maxNewsAt = el.news_added;
        }
      }
      if (newItems.length === 0) continue;

      const subs = await getSubscriptions(teamId);
      if (subs.length === 0) continue;
      const headline = newItems.length === 1 ? newItems[0].name : `${newItems.length} squad players`;
      const body = newItems.slice(0, 3).map((n) => `${n.name}: ${n.news}`).join(" · ");
      const { sent, expired } = await sendPush(subs, {
        title: `Injury update: ${headline}`,
        body: body.slice(0, 250),
        tag: `news-${teamId}`,
        data: { url: `/dashboard/${teamId}` },
      });
      totalSent += sent;
      if (expired.length) await removeSubscriptions(teamId, expired.map((s) => s.endpoint));
      await writeNewsMarker(teamId, maxNewsAt);
    } catch (err) {
      console.warn("[cron/news-watch] team", teamId, err);
    }
  }
  return NextResponse.json({ checked: teams.length, sent: totalSent });
}
