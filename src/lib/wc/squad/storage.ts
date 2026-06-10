"use client";

// Client-side persistence for the WC26 squad: localStorage is the always-on
// layer; the /api/wc/squad route mirrors to Redis when configured so the squad
// follows the user across devices. Newest `updatedAt` wins on conflict.

import { emptySquad, isWcSquadState, type WcSquadState } from "./types";

const UID_KEY = "wc26:uid";
const SQUAD_KEY = "wc26:squad";

export function getOrCreateUid(): string {
  if (typeof window === "undefined") return "";
  try {
    let uid = window.localStorage.getItem(UID_KEY);
    if (!uid) {
      uid = crypto.randomUUID();
      window.localStorage.setItem(UID_KEY, uid);
    }
    return uid;
  } catch {
    return "ephemeral";
  }
}

export function loadLocalSquad(): WcSquadState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SQUAD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isWcSquadState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLocalSquad(squad: WcSquadState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SQUAD_KEY, JSON.stringify(squad));
  } catch {
    // Quota exceeded or storage disabled — silently ignore.
  }
}

/** Load: local + remote, newest updatedAt wins; pushes the winner back to the
 *  losing side opportunistically. */
export async function loadSquad(): Promise<WcSquadState> {
  const uid = getOrCreateUid();
  const local = loadLocalSquad();
  let remote: WcSquadState | null = null;
  try {
    const res = await fetch(`/api/wc/squad?uid=${encodeURIComponent(uid)}`);
    if (res.ok) {
      const body = await res.json();
      if (isWcSquadState(body.squad)) remote = body.squad;
    }
  } catch {
    // offline / no store — local copy carries on
  }

  if (local && remote) {
    const winner =
      new Date(local.updatedAt).getTime() >= new Date(remote.updatedAt).getTime() ? local : remote;
    if (winner === local) void pushRemote(local);
    else saveLocalSquad(remote);
    return winner;
  }
  if (remote) {
    saveLocalSquad(remote);
    return remote;
  }
  if (local) {
    void pushRemote(local);
    return local;
  }
  return emptySquad(uid);
}

export async function saveSquad(squad: WcSquadState): Promise<void> {
  const next = { ...squad, updatedAt: new Date().toISOString() };
  saveLocalSquad(next);
  await pushRemote(next);
}

async function pushRemote(squad: WcSquadState): Promise<void> {
  try {
    await fetch("/api/wc/squad", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: squad.uid, squad }),
    });
  } catch {
    // best-effort mirror
  }
}
