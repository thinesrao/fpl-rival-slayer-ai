// Downloads and caches per-gameweek player rows from the vaastav archive.
//
// Cached under .backtest/ (gitignored) — upstream is ~178MB and must never be
// committed. A 404 means "not published yet" and returns null; anything else
// throws, because silently skipping a gameweek would quietly shrink the
// evaluation set.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseCsv } from "@/lib/backtest/csv";

export type Season = "2023-24" | "2024-25" | "2025-26";

/** The only season sharing 2026-27's scoring rules (defensive contribution). */
export const RULE_CURRENT_SEASON: Season = "2025-26";

/** Seasons usable only for rule-independent sub-models. */
export const RULE_LEGACY_SEASONS: readonly Season[] = ["2023-24", "2024-25"];

const BASE = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data";
const DEFAULT_CACHE_DIR = ".backtest";

export function gameweekUrl(season: Season, round: number): string {
  return `${BASE}/${season}/gws/gw${round}.csv`;
}

export interface LoadOptions {
  cacheDir?: string;
  fetchImpl?: typeof fetch;
}

export async function loadGameweek(
  season: Season,
  round: number,
  opts: LoadOptions = {},
): Promise<Array<Record<string, string>> | null> {
  const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
  const doFetch = opts.fetchImpl ?? fetch;
  const path = join(cacheDir, season, `gw${round}.csv`);

  if (existsSync(path)) return parseCsv(readFileSync(path, "utf8"));

  const res = await doFetch(gameweekUrl(season, round));
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`corpus fetch failed: ${season} gw${round} -> HTTP ${res.status}`);
  }

  const text = await res.text();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return parseCsv(text);
}

export interface ManifestEntry {
  season: Season;
  round: number;
  rows: number;
  sha256: string;
  /** Whether FPL's own xP column carries any non-zero value in this file. */
  hasXp: boolean;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function buildManifest(entries: ManifestEntry[]): string {
  const sorted = [...entries].sort(
    (a, b) => a.season.localeCompare(b.season) || a.round - b.round,
  );
  return JSON.stringify({ version: 1, entries: sorted }, null, 2);
}
