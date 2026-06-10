// The user's WC26 fantasy squad as managed inside this app. FIFA exposes no
// API for private teams, so this is the source of truth the user mirrors onto
// play.fifa.com. Persisted to localStorage always, Upstash Redis when present.

import type { BoosterId } from "@/lib/wc/rules/config";

export interface WcTransferRecord {
  out: number;
  in: number;
  at: string; // ISO
}

export interface WcSquadState {
  /** Client-generated uuid identifying this manager across devices. */
  uid: string;
  /** All 15 player ids. */
  picks: number[];
  /** 11 of `picks`. */
  startingXI: number[];
  /** 4 of `picks` in auto-sub priority order (bench GK conventionally last). */
  bench: number[];
  captainId: number | null;
  viceId: number | null;
  /** booster -> round id it was used in. */
  boostersUsed: Partial<Record<BoosterId, number>>;
  /** Booster armed for the upcoming round, if any. */
  activeBooster: { id: BoosterId; round: number } | null;
  transfersByRound: Record<number, WcTransferRecord[]>;
  createdAt: string;
  updatedAt: string;
}

export function emptySquad(uid: string): WcSquadState {
  const now = new Date().toISOString();
  return {
    uid,
    picks: [],
    startingXI: [],
    bench: [],
    captainId: null,
    viceId: null,
    boostersUsed: {},
    activeBooster: null,
    transfersByRound: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function isWcSquadState(value: unknown): value is WcSquadState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.uid === "string" &&
    Array.isArray(v.picks) &&
    Array.isArray(v.startingXI) &&
    Array.isArray(v.bench) &&
    typeof v.updatedAt === "string"
  );
}
