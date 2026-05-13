// Per-team push-subscription store. We keep an index of every subscribed team
// so the cron handlers can iterate without having to know team IDs in advance.

import { kvGet, kvSet } from "./redis";
import type { StoredSubscription } from "@/lib/notify/push";

const SUBS_KEY = (teamId: number) => `push:sub:${teamId}`;
const INDEX_KEY = "push:teams";
const NEWS_MARKER_KEY = (teamId: number) => `push:lastnews:${teamId}`;
const DEADLINE_MARKER_KEY = (teamId: number, gw: number, slot: string) =>
  `push:deadline:${teamId}:${gw}:${slot}`;

export async function getSubscriptions(teamId: number): Promise<StoredSubscription[]> {
  const list = (await kvGet<StoredSubscription[]>(SUBS_KEY(teamId))) ?? [];
  return list;
}

export async function addSubscription(teamId: number, sub: StoredSubscription): Promise<void> {
  const list = await getSubscriptions(teamId);
  // Dedupe by endpoint.
  if (!list.some((s) => s.endpoint === sub.endpoint)) list.push(sub);
  await kvSet(SUBS_KEY(teamId), list);
  const index = (await kvGet<number[]>(INDEX_KEY)) ?? [];
  if (!index.includes(teamId)) {
    index.push(teamId);
    await kvSet(INDEX_KEY, index);
  }
}

export async function removeSubscriptions(
  teamId: number,
  endpoints: string[],
): Promise<void> {
  const list = await getSubscriptions(teamId);
  const kept = list.filter((s) => !endpoints.includes(s.endpoint));
  await kvSet(SUBS_KEY(teamId), kept);
}

export async function listSubscribedTeams(): Promise<number[]> {
  return (await kvGet<number[]>(INDEX_KEY)) ?? [];
}

export async function readNewsMarker(teamId: number): Promise<string | null> {
  return (await kvGet<string>(NEWS_MARKER_KEY(teamId))) ?? null;
}

export async function writeNewsMarker(teamId: number, isoTimestamp: string): Promise<void> {
  await kvSet(NEWS_MARKER_KEY(teamId), isoTimestamp, 60 * 60 * 24 * 14);
}

export async function deadlineSent(teamId: number, gw: number, slot: string): Promise<boolean> {
  const v = await kvGet<boolean>(DEADLINE_MARKER_KEY(teamId, gw, slot));
  return Boolean(v);
}

export async function markDeadlineSent(teamId: number, gw: number, slot: string): Promise<void> {
  await kvSet(DEADLINE_MARKER_KEY(teamId, gw, slot), true, 60 * 60 * 24 * 7);
}
