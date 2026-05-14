// Per-(team, league) chat thread persistence on Upstash Redis. Mirrors the
// pattern in `cache.ts`: graceful no-op when the store is disabled, so the
// chat still works in-process for a single request.
//
//   chat:{teamId}:{leagueId}   →  { messages: ChatMessage[], updatedAt }
//
// We cap the persisted thread at MAX_HISTORY (head-trim) to control the
// payload size sent to Gemini on every turn. Full thread TTL is 30 days.

import { kvDel, kvGet, kvSet } from "./redis";

export type ChatRole = "user" | "model";

export interface ChatMessage {
  role: ChatRole;
  text: string;
  ts: string;
  citations?: Array<{ uri: string; title: string }>;
}

export interface ChatThread {
  messages: ChatMessage[];
  updatedAt: string;
}

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_HISTORY = 40; // 20 user + 20 model turns

function key(teamId: number, leagueId: number) {
  return `chat:${teamId}:${leagueId}`;
}

export async function readThread(teamId: number, leagueId: number): Promise<ChatThread> {
  const t = await kvGet<ChatThread>(key(teamId, leagueId));
  return t ?? { messages: [], updatedAt: new Date(0).toISOString() };
}

export async function appendMessages(
  teamId: number,
  leagueId: number,
  msgs: ChatMessage[],
): Promise<ChatThread> {
  const existing = await readThread(teamId, leagueId);
  const combined = [...existing.messages, ...msgs];
  // Head-trim so the oldest turns drop off when we exceed MAX_HISTORY.
  const trimmed = combined.length > MAX_HISTORY ? combined.slice(combined.length - MAX_HISTORY) : combined;
  const next: ChatThread = { messages: trimmed, updatedAt: new Date().toISOString() };
  await kvSet(key(teamId, leagueId), next, TTL_SECONDS);
  return next;
}

export async function clearThread(teamId: number, leagueId: number): Promise<void> {
  await kvDel(key(teamId, leagueId));
}
