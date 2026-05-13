// Typed wrappers around the Upstash KV for the two stores Phase A introduces:
//
//   analysis:{teamId}:{leagueId}:{gw}   →  cached AnalysisResponse  (TTL: deadline + 6h)
//   snapshot:{teamId}:{leagueId}:{gw}   →  pre-GW snapshot          (TTL: 90 days)
//
// `AnalysisResponse` is the *exact* JSON payload `/api/analysis` returns to
// the client, so we don't have to reshape on retrieval.

import { kvGet, kvSet } from "./redis";

export interface CachedAnalysis {
  cachedAt: string; // ISO timestamp when the analysis was generated
  payload: unknown; // The full /api/analysis response body
}

export interface Snapshot {
  takenAt: string;
  teamId: number;
  leagueId: number;
  gw: number;
  payload: unknown;
}

const SNAPSHOT_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

function analysisKey(teamId: number, leagueId: number, gw: number) {
  return `analysis:${teamId}:${leagueId}:${gw}`;
}

function snapshotKey(teamId: number, leagueId: number, gw: number) {
  return `snapshot:${teamId}:${leagueId}:${gw}`;
}

export async function readAnalysis(
  teamId: number,
  leagueId: number,
  gw: number,
): Promise<CachedAnalysis | null> {
  return kvGet<CachedAnalysis>(analysisKey(teamId, leagueId, gw));
}

export async function writeAnalysis(
  teamId: number,
  leagueId: number,
  gw: number,
  payload: unknown,
  deadlineIso: string,
): Promise<CachedAnalysis> {
  const value: CachedAnalysis = { cachedAt: new Date().toISOString(), payload };
  // TTL = (deadline - now) + 6h, clamped to [30 min, 14 days].
  const deadlineMs = new Date(deadlineIso).getTime();
  const sixHours = 6 * 60 * 60 * 1000;
  const ms = Math.max(30 * 60 * 1000, Math.min(14 * 24 * 60 * 60 * 1000, deadlineMs - Date.now() + sixHours));
  await kvSet(analysisKey(teamId, leagueId, gw), value, Math.floor(ms / 1000));
  return value;
}

export async function readSnapshot(
  teamId: number,
  leagueId: number,
  gw: number,
): Promise<Snapshot | null> {
  return kvGet<Snapshot>(snapshotKey(teamId, leagueId, gw));
}

export async function writeSnapshot(
  teamId: number,
  leagueId: number,
  gw: number,
  payload: unknown,
): Promise<void> {
  const value: Snapshot = {
    takenAt: new Date().toISOString(),
    teamId,
    leagueId,
    gw,
    payload,
  };
  await kvSet(snapshotKey(teamId, leagueId, gw), value, SNAPSHOT_TTL_SECONDS);
}
