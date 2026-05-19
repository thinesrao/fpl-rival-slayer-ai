"use client";

// localStorage wrappers scoped by teamId. Drafts are user-private and
// device-local — no server-side persistence needed.

import type { SquadDraft } from "./types";

const KEY = (teamId: number) => `fpl-rival-slayer:drafts:${teamId}`;

export function loadDrafts(teamId: number): SquadDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY(teamId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d) => d && typeof d === "object" && "id" in d);
  } catch {
    return [];
  }
}

export function saveDrafts(teamId: number, drafts: SquadDraft[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY(teamId), JSON.stringify(drafts));
  } catch {
    // Quota exceeded or storage disabled — silently ignore.
  }
}

export function upsertDraft(teamId: number, draft: SquadDraft) {
  const all = loadDrafts(teamId);
  const idx = all.findIndex((d) => d.id === draft.id);
  const next = { ...draft, updatedAt: new Date().toISOString() };
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  saveDrafts(teamId, all);
  return all;
}

export function deleteDraft(teamId: number, id: string) {
  const all = loadDrafts(teamId).filter((d) => d.id !== id);
  saveDrafts(teamId, all);
  return all;
}
