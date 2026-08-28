# Trust Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every expected-points number the app publishes measurable against real outcomes, fix the six known model defects, and gate our numbers behind beating FPL's own expected points.

**Architecture:** Extract a single pure `scorePlayer(features)` function that both the live app and the backtest harness call, so the backtest validates the code that actually ships. Feed it from two adapters: one building features from the live FPL API, one building them from historical gameweek rows using only rounds earlier than the one being predicted. A CLI runner scores a held-out set of gameweeks and compares against three baselines.

**Tech Stack:** TypeScript, Node 24, vitest (new), Next.js 15 App Router (existing), no ML runtime.

**Spec:** `docs/superpowers/specs/2026-08-27-trust-foundation-design.md`

## Global Constraints

- **Node version:** 24.x (matches the Vercel project setting).
- **Path alias:** `@/*` maps to `./src/*`. Vitest must resolve it identically to `tsconfig.json`.
- **No new runtime dependencies.** vitest is a `devDependency`. The scoring path must run inside a Next.js route handler with no ML runtime.
- **`PlayerProjection` is a public interface.** It is consumed by `src/app/api/analysis/route.ts`, `src/lib/optimizer/candidates.ts`, `src/lib/optimizer/transfers.ts`, `src/lib/optimizer/whatif.ts`, `src/lib/projections/horizon.ts`, and `src/lib/projections/resolve-suggested.ts`. Its field names and types must not change in this plan. Adding optional fields is allowed; renaming or removing is not.
- **Corpus seasons:** only `2025-26` may fit or validate the points mapping. `2023-24` and `2024-25` use pre-defensive-contribution scoring rules and may only be used for rule-independent sub-models. No season before `2022-23`.
- **Benchmark holdout gameweeks (2025-26):** `4, 5, 6, 8, 9, 24, 29, 38`. Fit set is the disjoint remainder of 2025-26. Gameweeks 1–3 are excluded from evaluation entirely (fewer than three prior rounds of history).
- **The bar to beat**, FPL's own `xP` on starters (`starts == 1`) in the holdout: **RMSE < 2.691** and **Spearman > 0.507**.
- **Position encoding:** the archive uses `GK`/`DEF`/`MID`/`FWD`. The app's `Position` type uses `GKP`/`DEF`/`MID`/`FWD`. Always normalise `GK` → `GKP` at the parse boundary.
- **Defensive contribution thresholds:** DEF awards 2 points at `defensive_contribution >= 10`; MID and FWD award 2 points at `>= 12`. GK never awards it.
- **Corpus cache:** `.backtest/` — already in `.gitignore`. Never commit corpus CSVs.
- **No `console.log`** in `src/` (repo convention, enforced by a Stop hook).

---

### Task 1: Vitest setup and the CSV parser

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/backtest/csv.ts`
- Create: `src/lib/backtest/csv.test.ts`
- Modify: `package.json` (scripts + devDependency)

**Interfaces:**
- Consumes: nothing.
- Produces: `parseCsv(text: string): Array<Record<string, string>>` — throws `CsvError` on a row whose field count differs from the header.

This repo has no test runner at all. This task adds one and proves it works on the smallest real unit.

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest@^3
```

- [ ] **Step 2: Create `vitest.config.ts`**

The `@/*` alias must resolve exactly as `tsconfig.json` does, or every later test fails on imports.

```typescript
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/lib/backtest/**", "src/lib/projections/**"],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
```

- [ ] **Step 3: Add scripts to `package.json`**

Add to the `scripts` object:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 4: Write the failing test**

Create `src/lib/backtest/csv.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { CsvError, parseCsv } from "@/lib/backtest/csv";

describe("parseCsv", () => {
  it("parses a simple table into keyed records", () => {
    const rows = parseCsv("name,round,total_points\nSalah,3,12\nHaaland,3,8\n");
    expect(rows).toEqual([
      { name: "Salah", round: "3", total_points: "12" },
      { name: "Haaland", round: "3", total_points: "8" },
    ]);
  });

  it("handles quoted fields containing commas", () => {
    const rows = parseCsv('name,note\n"Silva, Bernardo",ok\n');
    expect(rows[0].name).toBe("Silva, Bernardo");
    expect(rows[0].note).toBe("ok");
  });

  it("handles escaped quotes inside quoted fields", () => {
    const rows = parseCsv('name,note\n"He said ""hi""",ok\n');
    expect(rows[0].name).toBe('He said "hi"');
  });

  it("tolerates CRLF line endings", () => {
    const rows = parseCsv("a,b\r\n1,2\r\n");
    expect(rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("ignores a trailing blank line", () => {
    const rows = parseCsv("a,b\n1,2\n\n");
    expect(rows).toHaveLength(1);
  });

  it("throws when a row has fewer fields than the header", () => {
    expect(() => parseCsv("a,b,c\n1,2\n")).toThrow(CsvError);
  });

  it("throws when a row has more fields than the header", () => {
    expect(() => parseCsv("a,b\n1,2,3\n")).toThrow(CsvError);
  });

  it("reports the offending line number in the error", () => {
    expect(() => parseCsv("a,b\n1,2\n3\n")).toThrow(/line 3/);
  });

  it("returns an empty array for a header-only file", () => {
    expect(parseCsv("a,b\n")).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run src/lib/backtest/csv.test.ts`
Expected: FAIL — cannot resolve `@/lib/backtest/csv`.

- [ ] **Step 6: Implement the parser**

Create `src/lib/backtest/csv.ts`:

```typescript
// Minimal RFC4180 CSV reader for the historical gameweek corpus.
//
// Field-count validation is a guard, not a fix for an observed bug: the
// upstream archive currently emits no quoted fields and no ragged rows, but
// its format is not contractual. A misaligned record would produce plausible
// wrong numbers rather than an error, which is exactly the failure mode this
// whole sub-project exists to prevent.

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

function splitRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Parse CSV text into records keyed by the header row.
 *
 * @throws {CsvError} when a row's field count differs from the header's.
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows = splitRows(text).filter((r) => !(r.length === 1 && r[0] === ""));
  if (rows.length === 0) return [];

  const header = rows[0];
  return rows.slice(1).map((row, index) => {
    if (row.length !== header.length) {
      throw new CsvError(
        `CSV row on line ${index + 2} has ${row.length} fields, header has ${header.length}`,
      );
    }
    return Object.fromEntries(header.map((col, i) => [col, row[i]]));
  });
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/backtest/csv.test.ts`
Expected: 9 passing.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/lib/backtest/csv.ts src/lib/backtest/csv.test.ts
git commit -m "test: add vitest and a validating CSV reader

First tests in this repository. The reader validates field counts against
the header because a misaligned record would produce plausible wrong numbers
rather than an error."
```

---

### Task 2: Corpus download, cache and manifest

**Files:**
- Create: `src/lib/backtest/corpus.ts`
- Create: `src/lib/backtest/corpus.test.ts`

**Interfaces:**
- Consumes: `parseCsv` from Task 1.
- Produces:
  - `type Season = "2023-24" | "2024-25" | "2025-26"`
  - `RULE_CURRENT_SEASON: Season` (`"2025-26"`)
  - `gameweekUrl(season: Season, round: number): string`
  - `loadGameweek(season: Season, round: number, opts?: { cacheDir?: string; fetchImpl?: typeof fetch }): Promise<Array<Record<string,string>> | null>` — `null` when upstream returns 404
  - `interface ManifestEntry { season: Season; round: number; rows: number; sha256: string; hasXp: boolean }`
  - `buildManifest(entries: ManifestEntry[]): string` (stable JSON)

- [ ] **Step 1: Write the failing test**

Create `src/lib/backtest/corpus.test.ts`. `fetchImpl` is injected so tests never touch the network.

```typescript
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildManifest, gameweekUrl, loadGameweek } from "@/lib/backtest/corpus";

const CSV = "name,position,round,total_points\nSalah,MID,3,12\n";

function tmp() {
  return mkdtempSync(join(tmpdir(), "corpus-"));
}

describe("gameweekUrl", () => {
  it("points at the vaastav archive path for the season and round", () => {
    expect(gameweekUrl("2025-26", 10)).toBe(
      "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/2025-26/gws/gw10.csv",
    );
  });
});

describe("loadGameweek", () => {
  it("fetches and returns parsed rows", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => CSV });
    const rows = await loadGameweek("2025-26", 3, { cacheDir: tmp(), fetchImpl: fetchImpl as never });
    expect(rows).toHaveLength(1);
    expect(rows?.[0].name).toBe("Salah");
  });

  it("writes the response to the cache directory", async () => {
    const dir = tmp();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => CSV });
    await loadGameweek("2025-26", 3, { cacheDir: dir, fetchImpl: fetchImpl as never });
    expect(readFileSync(join(dir, "2025-26", "gw3.csv"), "utf8")).toBe(CSV);
  });

  it("serves from cache without fetching again", async () => {
    const dir = tmp();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => CSV });
    await loadGameweek("2025-26", 3, { cacheDir: dir, fetchImpl: fetchImpl as never });
    await loadGameweek("2025-26", 3, { cacheDir: dir, fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns null on 404 rather than throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "" });
    const rows = await loadGameweek("2025-26", 99, { cacheDir: tmp(), fetchImpl: fetchImpl as never });
    expect(rows).toBeNull();
  });

  it("throws loudly on a non-404 upstream failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "" });
    await expect(
      loadGameweek("2025-26", 3, { cacheDir: tmp(), fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/500/);
  });

  it("does not cache a failed response", async () => {
    const dir = tmp();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "" })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => CSV });
    await expect(
      loadGameweek("2025-26", 3, { cacheDir: dir, fetchImpl: fetchImpl as never }),
    ).rejects.toThrow();
    const rows = await loadGameweek("2025-26", 3, { cacheDir: dir, fetchImpl: fetchImpl as never });
    expect(rows).toHaveLength(1);
  });
});

describe("buildManifest", () => {
  it("emits stable JSON ordered by season then round", () => {
    const a = buildManifest([
      { season: "2025-26", round: 2, rows: 5, sha256: "bb", hasXp: false },
      { season: "2025-26", round: 1, rows: 4, sha256: "aa", hasXp: true },
    ]);
    const b = buildManifest([
      { season: "2025-26", round: 1, rows: 4, sha256: "aa", hasXp: true },
      { season: "2025-26", round: 2, rows: 5, sha256: "bb", hasXp: false },
    ]);
    expect(a).toBe(b);
    expect(JSON.parse(a).entries[0].round).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/backtest/corpus.test.ts`
Expected: FAIL — cannot resolve `@/lib/backtest/corpus`.

- [ ] **Step 3: Implement the corpus loader**

Create `src/lib/backtest/corpus.ts`:

```typescript
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
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/backtest/corpus.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/backtest/corpus.ts src/lib/backtest/corpus.test.ts
git commit -m "feat(backtest): corpus loader with disk cache and manifest

404 returns null (not yet published); any other failure throws, because
silently skipping a gameweek would quietly shrink the evaluation set."
```

---

### Task 3: Panel assembly

**Files:**
- Create: `src/lib/backtest/types.ts`
- Create: `src/lib/backtest/panel.ts`
- Create: `src/lib/backtest/panel.test.ts`

**Interfaces:**
- Consumes: `loadGameweek`, `Season` from Task 2.
- Produces:
  - `interface PanelRow` — see code below
  - `toPanelRows(raw: Array<Record<string,string>>, season: Season, round: number): PanelRow[]`
  - `groupByPlayer(rows: PanelRow[]): Map<number, PanelRow[]>` — each list sorted ascending by round

- [ ] **Step 1: Write the failing test**

Create `src/lib/backtest/panel.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { groupByPlayer, toPanelRows } from "@/lib/backtest/panel";

const HEADER_ROW = {
  name: "Player One",
  position: "GK",
  element: "7",
  team: "Arsenal",
  round: "5",
  minutes: "90",
  starts: "1",
  total_points: "6",
  goals_scored: "0",
  assists: "0",
  clean_sheets: "1",
  goals_conceded: "0",
  own_goals: "0",
  penalties_saved: "0",
  penalties_missed: "0",
  yellow_cards: "0",
  red_cards: "0",
  saves: "3",
  bonus: "1",
  bps: "28",
  expected_goals: "0.01",
  expected_assists: "0.02",
  expected_goals_conceded: "0.90",
  defensive_contribution: "4",
  was_home: "True",
  opponent_team: "12",
  value: "55",
  xP: "4.2",
};

describe("toPanelRows", () => {
  it("normalises the archive GK position to the app's GKP", () => {
    const [row] = toPanelRows([HEADER_ROW], "2025-26", 5);
    expect(row.position).toBe("GKP");
  });

  it("coerces numeric columns to numbers", () => {
    const [row] = toPanelRows([HEADER_ROW], "2025-26", 5);
    expect(row.minutes).toBe(90);
    expect(row.bps).toBe(28);
    expect(row.expectedGoals).toBeCloseTo(0.01);
    expect(row.totalPoints).toBe(6);
  });

  it("parses was_home as a boolean", () => {
    const [home] = toPanelRows([HEADER_ROW], "2025-26", 5);
    expect(home.wasHome).toBe(true);
    const [away] = toPanelRows([{ ...HEADER_ROW, was_home: "False" }], "2025-26", 5);
    expect(away.wasHome).toBe(false);
  });

  it("uses the caller's round, not the file's, so mislabelled rows cannot leak", () => {
    const [row] = toPanelRows([{ ...HEADER_ROW, round: "31" }], "2025-26", 5);
    expect(row.round).toBe(5);
  });

  it("marks xP as absent when the column is zero", () => {
    const [row] = toPanelRows([{ ...HEADER_ROW, xP: "0" }], "2025-26", 5);
    expect(row.fplXp).toBeNull();
  });

  it("keeps xP when the column carries a value", () => {
    const [row] = toPanelRows([HEADER_ROW], "2025-26", 5);
    expect(row.fplXp).toBeCloseTo(4.2);
  });

  it("treats a missing defensive_contribution column as zero", () => {
    const { defensive_contribution: _drop, ...withoutDc } = HEADER_ROW;
    const [row] = toPanelRows([withoutDc], "2024-25", 5);
    expect(row.defensiveContribution).toBe(0);
  });
});

describe("groupByPlayer", () => {
  it("groups by element id and sorts each list ascending by round", () => {
    const rows = [
      ...toPanelRows([{ ...HEADER_ROW, element: "7" }], "2025-26", 9),
      ...toPanelRows([{ ...HEADER_ROW, element: "7" }], "2025-26", 2),
      ...toPanelRows([{ ...HEADER_ROW, element: "8" }], "2025-26", 4),
    ];
    const grouped = groupByPlayer(rows);
    expect(grouped.get(7)?.map((r) => r.round)).toEqual([2, 9]);
    expect(grouped.get(8)?.map((r) => r.round)).toEqual([4]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/backtest/panel.test.ts`
Expected: FAIL — cannot resolve `@/lib/backtest/panel`.

- [ ] **Step 3: Create the shared types**

Create `src/lib/backtest/types.ts`:

```typescript
import type { Position } from "@/lib/types";
import type { Season } from "@/lib/backtest/corpus";

/** One player's observed record for one gameweek. */
export interface PanelRow {
  season: Season;
  round: number;
  playerId: number;
  webName: string;
  position: Position;
  teamName: string;
  opponentTeam: number;
  wasHome: boolean;
  minutes: number;
  starts: number;
  totalPoints: number;
  goalsScored: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  ownGoals: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  bonus: number;
  bps: number;
  expectedGoals: number;
  expectedAssists: number;
  expectedGoalsConceded: number;
  defensiveContribution: number;
  value: number;
  /** FPL's own expected points, or null when the column is absent/zero. */
  fplXp: number | null;
}
```

- [ ] **Step 4: Implement the panel builder**

Create `src/lib/backtest/panel.ts`:

```typescript
// Turns raw archive records into typed rows.
//
// The caller's round wins over the file's `round` column: a mislabelled row
// would otherwise place a future observation into an earlier round and defeat
// the leakage guard in features.ts.

import type { Position } from "@/lib/types";
import type { Season } from "@/lib/backtest/corpus";
import type { PanelRow } from "@/lib/backtest/types";

function num(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function toPosition(raw: string | undefined): Position {
  switch (raw) {
    case "GK":
    case "GKP":
      return "GKP";
    case "DEF":
      return "DEF";
    case "MID":
      return "MID";
    case "FWD":
      return "FWD";
    default:
      throw new Error(`unknown position in corpus: ${String(raw)}`);
  }
}

export function toPanelRows(
  raw: Array<Record<string, string>>,
  season: Season,
  round: number,
): PanelRow[] {
  return raw.map((r) => {
    const xp = num(r.xP);
    return {
      season,
      round,
      playerId: num(r.element),
      webName: r.name ?? "",
      position: toPosition(r.position),
      teamName: r.team ?? "",
      opponentTeam: num(r.opponent_team),
      wasHome: (r.was_home ?? "").toLowerCase() === "true",
      minutes: num(r.minutes),
      starts: num(r.starts),
      totalPoints: num(r.total_points),
      goalsScored: num(r.goals_scored),
      assists: num(r.assists),
      cleanSheets: num(r.clean_sheets),
      goalsConceded: num(r.goals_conceded),
      ownGoals: num(r.own_goals),
      penaltiesSaved: num(r.penalties_saved),
      penaltiesMissed: num(r.penalties_missed),
      yellowCards: num(r.yellow_cards),
      redCards: num(r.red_cards),
      saves: num(r.saves),
      bonus: num(r.bonus),
      bps: num(r.bps),
      expectedGoals: num(r.expected_goals),
      expectedAssists: num(r.expected_assists),
      expectedGoalsConceded: num(r.expected_goals_conceded),
      defensiveContribution: num(r.defensive_contribution),
      value: num(r.value),
      fplXp: xp === 0 ? null : xp,
    };
  });
}

export function groupByPlayer(rows: PanelRow[]): Map<number, PanelRow[]> {
  const grouped = new Map<number, PanelRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.playerId);
    if (list) list.push(row);
    else grouped.set(row.playerId, [row]);
  }
  for (const list of grouped.values()) list.sort((a, b) => a.round - b.round);
  return grouped;
}
```

- [ ] **Step 5: Run to verify the tests pass**

Run: `npx vitest run src/lib/backtest/panel.test.ts`
Expected: 8 passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/backtest/types.ts src/lib/backtest/panel.ts src/lib/backtest/panel.test.ts
git commit -m "feat(backtest): typed panel rows from archive records

Normalises the archive's GK to the app's GKP, and trusts the caller's round
over the file's column so a mislabelled row cannot defeat the leakage guard."
```

---

### Task 4: Points decomposition

**Files:**
- Create: `src/lib/projections/scoring-rules.ts`
- Create: `src/lib/backtest/decompose.ts`
- Create: `src/lib/backtest/decompose.test.ts`

**Interfaces:**
- Consumes: `PanelRow` from Task 3.
- Produces:
  - From `scoring-rules.ts`: `DC_THRESHOLD: Record<Position, number | null>`, `GOAL_POINTS: Record<Position, number>`, `CLEAN_SHEET_POINTS: Record<Position, number>`, `ASSIST_POINTS: number`, `DC_POINTS: number`
  - From `decompose.ts`: `interface PointsBreakdown { appearance: number; goals: number; assists: number; cleanSheet: number; concededPenalty: number; saves: number; penaltiesSaved: number; penaltiesMissed: number; ownGoals: number; cards: number; bonus: number; defensiveContribution: number; total: number }` and `decomposeActualPoints(row: PanelRow): PointsBreakdown`

The scoring constants live under `projections/`, not `backtest/`, so the dependency
runs backtest → projections. The reverse would make the live scoring path import from
the backtest module, dragging `node:fs` and `node:crypto` into the app's import graph.

The evaluator uses this to attribute error to a scoring component rather than reporting a single opaque residual. It is also how the defensive-contribution thresholds were established.

- [ ] **Step 1: Write the failing test**

Create `src/lib/backtest/decompose.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { decomposeActualPoints } from "@/lib/backtest/decompose";
import { DC_THRESHOLD } from "@/lib/projections/scoring-rules";
import type { PanelRow } from "@/lib/backtest/types";

function row(overrides: Partial<PanelRow>): PanelRow {
  return {
    season: "2025-26",
    round: 10,
    playerId: 1,
    webName: "Test",
    position: "MID",
    teamName: "T",
    opponentTeam: 2,
    wasHome: true,
    minutes: 90,
    starts: 1,
    totalPoints: 0,
    goalsScored: 0,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 0,
    ownGoals: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 0,
    bps: 0,
    expectedGoals: 0,
    expectedAssists: 0,
    expectedGoalsConceded: 0,
    defensiveContribution: 0,
    value: 50,
    fplXp: null,
    ...overrides,
  };
}

describe("DC_THRESHOLD", () => {
  it("is 10 for defenders and 12 for midfielders and forwards", () => {
    expect(DC_THRESHOLD.DEF).toBe(10);
    expect(DC_THRESHOLD.MID).toBe(12);
    expect(DC_THRESHOLD.FWD).toBe(12);
  });

  it("is null for goalkeepers, who never receive it", () => {
    expect(DC_THRESHOLD.GKP).toBeNull();
  });
});

describe("decomposeActualPoints", () => {
  it("awards 2 appearance points for 60 or more minutes", () => {
    expect(decomposeActualPoints(row({ minutes: 60 })).appearance).toBe(2);
  });

  it("awards 1 appearance point below 60 minutes", () => {
    expect(decomposeActualPoints(row({ minutes: 45 })).appearance).toBe(1);
  });

  it("awards no appearance points for an unused player", () => {
    expect(decomposeActualPoints(row({ minutes: 0 })).appearance).toBe(0);
  });

  it("scores goals by position", () => {
    expect(decomposeActualPoints(row({ position: "DEF", goalsScored: 1 })).goals).toBe(6);
    expect(decomposeActualPoints(row({ position: "MID", goalsScored: 1 })).goals).toBe(5);
    expect(decomposeActualPoints(row({ position: "FWD", goalsScored: 1 })).goals).toBe(4);
  });

  it("scores clean sheets only for 60+ minutes and only for GKP, DEF and MID", () => {
    expect(decomposeActualPoints(row({ position: "DEF", cleanSheets: 1 })).cleanSheet).toBe(4);
    expect(decomposeActualPoints(row({ position: "MID", cleanSheets: 1 })).cleanSheet).toBe(1);
    expect(decomposeActualPoints(row({ position: "FWD", cleanSheets: 1 })).cleanSheet).toBe(0);
    expect(
      decomposeActualPoints(row({ position: "DEF", cleanSheets: 1, minutes: 30 })).cleanSheet,
    ).toBe(0);
  });

  it("deducts one point per two goals conceded for GKP and DEF only", () => {
    expect(decomposeActualPoints(row({ position: "DEF", goalsConceded: 3 })).concededPenalty).toBe(-1);
    expect(decomposeActualPoints(row({ position: "MID", goalsConceded: 3 })).concededPenalty).toBe(0);
  });

  it("awards one point per three saves", () => {
    expect(decomposeActualPoints(row({ position: "GKP", saves: 7 })).saves).toBe(2);
  });

  it("awards defensive contribution at the defender threshold of 10", () => {
    expect(decomposeActualPoints(row({ position: "DEF", defensiveContribution: 9 })).defensiveContribution).toBe(0);
    expect(decomposeActualPoints(row({ position: "DEF", defensiveContribution: 10 })).defensiveContribution).toBe(2);
  });

  it("awards defensive contribution at the midfield threshold of 12", () => {
    expect(decomposeActualPoints(row({ position: "MID", defensiveContribution: 11 })).defensiveContribution).toBe(0);
    expect(decomposeActualPoints(row({ position: "MID", defensiveContribution: 12 })).defensiveContribution).toBe(2);
  });

  it("never awards defensive contribution to a goalkeeper", () => {
    expect(decomposeActualPoints(row({ position: "GKP", defensiveContribution: 30 })).defensiveContribution).toBe(0);
  });

  it("sums components into total", () => {
    const b = decomposeActualPoints(row({ position: "MID", goalsScored: 1, assists: 1, bonus: 3 }));
    expect(b.total).toBe(b.appearance + b.goals + b.assists + b.cleanSheet + b.concededPenalty +
      b.saves + b.penaltiesSaved + b.penaltiesMissed + b.ownGoals + b.cards + b.bonus + b.defensiveContribution);
  });

  it("reproduces recorded totals for a clean 2025-26 case", () => {
    // A defender, 90 minutes, no clean sheet, no returns, DC 11 -> 2 + 2 = 4.
    const b = decomposeActualPoints(
      row({ position: "DEF", minutes: 90, goalsConceded: 1, defensiveContribution: 11 }),
    );
    expect(b.total).toBe(4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/backtest/decompose.test.ts`
Expected: FAIL — cannot resolve `@/lib/backtest/decompose`.

- [ ] **Step 3: Create the shared scoring rules**

Create `src/lib/projections/scoring-rules.ts`. Both the decomposition of observed
points and the forward model must agree on these, so they are defined once.

```typescript
// FPL scoring constants, shared by the model (which predicts points) and the
// decomposition (which explains observed points). Defined once so the two can
// never disagree.

import type { Position } from "@/lib/types";

export const GOAL_POINTS: Record<Position, number> = { GKP: 6, DEF: 6, MID: 5, FWD: 4 };
export const CLEAN_SHEET_POINTS: Record<Position, number> = { GKP: 4, DEF: 4, MID: 1, FWD: 0 };
export const ASSIST_POINTS = 3;

/** Defensive-contribution count at which 2 points are awarded. Null = never. */
export const DC_THRESHOLD: Record<Position, number | null> = {
  GKP: null,
  DEF: 10,
  MID: 12,
  FWD: 12,
};

export const DC_POINTS = 2;
```

- [ ] **Step 4: Implement the decomposition**

Create `src/lib/backtest/decompose.ts`:

```typescript
// Splits an observed gameweek score into its scoring components.
//
// Used by the evaluator to attribute error to a component rather than
// reporting one opaque residual, and to verify the defensive-contribution
// thresholds against recorded data rather than against the rulebook.

import type { PanelRow } from "@/lib/backtest/types";
import {
  CLEAN_SHEET_POINTS,
  DC_POINTS,
  DC_THRESHOLD,
  GOAL_POINTS,
} from "@/lib/projections/scoring-rules";

export interface PointsBreakdown {
  appearance: number;
  goals: number;
  assists: number;
  cleanSheet: number;
  concededPenalty: number;
  saves: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  ownGoals: number;
  cards: number;
  bonus: number;
  defensiveContribution: number;
  total: number;
}

export function decomposeActualPoints(row: PanelRow): PointsBreakdown {
  const played60 = row.minutes >= 60;
  const concedes = row.position === "GKP" || row.position === "DEF";
  const threshold = DC_THRESHOLD[row.position];

  const parts = {
    appearance: row.minutes === 0 ? 0 : played60 ? 2 : 1,
    goals: row.goalsScored * GOAL_POINTS[row.position],
    assists: row.assists * 3,
    cleanSheet: played60 && row.cleanSheets > 0 ? CLEAN_SHEET_POINTS[row.position] : 0,
    concededPenalty: concedes ? -Math.floor(row.goalsConceded / 2) : 0,
    saves: Math.floor(row.saves / 3),
    penaltiesSaved: row.penaltiesSaved * 5,
    penaltiesMissed: row.penaltiesMissed * -2,
    ownGoals: row.ownGoals * -2,
    cards: row.yellowCards * -1 + row.redCards * -3,
    bonus: row.bonus,
    defensiveContribution:
      threshold !== null && row.defensiveContribution >= threshold ? DC_POINTS : 0,
  };

  const total = Object.values(parts).reduce((sum, v) => sum + v, 0);
  return { ...parts, total };
}
```

- [ ] **Step 5: Run to verify the tests pass**

Run: `npx vitest run src/lib/backtest/decompose.test.ts`
Expected: 13 passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/projections/scoring-rules.ts src/lib/backtest/decompose.ts src/lib/backtest/decompose.test.ts
git commit -m "feat(backtest): decompose observed points into scoring components

Thresholds for defensive contribution (10 DEF, 12 MID/FWD) were derived from
recorded 2025-26 data, not from the rulebook."
```

---

### Task 5: Feature builder with leakage guard

**Files:**
- Create: `src/lib/projections/features.ts`
- Create: `src/lib/projections/features.test.ts`

**Interfaces:**
- Consumes: `PanelRow` from Task 3.
- Produces:
  - `interface PlayerFeatures` — see code below. **Every later task depends on these exact field names.**
  - `class LeakageError extends Error`
  - `MIN_HISTORY_ROUNDS = 3`
  - `buildFeatures(history: PanelRow[], round: number, fixture: FixtureContext): PlayerFeatures`
  - `interface FixtureContext { fdr: number; isHome: boolean; fixtureCount: number; opponentXgcPer90: number }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/projections/features.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { LeakageError, buildFeatures } from "@/lib/projections/features";
import type { PanelRow } from "@/lib/backtest/types";

function row(round: number, overrides: Partial<PanelRow> = {}): PanelRow {
  return {
    season: "2025-26",
    round,
    playerId: 1,
    webName: "Test",
    position: "MID",
    teamName: "T",
    opponentTeam: 2,
    wasHome: true,
    minutes: 90,
    starts: 1,
    totalPoints: 5,
    goalsScored: 0,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 1,
    ownGoals: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 0,
    bps: 20,
    expectedGoals: 0.3,
    expectedAssists: 0.2,
    expectedGoalsConceded: 1.1,
    defensiveContribution: 6,
    value: 70,
    fplXp: null,
    ...overrides,
  };
}

const FIXTURE = { fdr: 3, isHome: true, fixtureCount: 1, opponentXgcPer90: 1.2 };

describe("buildFeatures leakage guard", () => {
  it("throws when handed a row from the round being predicted", () => {
    expect(() => buildFeatures([row(4), row(5)], 5, FIXTURE)).toThrow(LeakageError);
  });

  it("throws when handed a row from a later round", () => {
    expect(() => buildFeatures([row(4), row(9)], 5, FIXTURE)).toThrow(LeakageError);
  });

  it("names the offending round in the error", () => {
    expect(() => buildFeatures([row(7)], 5, FIXTURE)).toThrow(/round 7/);
  });

  it("accepts history consisting only of earlier rounds", () => {
    expect(() => buildFeatures([row(1), row(2), row(3)], 5, FIXTURE)).not.toThrow();
  });
});

describe("buildFeatures rolling values", () => {
  it("computes per-90 rates from prior rounds only", () => {
    // Two 90-minute rounds, 0.3 xG each -> 0.3 per 90.
    const f = buildFeatures([row(1), row(2), row(3)], 4, FIXTURE);
    expect(f.xg90).toBeCloseTo(0.3, 5);
    expect(f.xa90).toBeCloseTo(0.2, 5);
  });

  it("excludes the future round from the average", () => {
    const withFuture = [row(1, { expectedGoals: 0.1 }), row(2, { expectedGoals: 0.1 }), row(3, { expectedGoals: 0.1 })];
    const f = buildFeatures(withFuture, 4, FIXTURE);
    expect(f.xg90).toBeCloseTo(0.1, 5);
  });

  it("reports startRate as the fraction of prior rounds started", () => {
    const f = buildFeatures([row(1, { starts: 1 }), row(2, { starts: 0 }), row(3, { starts: 1 }), row(4, { starts: 1 })], 5, FIXTURE);
    expect(f.startRate).toBeCloseTo(0.75, 5);
  });

  it("reports minutesPerStart from started rounds only", () => {
    const f = buildFeatures(
      [row(1, { starts: 1, minutes: 90 }), row(2, { starts: 0, minutes: 5 }), row(3, { starts: 1, minutes: 70 })],
      4,
      FIXTURE,
    );
    expect(f.minutesPerStart).toBeCloseTo(80, 5);
  });

  it("computes bps90 from prior rounds, which is what replaces the cumulative ICT term", () => {
    const f = buildFeatures([row(1, { bps: 30 }), row(2, { bps: 10 })], 3, FIXTURE);
    expect(f.bps90).toBeCloseTo(20, 5);
  });

  it("computes dcPer90 from prior rounds", () => {
    const f = buildFeatures([row(1, { defensiveContribution: 8 }), row(2, { defensiveContribution: 12 })], 3, FIXTURE);
    expect(f.dcPer90).toBeCloseTo(10, 5);
  });

  it("honours the rolling window and ignores rounds older than it", () => {
    const old = Array.from({ length: 10 }, (_, i) => row(i + 1, { expectedGoals: 1 }));
    const recent = Array.from({ length: 6 }, (_, i) => row(i + 11, { expectedGoals: 0 }));
    const f = buildFeatures([...old, ...recent], 17, FIXTURE, { window: 6 });
    expect(f.xg90).toBeCloseTo(0, 5);
  });

  it("reports sampleRounds so the caller can reject thin history", () => {
    expect(buildFeatures([row(1), row(2)], 3, FIXTURE).sampleRounds).toBe(2);
  });

  it("returns zeroed rates for a player with no history rather than NaN", () => {
    const f = buildFeatures([], 1, FIXTURE);
    expect(f.xg90).toBe(0);
    expect(f.minutesPerStart).toBe(0);
    expect(f.sampleRounds).toBe(0);
    expect(Number.isNaN(f.bps90)).toBe(false);
  });

  it("carries the fixture context through unchanged", () => {
    const f = buildFeatures([row(1)], 2, { fdr: 5, isHome: false, fixtureCount: 2, opponentXgcPer90: 0.7 });
    expect(f.fdr).toBe(5);
    expect(f.isHome).toBe(false);
    expect(f.fixtureCount).toBe(2);
    expect(f.opponentXgcPer90).toBeCloseTo(0.7);
  });

  it("defaults availability to 1 when not supplied", () => {
    expect(buildFeatures([row(1)], 2, FIXTURE).availability).toBe(1);
  });

  it("clamps supplied availability into 0..1", () => {
    expect(buildFeatures([row(1)], 2, FIXTURE, { availability: 1.4 }).availability).toBe(1);
    expect(buildFeatures([row(1)], 2, FIXTURE, { availability: -3 }).availability).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/projections/features.test.ts`
Expected: FAIL — cannot resolve `@/lib/projections/features`.

- [ ] **Step 3: Implement the feature builder**

Create `src/lib/projections/features.ts`:

```typescript
// Builds the feature vector the scoring model consumes.
//
// The signature is the leakage guard: buildFeatures cannot see the round it is
// predicting, and throws if handed a row from it or later. That makes leakage a
// bug the harness structurally cannot express, rather than one a reviewer has
// to notice.
//
// Rolling rates are rebuilt from per-match observations rather than read from
// FPL's live per-90 and season-cumulative fields, because we control the window
// and the same code can run over history.

import type { Position } from "@/lib/types";
import type { PanelRow } from "@/lib/backtest/types";

/** Fewer prior rounds than this and a projection is not trustworthy. */
export const MIN_HISTORY_ROUNDS = 3;

/** Default rolling window, in rounds. Tuned in Task 9. */
export const DEFAULT_WINDOW = 6;

export class LeakageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeakageError";
  }
}

export interface FixtureContext {
  /** 1 (easy) .. 5 (hard). */
  fdr: number;
  isHome: boolean;
  /** 0 for a blank gameweek, 1 normally, 2+ for a double. */
  fixtureCount: number;
  /** Rolling expected goals conceded per 90 by the opponent. */
  opponentXgcPer90: number;
}

export interface PlayerFeatures {
  playerId: number;
  webName: string;
  position: Position;
  /** Rolling expected goals per 90 minutes, prior rounds only. */
  xg90: number;
  /** Rolling expected assists per 90 minutes, prior rounds only. */
  xa90: number;
  /** Rolling bonus-point-system score per 90. Replaces the cumulative ICT term. */
  bps90: number;
  /** Rolling defensive-contribution count per 90. */
  dcPer90: number;
  /** Fraction of prior rounds in which the player started. */
  startRate: number;
  /** Mean minutes in rounds the player started. */
  minutesPerStart: number;
  /** 0..1 chance of being available. 1 when unknown. */
  availability: number;
  fdr: number;
  isHome: boolean;
  fixtureCount: number;
  opponentXgcPer90: number;
  /** How many prior rounds contributed. Compare against MIN_HISTORY_ROUNDS. */
  sampleRounds: number;
}

export interface BuildFeaturesOptions {
  window?: number;
  availability?: number;
}

function per90(total: number, minutes: number): number {
  if (minutes <= 0) return 0;
  return (total / minutes) * 90;
}

function clampUnit(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * @param history Rows for one player. Must contain no row with `round >= round`.
 * @param round   The round being predicted.
 * @throws {LeakageError} if any row is from `round` or later.
 */
export function buildFeatures(
  history: PanelRow[],
  round: number,
  fixture: FixtureContext,
  opts: BuildFeaturesOptions = {},
): PlayerFeatures {
  for (const row of history) {
    if (row.round >= round) {
      throw new LeakageError(
        `buildFeatures for round ${round} was given a row from round ${row.round}`,
      );
    }
  }

  const window = opts.window ?? DEFAULT_WINDOW;
  const recent = [...history].sort((a, b) => a.round - b.round).slice(-window);

  const minutes = recent.reduce((s, r) => s + r.minutes, 0);
  const started = recent.filter((r) => r.starts > 0);
  const startedMinutes = started.reduce((s, r) => s + r.minutes, 0);

  const first = history[0];

  return {
    playerId: first?.playerId ?? 0,
    webName: first?.webName ?? "",
    position: first?.position ?? "MID",
    xg90: per90(recent.reduce((s, r) => s + r.expectedGoals, 0), minutes),
    xa90: per90(recent.reduce((s, r) => s + r.expectedAssists, 0), minutes),
    bps90: per90(recent.reduce((s, r) => s + r.bps, 0), minutes),
    dcPer90: per90(recent.reduce((s, r) => s + r.defensiveContribution, 0), minutes),
    startRate: recent.length === 0 ? 0 : started.length / recent.length,
    minutesPerStart: started.length === 0 ? 0 : startedMinutes / started.length,
    availability: opts.availability === undefined ? 1 : clampUnit(opts.availability),
    fdr: fixture.fdr,
    isHome: fixture.isHome,
    fixtureCount: fixture.fixtureCount,
    opponentXgcPer90: fixture.opponentXgcPer90,
    sampleRounds: recent.length,
  };
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/projections/features.test.ts`
Expected: 18 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/projections/features.ts src/lib/projections/features.test.ts
git commit -m "feat(projections): leak-free feature builder

buildFeatures throws if handed a row from the round being predicted or later,
so leakage becomes a bug the harness cannot express. Rolling rates are rebuilt
from per-match observations rather than FPL's cumulative fields."
```

---

### Task 6: The scoring function — defects 1 through 4

**Files:**
- Create: `src/lib/projections/scoring.ts`
- Create: `src/lib/projections/scoring.test.ts`

**Interfaces:**
- Consumes: `PlayerFeatures` from Task 5.
- Produces:
  - `interface ScoreComponents { appearance: number; goals: number; assists: number; cleanSheet: number; bonus: number; defensiveContribution: number }`
  - `interface ScoredPlayer { xPoints: number; components: ScoreComponents; expectedMinutes: number; playProbability: number }`
  - `scorePlayer(f: PlayerFeatures): ScoredPlayer`

This is the single function both the live app and the backtest call. Defect 6 (defensive contribution) lands in Task 7; this task leaves `components.defensiveContribution` at 0 and a test asserts that, so Task 7's change is visible.

**Defects fixed here:**
1. Minutes probability applied twice → `playProbability` multiplies exactly once.
2. Form term double-counting → no form term exists.
3. Bonus from cumulative ICT → bonus derived from `bps90`.
4. FDR applied three times → applied once, through `opponentXgcPer90`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/projections/scoring.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import type { PlayerFeatures } from "@/lib/projections/features";
import { scorePlayer } from "@/lib/projections/scoring";

function features(overrides: Partial<PlayerFeatures> = {}): PlayerFeatures {
  return {
    playerId: 1,
    webName: "Test",
    position: "MID",
    xg90: 0.3,
    xa90: 0.2,
    bps90: 20,
    dcPer90: 4,
    startRate: 1,
    minutesPerStart: 90,
    availability: 1,
    fdr: 3,
    isHome: true,
    fixtureCount: 1,
    opponentXgcPer90: 1.2,
    sampleRounds: 6,
    ...overrides,
  };
}

describe("regression: minutes probability is applied exactly once", () => {
  it("halving play probability halves expected points, rather than quartering them", () => {
    const full = scorePlayer(features({ availability: 1, startRate: 1 })).xPoints;
    const half = scorePlayer(features({ availability: 0.5, startRate: 1 })).xPoints;
    expect(half / full).toBeCloseTo(0.5, 2);
  });

  it("a 75% availability player is not priced at 56%", () => {
    const full = scorePlayer(features({ availability: 1 })).xPoints;
    const partial = scorePlayer(features({ availability: 0.75 })).xPoints;
    expect(partial / full).toBeCloseTo(0.75, 2);
    expect(partial / full).toBeGreaterThan(0.7);
  });

  it("exposes playProbability as the single applied factor", () => {
    expect(scorePlayer(features({ availability: 0.5, startRate: 1 })).playProbability).toBeCloseTo(0.5, 5);
  });
});

describe("regression: form is not added on top of component terms", () => {
  it("gives identical scores to two players whose rolling rates match", () => {
    // Historically a "hot" player got a bonus for output already counted in xg90.
    const a = scorePlayer(features({ xg90: 0.3, xa90: 0.2, bps90: 20 })).xPoints;
    const b = scorePlayer(features({ xg90: 0.3, xa90: 0.2, bps90: 20 })).xPoints;
    expect(a).toBe(b);
  });

  it("has no component that is not one of the six scoring categories", () => {
    const { components } = scorePlayer(features());
    expect(Object.keys(components).sort()).toEqual(
      ["appearance", "assists", "bonus", "cleanSheet", "defensiveContribution", "goals"].sort(),
    );
  });
});

describe("regression: bonus expectation does not drift with season progress", () => {
  it("scores an identical player identically at round 5 and round 30", () => {
    // bps90 is a rate, so an identical player late in the season scores the same.
    const early = scorePlayer(features({ bps90: 20, sampleRounds: 4 })).components.bonus;
    const late = scorePlayer(features({ bps90: 20, sampleRounds: 30 })).components.bonus;
    expect(late).toBeCloseTo(early, 10);
  });

  it("still discriminates between a high-bps and a low-bps player", () => {
    const high = scorePlayer(features({ bps90: 35 })).components.bonus;
    const low = scorePlayer(features({ bps90: 8 })).components.bonus;
    expect(high).toBeGreaterThan(low);
  });

  it("caps the bonus term below the 3-point maximum a player can actually earn", () => {
    expect(scorePlayer(features({ bps90: 500 })).components.bonus).toBeLessThanOrEqual(3);
  });
});

describe("regression: fixture difficulty is applied exactly once", () => {
  it("changes clean-sheet expectation via opponent strength", () => {
    const easy = scorePlayer(features({ position: "DEF", opponentXgcPer90: 0.4 })).components.cleanSheet;
    const hard = scorePlayer(features({ position: "DEF", opponentXgcPer90: 2.5 })).components.cleanSheet;
    expect(easy).toBeGreaterThan(hard);
  });

  it("does not additionally subtract a flat penalty for a hard fixture", () => {
    // With opponent strength held constant, the raw fdr number must not move the score.
    const a = scorePlayer(features({ fdr: 1, opponentXgcPer90: 1.2 })).xPoints;
    const b = scorePlayer(features({ fdr: 5, opponentXgcPer90: 1.2 })).xPoints;
    expect(a).toBeCloseTo(b, 10);
  });
});

describe("scorePlayer general behaviour", () => {
  it("returns zero for a blank gameweek", () => {
    expect(scorePlayer(features({ fixtureCount: 0 })).xPoints).toBe(0);
  });

  it("scales with fixture count for a double gameweek", () => {
    const single = scorePlayer(features({ fixtureCount: 1 })).xPoints;
    const double = scorePlayer(features({ fixtureCount: 2 })).xPoints;
    expect(double).toBeGreaterThan(single);
    expect(double).toBeLessThanOrEqual(single * 2 + 1e-9);
  });

  it("is monotonic in xg90", () => {
    const low = scorePlayer(features({ xg90: 0.1 })).xPoints;
    const high = scorePlayer(features({ xg90: 0.8 })).xPoints;
    expect(high).toBeGreaterThan(low);
  });

  it("is never negative", () => {
    expect(scorePlayer(features({ xg90: 0, xa90: 0, bps90: 0, availability: 0 })).xPoints).toBeGreaterThanOrEqual(0);
  });

  it("is never NaN for any zeroed input", () => {
    const z = scorePlayer(features({ xg90: 0, xa90: 0, bps90: 0, dcPer90: 0, startRate: 0, minutesPerStart: 0, opponentXgcPer90: 0 }));
    expect(Number.isNaN(z.xPoints)).toBe(false);
  });

  it("awards defenders more per goal than forwards", () => {
    const def = scorePlayer(features({ position: "DEF", xg90: 0.5 })).components.goals;
    const fwd = scorePlayer(features({ position: "FWD", xg90: 0.5 })).components.goals;
    expect(def).toBeGreaterThan(fwd);
  });

  it("gives forwards no clean-sheet credit", () => {
    expect(scorePlayer(features({ position: "FWD" })).components.cleanSheet).toBe(0);
  });

  it("leaves defensive contribution at zero until Task 7 implements it", () => {
    expect(scorePlayer(features({ dcPer90: 30 })).components.defensiveContribution).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/projections/scoring.test.ts`
Expected: FAIL — cannot resolve `@/lib/projections/scoring`.

- [ ] **Step 3: Implement scoring**

Create `src/lib/projections/scoring.ts`:

```typescript
// The expected-points model. This is the single scoring path: the live app and
// the backtest harness both call it, so the harness validates shipped code.
//
// Fixes, each covered by a named regression test in scoring.test.ts:
//   1. Play probability is applied exactly once (it used to be squared).
//   2. There is no form term (it double-counted output already in xg90/xa90/bps90).
//   3. Bonus comes from a per-90 BPS rate, not a season-cumulative ICT index.
//   4. Fixture difficulty enters once, through opponentXgcPer90.
//
// Coefficients marked TUNED are fitted in Task 9 against 2025-26 and must not be
// hand-adjusted without re-running the backtest.

import type { Position } from "@/lib/types";
import type { PlayerFeatures } from "@/lib/projections/features";
import {
  ASSIST_POINTS,
  CLEAN_SHEET_POINTS,
  GOAL_POINTS,
} from "@/lib/projections/scoring-rules";

/** TUNED. Maps a per-90 BPS rate onto expected bonus points, capped at the real max of 3. */
const BONUS_PER_BPS90 = 0.06;
const MAX_BONUS = 3;

/** TUNED. Poisson rate parameter converting opponent xGC/90 into P(clean sheet). */
const CLEAN_SHEET_BASE = 1.0;

export interface ScoreComponents {
  appearance: number;
  goals: number;
  assists: number;
  cleanSheet: number;
  bonus: number;
  defensiveContribution: number;
}

export interface ScoredPlayer {
  xPoints: number;
  components: ScoreComponents;
  /** Expected minutes for a single fixture, 0..90. */
  expectedMinutes: number;
  /** P(the player features at all). Applied once to the whole score. */
  playProbability: number;
}

/**
 * P(clean sheet) from the opponent's rolling expected goals conceded per 90,
 * as the zero bucket of a Poisson with that rate. This is the only place
 * fixture difficulty enters the model.
 */
export function cleanSheetProbability(opponentXgcPer90: number): number {
  const rate = Math.max(0, opponentXgcPer90) * CLEAN_SHEET_BASE;
  return Math.exp(-rate);
}

export function scorePlayer(f: PlayerFeatures): ScoredPlayer {
  const zero: ScoreComponents = {
    appearance: 0,
    goals: 0,
    assists: 0,
    cleanSheet: 0,
    bonus: 0,
    defensiveContribution: 0,
  };

  if (f.fixtureCount <= 0) {
    return { xPoints: 0, components: zero, expectedMinutes: 0, playProbability: 0 };
  }

  // Applied exactly once, at the end. Never folded into the per-term scaling.
  const playProbability = Math.max(0, Math.min(1, f.availability * f.startRate));
  const expectedMinutes = Math.max(0, Math.min(90, f.minutesPerStart));
  const minutesShare = expectedMinutes / 90;

  const perFixture: ScoreComponents = {
    appearance: expectedMinutes >= 60 ? 2 : expectedMinutes > 0 ? 1 : 0,
    goals: f.xg90 * minutesShare * GOAL_POINTS[f.position],
    assists: f.xa90 * minutesShare * ASSIST_POINTS,
    cleanSheet:
      CLEAN_SHEET_POINTS[f.position] > 0 && expectedMinutes >= 60
        ? cleanSheetProbability(f.opponentXgcPer90) * CLEAN_SHEET_POINTS[f.position]
        : 0,
    bonus: Math.min(MAX_BONUS, Math.max(0, f.bps90) * BONUS_PER_BPS90 * minutesShare),
    // Implemented in Task 7.
    defensiveContribution: 0,
  };

  const components: ScoreComponents = {
    appearance: perFixture.appearance * f.fixtureCount,
    goals: perFixture.goals * f.fixtureCount,
    assists: perFixture.assists * f.fixtureCount,
    cleanSheet: perFixture.cleanSheet * f.fixtureCount,
    bonus: perFixture.bonus * f.fixtureCount,
    defensiveContribution: perFixture.defensiveContribution * f.fixtureCount,
  };

  const sum = Object.values(components).reduce((s, v) => s + v, 0);
  const xPoints = Math.max(0, sum * playProbability);

  return { xPoints, components, expectedMinutes, playProbability };
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/projections/scoring.test.ts`
Expected: 18 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/projections/scoring.ts src/lib/projections/scoring.test.ts
git commit -m "feat(projections): shared scoring model fixing defects 1-4

Play probability applied once rather than squared; no form term; bonus from a
per-90 BPS rate instead of a season-cumulative ICT index; fixture difficulty
entering once via opponent expected goals conceded. Each has a named
regression test."
```

---

### Task 7: Defensive contribution — defect 6

**Files:**
- Modify: `src/lib/projections/scoring.ts`
- Modify: `src/lib/projections/scoring.test.ts`

**Interfaces:**
- Consumes: `DC_THRESHOLD` and `DC_POINTS` from `scoring-rules.ts` (Task 4), `scorePlayer` from Task 6.
- Produces: `dcProbability(dcPer90: number, position: Position, expectedMinutes: number): number`

FPL awards 2 points at a threshold count. Modelling a threshold crossing from a rate is a Poisson tail, not a linear scale — a player averaging 9 is much more than 90% as likely to hit 10 as a player averaging 5 is to hit 10.

- [ ] **Step 1: Write the failing test**

Replace the placeholder test in `src/lib/projections/scoring.test.ts` — delete the block `it("leaves defensive contribution at zero until Task 7 implements it", ...)` and append this describe block to the file:

```typescript
describe("regression: defensive contribution points are modelled", () => {
  it("awards a defender approaching the threshold of 10 a non-zero expectation", () => {
    const c = scorePlayer(features({ position: "DEF", dcPer90: 9.5 })).components.defensiveContribution;
    expect(c).toBeGreaterThan(0);
  });

  it("gives a higher expectation to a defender averaging above the threshold", () => {
    const below = scorePlayer(features({ position: "DEF", dcPer90: 6 })).components.defensiveContribution;
    const above = scorePlayer(features({ position: "DEF", dcPer90: 14 })).components.defensiveContribution;
    expect(above).toBeGreaterThan(below);
  });

  it("uses the higher threshold of 12 for midfielders, so a MID scores less than a DEF at the same rate", () => {
    const def = scorePlayer(features({ position: "DEF", dcPer90: 11 })).components.defensiveContribution;
    const mid = scorePlayer(features({ position: "MID", dcPer90: 11 })).components.defensiveContribution;
    expect(def).toBeGreaterThan(mid);
  });

  it("never awards defensive contribution to a goalkeeper", () => {
    expect(scorePlayer(features({ position: "GKP", dcPer90: 40 })).components.defensiveContribution).toBe(0);
  });

  it("never exceeds the 2 points actually on offer", () => {
    expect(scorePlayer(features({ position: "DEF", dcPer90: 60 })).components.defensiveContribution)
      .toBeLessThanOrEqual(2 + 1e-9);
  });

  it("is zero for a player expected to play no minutes", () => {
    expect(scorePlayer(features({ position: "DEF", dcPer90: 20, minutesPerStart: 0 })).components.defensiveContribution).toBe(0);
  });

  it("raises a defender's total score relative to the pre-Task-7 model", () => {
    const withDc = scorePlayer(features({ position: "DEF", dcPer90: 15 })).xPoints;
    const withoutDc = scorePlayer(features({ position: "DEF", dcPer90: 0 })).xPoints;
    expect(withDc).toBeGreaterThan(withoutDc);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/projections/scoring.test.ts`
Expected: FAIL — defensive contribution is still hard-coded to 0.

- [ ] **Step 3: Implement the defensive-contribution term**

In `src/lib/projections/scoring.ts`, add the import and the function, then replace the placeholder line.

Extend the existing `scoring-rules` import at the top to add the two DC constants:

```typescript
import {
  ASSIST_POINTS,
  CLEAN_SHEET_POINTS,
  DC_POINTS,
  DC_THRESHOLD,
  GOAL_POINTS,
} from "@/lib/projections/scoring-rules";
```

Add after `cleanSheetProbability`:

```typescript
/**
 * P(defensive-contribution count reaches the positional threshold).
 *
 * The award is a threshold crossing, not a linear scale, so this is the upper
 * tail of a Poisson whose rate is the player's per-90 count scaled to expected
 * minutes. Computed as 1 - P(X < threshold).
 */
export function dcProbability(
  dcPer90: number,
  position: Position,
  expectedMinutes: number,
): number {
  const threshold = DC_THRESHOLD[position];
  if (threshold === null || expectedMinutes <= 0) return 0;

  const rate = Math.max(0, dcPer90) * (expectedMinutes / 90);
  if (rate <= 0) return 0;

  // Poisson CDF below the threshold, computed iteratively to avoid factorials.
  let term = Math.exp(-rate);
  let cdf = term;
  for (let k = 1; k < threshold; k++) {
    term = (term * rate) / k;
    cdf += term;
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}
```

Replace this line in `perFixture`:

```typescript
    // Implemented in Task 7.
    defensiveContribution: 0,
```

with:

```typescript
    defensiveContribution:
      dcProbability(f.dcPer90, f.position, expectedMinutes) * DC_POINTS,
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/projections/scoring.test.ts`
Expected: 24 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/projections/scoring.ts src/lib/projections/scoring.test.ts
git commit -m "feat(projections): model defensive contribution points

FPL has awarded 2 points at a threshold count since 2025-26 and the model had
no term for it, systematically under-rating defenders and defensive
midfielders. Modelled as a Poisson upper tail, since the award is a threshold
crossing rather than a linear scale."
```

---

### Task 8: Evaluator with baselines and degeneracy guards

**Files:**
- Create: `src/lib/backtest/evaluate.ts`
- Create: `src/lib/backtest/evaluate.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure statistics).
- Produces:
  - `type MetricResult = { ok: true; rmse: number; mae: number; spearman: number; n: number } | { ok: false; reason: string; n: number }`
  - `evaluate(predictions: number[], actuals: number[]): MetricResult`
  - `spearman(a: number[], b: number[]): number | null`
  - `calibrationBuckets(predictions: number[], actuals: number[], bucketCount?: number): Array<{ lo: number; hi: number; n: number; meanPredicted: number; meanActual: number }>`
  - `intervalCoverage(predictions: number[], stdevs: number[], actuals: number[], z?: number): number`

The degeneracy guard is the lesson from the spec: a constant predictor makes rank correlation undefined, and an early measurement pass reported that as `NaN` flowing into a report.

- [ ] **Step 1: Write the failing test**

Create `src/lib/backtest/evaluate.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { calibrationBuckets, evaluate, intervalCoverage, spearman } from "@/lib/backtest/evaluate";

describe("spearman", () => {
  it("is 1 for a perfectly monotonic increasing relationship", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
  });

  it("is -1 for a perfectly monotonic decreasing relationship", () => {
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 10);
  });

  it("handles ties by averaging ranks", () => {
    expect(spearman([1, 1, 2, 2], [1, 1, 2, 2])).toBeCloseTo(1, 10);
  });

  it("returns null when one side has zero variance", () => {
    expect(spearman([0, 0, 0, 0], [1, 2, 3, 4])).toBeNull();
  });
});

describe("evaluate degeneracy guards", () => {
  it("refuses a constant predictor rather than returning NaN", () => {
    // This is the exact shape that produced NaN during design: an xP column of all zeros.
    const r = evaluate([0, 0, 0, 0], [1, 5, 2, 8]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/constant|variance/i);
  });

  it("refuses constant actuals", () => {
    const r = evaluate([1, 2, 3, 4], [3, 3, 3, 3]);
    expect(r.ok).toBe(false);
  });

  it("refuses an empty set", () => {
    const r = evaluate([], []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.n).toBe(0);
  });

  it("throws when the arrays have different lengths", () => {
    expect(() => evaluate([1, 2], [1])).toThrow();
  });

  it("never returns a NaN metric on a successful result", () => {
    const r = evaluate([1, 2, 3, 4], [1, 3, 2, 5]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Number.isNaN(r.rmse)).toBe(false);
      expect(Number.isNaN(r.mae)).toBe(false);
      expect(Number.isNaN(r.spearman)).toBe(false);
    }
  });
});

describe("evaluate metrics", () => {
  it("computes RMSE correctly", () => {
    const r = evaluate([1, 2, 3], [2, 4, 6]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rmse).toBeCloseTo(Math.sqrt((1 + 4 + 9) / 3), 10);
  });

  it("computes MAE correctly", () => {
    const r = evaluate([1, 2, 3], [2, 4, 6]);
    if (r.ok) expect(r.mae).toBeCloseTo((1 + 2 + 3) / 3, 10);
  });

  it("reports n", () => {
    const r = evaluate([1, 2, 3], [2, 4, 6]);
    if (r.ok) expect(r.n).toBe(3);
  });
});

describe("calibrationBuckets", () => {
  it("returns the requested number of populated buckets", () => {
    const preds = Array.from({ length: 100 }, (_, i) => i / 10);
    const acts = preds.map((p) => p + 1);
    expect(calibrationBuckets(preds, acts, 5)).toHaveLength(5);
  });

  it("reports mean predicted and mean actual per bucket", () => {
    const preds = [0, 0, 10, 10];
    const acts = [1, 1, 20, 20];
    const buckets = calibrationBuckets(preds, acts, 2);
    expect(buckets[0].meanPredicted).toBeCloseTo(0, 10);
    expect(buckets[0].meanActual).toBeCloseTo(1, 10);
    expect(buckets[buckets.length - 1].meanActual).toBeCloseTo(20, 10);
  });

  it("returns an empty array for empty input", () => {
    expect(calibrationBuckets([], [], 5)).toEqual([]);
  });
});

describe("intervalCoverage", () => {
  it("reports 1 when every actual falls inside its interval", () => {
    expect(intervalCoverage([5, 5, 5], [2, 2, 2], [5, 4, 6], 1.2816)).toBeCloseTo(1, 10);
  });

  it("reports 0 when every actual falls outside", () => {
    expect(intervalCoverage([5, 5], [0.1, 0.1], [50, -50], 1.2816)).toBeCloseTo(0, 10);
  });

  it("treats a zero stdev as a point interval", () => {
    expect(intervalCoverage([5], [0], [5], 1.2816)).toBeCloseTo(1, 10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/backtest/evaluate.test.ts`
Expected: FAIL — cannot resolve `@/lib/backtest/evaluate`.

- [ ] **Step 3: Implement the evaluator**

Create `src/lib/backtest/evaluate.ts`:

```typescript
// Scoring metrics for the backtest.
//
// Degenerate inputs return an explicit failure rather than NaN. During design a
// measurement pass reported NaN correlations and an RMSE worse than predicting
// the mean; the cause was an all-zero prediction column, which makes Spearman's
// denominator collapse. A NaN that reaches a report reads as a number.

export type MetricResult =
  | { ok: true; rmse: number; mae: number; spearman: number; n: number }
  | { ok: false; reason: string; n: number };

function ranks(values: number[]): number[] {
  const indexed = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1][0] === indexed[i][0]) j++;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[indexed[k][1]] = averageRank;
    i = j + 1;
  }
  return out;
}

function hasVariance(values: number[]): boolean {
  return values.some((v) => v !== values[0]);
}

/** Spearman rank correlation, or null when either side is constant. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  if (!hasVariance(a) || !hasVariance(b)) return null;

  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / n;
  const ma = mean(ra);
  const mb = mean(rb);

  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i] - ma;
    const y = rb[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

export function evaluate(predictions: number[], actuals: number[]): MetricResult {
  if (predictions.length !== actuals.length) {
    throw new Error(
      `evaluate: length mismatch (${predictions.length} predictions, ${actuals.length} actuals)`,
    );
  }
  const n = predictions.length;
  if (n === 0) return { ok: false, reason: "empty evaluation set", n: 0 };
  if (!hasVariance(predictions)) {
    return { ok: false, reason: "predictions are constant (zero variance)", n };
  }
  if (!hasVariance(actuals)) {
    return { ok: false, reason: "actuals are constant (zero variance)", n };
  }

  const rho = spearman(predictions, actuals);
  if (rho === null) return { ok: false, reason: "rank correlation undefined", n };

  const rmse = Math.sqrt(
    predictions.reduce((s, p, i) => s + (p - actuals[i]) ** 2, 0) / n,
  );
  const mae = predictions.reduce((s, p, i) => s + Math.abs(p - actuals[i]), 0) / n;

  return { ok: true, rmse, mae, spearman: rho, n };
}

export interface CalibrationBucket {
  lo: number;
  hi: number;
  n: number;
  meanPredicted: number;
  meanActual: number;
}

/** Equal-width buckets over the prediction range. */
export function calibrationBuckets(
  predictions: number[],
  actuals: number[],
  bucketCount = 10,
): CalibrationBucket[] {
  if (predictions.length === 0) return [];

  const lo = Math.min(...predictions);
  const hi = Math.max(...predictions);
  const width = (hi - lo) / bucketCount || 1;

  const buckets: CalibrationBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    lo: lo + i * width,
    hi: lo + (i + 1) * width,
    n: 0,
    meanPredicted: 0,
    meanActual: 0,
  }));

  for (let i = 0; i < predictions.length; i++) {
    const raw = Math.floor((predictions[i] - lo) / width);
    const index = Math.max(0, Math.min(bucketCount - 1, raw));
    const b = buckets[index];
    b.n += 1;
    b.meanPredicted += predictions[i];
    b.meanActual += actuals[i];
  }

  for (const b of buckets) {
    if (b.n > 0) {
      b.meanPredicted /= b.n;
      b.meanActual /= b.n;
    }
  }
  return buckets;
}

/**
 * Fraction of actuals falling inside prediction +/- z * stdev.
 * z defaults to 1.2816, the two-sided 80% Normal quantile.
 */
export function intervalCoverage(
  predictions: number[],
  stdevs: number[],
  actuals: number[],
  z = 1.2816,
): number {
  if (predictions.length === 0) return 0;
  let inside = 0;
  for (let i = 0; i < predictions.length; i++) {
    const half = z * stdevs[i];
    if (actuals[i] >= predictions[i] - half && actuals[i] <= predictions[i] + half) inside++;
  }
  return inside / predictions.length;
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/backtest/evaluate.test.ts`
Expected: 17 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/backtest/evaluate.ts src/lib/backtest/evaluate.test.ts
git commit -m "feat(backtest): metrics with explicit degeneracy handling

Constant predictions, constant actuals and empty sets return a reason rather
than NaN. A NaN reaching a report reads as a number, which is how an early
measurement pass produced a confident wrong answer."
```

---

### Task 9: Backtest runner and report

**Files:**
- Create: `src/lib/backtest/runner.ts`
- Create: `src/lib/backtest/runner.test.ts`
- Create: `scripts/backtest.ts`
- Modify: `package.json` (add `backtest` script)

**Interfaces:**
- Consumes: `loadGameweek`/`RULE_CURRENT_SEASON` (Task 2), `toPanelRows`/`groupByPlayer` (Task 3), `decomposeActualPoints` (Task 4), `buildFeatures`/`MIN_HISTORY_ROUNDS` (Task 5), `scorePlayer` (Task 6), `evaluate`/`calibrationBuckets` (Task 8).
- Produces:
  - `HOLDOUT_ROUNDS: readonly number[]` = `[4, 5, 6, 8, 9, 24, 29, 38]`
  - `fitRounds(): number[]` — 2025-26 rounds 1–38 excluding holdout
  - `interface BacktestReport` — see code
  - `runBacktest(opts: { rounds: number[]; loader: RoundLoader; window?: number }): Promise<BacktestReport>`
  - `type RoundLoader = (round: number) => Promise<Array<Record<string,string>> | null>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/backtest/runner.test.ts`. The loader is injected so the test never touches the network.

```typescript
import { describe, expect, it } from "vitest";

import { HOLDOUT_ROUNDS, fitRounds, runBacktest } from "@/lib/backtest/runner";

function record(round: number, element: number, overrides: Record<string, string> = {}) {
  return {
    name: `P${element}`,
    position: element % 2 === 0 ? "DEF" : "MID",
    element: String(element),
    team: "T",
    round: String(round),
    minutes: "90",
    starts: "1",
    total_points: String(2 + (element % 5)),
    goals_scored: "0",
    assists: "0",
    clean_sheets: "0",
    goals_conceded: "1",
    own_goals: "0",
    penalties_saved: "0",
    penalties_missed: "0",
    yellow_cards: "0",
    red_cards: "0",
    saves: "0",
    bonus: "0",
    bps: String(10 + element),
    expected_goals: String(0.05 * (element % 7)),
    expected_assists: "0.1",
    expected_goals_conceded: "1.1",
    defensive_contribution: String(element % 15),
    was_home: "True",
    opponent_team: "2",
    value: "60",
    xP: String(1 + (element % 4)),
    ...overrides,
  };
}

const loader = async (round: number) =>
  round >= 1 && round <= 12
    ? Array.from({ length: 40 }, (_, i) => record(round, i + 1))
    : null;

describe("split definition", () => {
  it("uses the eight benchmark gameweeks from the spec", () => {
    expect([...HOLDOUT_ROUNDS]).toEqual([4, 5, 6, 8, 9, 24, 29, 38]);
  });

  it("produces a fit set disjoint from the holdout", () => {
    const fit = fitRounds();
    for (const r of HOLDOUT_ROUNDS) expect(fit).not.toContain(r);
  });

  it("excludes rounds 1 to 3 from the holdout, which are feature-poor", () => {
    for (const r of [1, 2, 3]) expect(HOLDOUT_ROUNDS).not.toContain(r);
  });
});

describe("runBacktest", () => {
  it("produces one prediction per evaluated player-round", async () => {
    const report = await runBacktest({ rounds: [8, 9], loader });
    expect(report.predictions.length).toBeGreaterThan(0);
    expect(report.roundsEvaluated).toEqual([8, 9]);
  });

  it("skips rounds the loader cannot supply and records them as gaps", async () => {
    const report = await runBacktest({ rounds: [8, 99], loader });
    expect(report.gaps).toContain(99);
    expect(report.roundsEvaluated).toEqual([8]);
  });

  it("never scores a player with fewer than the minimum prior rounds", async () => {
    const report = await runBacktest({ rounds: [4], loader });
    for (const p of report.predictions) expect(p.sampleRounds).toBeGreaterThanOrEqual(3);
  });

  it("reports our model, FPL's xP and predict-the-mean as separate baselines", async () => {
    const report = await runBacktest({ rounds: [8, 9], loader });
    expect(report.starters.model).toBeDefined();
    expect(report.starters.fplXp).toBeDefined();
    expect(report.starters.mean).toBeDefined();
  });

  it("segments starters separately from all rows", async () => {
    const report = await runBacktest({ rounds: [8, 9], loader });
    expect(report.starters.model.n).toBeLessThanOrEqual(report.all.model.n);
  });

  it("emits calibration buckets", async () => {
    const report = await runBacktest({ rounds: [8, 9], loader });
    expect(report.calibration.length).toBeGreaterThan(0);
  });

  it("throws rather than silently proceeding when no round can be loaded", async () => {
    await expect(runBacktest({ rounds: [99], loader })).rejects.toThrow(/no rounds/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/backtest/runner.test.ts`
Expected: FAIL — cannot resolve `@/lib/backtest/runner`.

- [ ] **Step 3: Implement the runner**

Create `src/lib/backtest/runner.ts`:

```typescript
// Scores a set of held-out gameweeks and compares against three baselines.
//
// Only 2025-26 is used: it is the sole archived season sharing 2026-27's
// scoring rules, so it alone can validate the points mapping.

import { RULE_CURRENT_SEASON } from "@/lib/backtest/corpus";
import { decomposeActualPoints } from "@/lib/backtest/decompose";
import { calibrationBuckets, evaluate, type MetricResult } from "@/lib/backtest/evaluate";
import { groupByPlayer, toPanelRows } from "@/lib/backtest/panel";
import type { PanelRow } from "@/lib/backtest/types";
import { MIN_HISTORY_ROUNDS, buildFeatures } from "@/lib/projections/features";
import { scorePlayer } from "@/lib/projections/scoring";
import type { Position } from "@/lib/types";

/** Gameweeks carrying FPL's xP and at least three prior rounds of history. */
export const HOLDOUT_ROUNDS: readonly number[] = [4, 5, 6, 8, 9, 24, 29, 38];

const SEASON_ROUNDS = Array.from({ length: 38 }, (_, i) => i + 1);

export function fitRounds(): number[] {
  return SEASON_ROUNDS.filter((r) => !HOLDOUT_ROUNDS.includes(r));
}

export type RoundLoader = (round: number) => Promise<Array<Record<string, string>> | null>;

export interface Prediction {
  round: number;
  playerId: number;
  position: Position;
  started: boolean;
  ourXp: number;
  fplXp: number | null;
  actual: number;
  sampleRounds: number;
}

export interface SegmentReport {
  model: MetricResult;
  fplXp: MetricResult;
  mean: MetricResult;
}

export interface BacktestReport {
  season: string;
  roundsRequested: number[];
  roundsEvaluated: number[];
  gaps: number[];
  predictions: Prediction[];
  all: SegmentReport;
  starters: SegmentReport;
  byPosition: Record<string, MetricResult>;
  calibration: ReturnType<typeof calibrationBuckets>;
}

async function loadHistory(
  loader: RoundLoader,
  upToRound: number,
): Promise<Map<number, PanelRow[]>> {
  const rows: PanelRow[] = [];
  for (let r = 1; r < upToRound; r++) {
    const raw = await loader(r);
    if (raw) rows.push(...toPanelRows(raw, RULE_CURRENT_SEASON, r));
  }
  return groupByPlayer(rows);
}

/** Rolling expected goals conceded per 90 for each opponent, prior rounds only. */
function opponentXgc(history: Map<number, PanelRow[]>): Map<number, number> {
  const totals = new Map<number, { xgc: number; minutes: number }>();
  for (const rows of history.values()) {
    for (const row of rows) {
      const t = totals.get(row.opponentTeam) ?? { xgc: 0, minutes: 0 };
      t.xgc += row.expectedGoalsConceded;
      t.minutes += row.minutes;
      totals.set(row.opponentTeam, t);
    }
  }
  const out = new Map<number, number>();
  for (const [team, t] of totals) {
    out.set(team, t.minutes > 0 ? (t.xgc / t.minutes) * 90 : 1.2);
  }
  return out;
}

function segment(rows: Prediction[]): SegmentReport {
  const actual = rows.map((r) => r.actual);
  const meanActual = actual.length ? actual.reduce((s, v) => s + v, 0) / actual.length : 0;
  const withFpl = rows.filter((r) => r.fplXp !== null);
  return {
    model: evaluate(rows.map((r) => r.ourXp), actual),
    fplXp: evaluate(withFpl.map((r) => r.fplXp as number), withFpl.map((r) => r.actual)),
    // Predict-the-mean has zero variance, so evaluate() reports it as degenerate
    // by design. RMSE against it is reported through the report's own summary.
    mean: evaluate(actual.map(() => meanActual), actual),
  };
}

export async function runBacktest(opts: {
  rounds: number[];
  loader: RoundLoader;
  window?: number;
}): Promise<BacktestReport> {
  const predictions: Prediction[] = [];
  const evaluated: number[] = [];
  const gaps: number[] = [];

  for (const round of opts.rounds) {
    const raw = await opts.loader(round);
    if (!raw) {
      gaps.push(round);
      continue;
    }
    evaluated.push(round);

    const history = await loadHistory(opts.loader, round);
    const xgc = opponentXgc(history);
    const actualRows = toPanelRows(raw, RULE_CURRENT_SEASON, round);

    for (const actualRow of actualRows) {
      const prior = (history.get(actualRow.playerId) ?? []).filter((r) => r.round < round);
      if (prior.length < MIN_HISTORY_ROUNDS) continue;

      const features = buildFeatures(prior, round, {
        fdr: 3,
        isHome: actualRow.wasHome,
        fixtureCount: 1,
        opponentXgcPer90: xgc.get(actualRow.opponentTeam) ?? 1.2,
      }, { window: opts.window });

      predictions.push({
        round,
        playerId: actualRow.playerId,
        position: actualRow.position,
        started: actualRow.starts > 0,
        ourXp: scorePlayer(features).xPoints,
        fplXp: actualRow.fplXp,
        actual: decomposeActualPoints(actualRow).total,
        sampleRounds: features.sampleRounds,
      });
    }
  }

  if (evaluated.length === 0) {
    throw new Error(`backtest: no rounds could be loaded from ${opts.rounds.join(", ")}`);
  }

  const starters = predictions.filter((p) => p.started);
  const byPosition: Record<string, MetricResult> = {};
  for (const pos of ["GKP", "DEF", "MID", "FWD"] as const) {
    const subset = starters.filter((p) => p.position === pos);
    byPosition[pos] = evaluate(subset.map((p) => p.ourXp), subset.map((p) => p.actual));
  }

  return {
    season: RULE_CURRENT_SEASON,
    roundsRequested: opts.rounds,
    roundsEvaluated: evaluated,
    gaps,
    predictions,
    all: segment(predictions),
    starters: segment(starters),
    byPosition,
    calibration: calibrationBuckets(
      starters.map((p) => p.ourXp),
      starters.map((p) => p.actual),
      10,
    ),
  };
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/backtest/runner.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Create the CLI script**

Create `scripts/backtest.ts`:

```typescript
// Usage: npm run backtest
//
// Downloads (and caches) the 2025-26 gameweek corpus, scores the held-out
// benchmark rounds, and writes .backtest/report.json plus a human summary.

import { mkdirSync, writeFileSync } from "node:fs";

import { RULE_CURRENT_SEASON, loadGameweek } from "../src/lib/backtest/corpus";
import { HOLDOUT_ROUNDS, runBacktest } from "../src/lib/backtest/runner";
import type { MetricResult } from "../src/lib/backtest/evaluate";

const BAR = { rmse: 2.691, spearman: 0.507 };

function line(label: string, m: MetricResult): string {
  if (!m.ok) return `${label.padEnd(22)} n=${String(m.n).padStart(6)}  (${m.reason})`;
  return (
    `${label.padEnd(22)} n=${String(m.n).padStart(6)}  ` +
    `RMSE=${m.rmse.toFixed(3)}  MAE=${m.mae.toFixed(3)}  rho=${m.spearman.toFixed(3)}`
  );
}

async function main(): Promise<void> {
  const report = await runBacktest({
    rounds: [...HOLDOUT_ROUNDS],
    loader: (round) => loadGameweek(RULE_CURRENT_SEASON, round),
  });

  const out: string[] = [];
  out.push(`season ${report.season}  rounds ${report.roundsEvaluated.join(",")}`);
  if (report.gaps.length) out.push(`gaps (not published): ${report.gaps.join(",")}`);
  out.push("");
  out.push("STARTERS (the decision-relevant segment)");
  out.push("  " + line("our model", report.starters.model));
  out.push("  " + line("FPL xP (the bar)", report.starters.fplXp));
  out.push("");
  out.push("ALL ROWS");
  out.push("  " + line("our model", report.all.model));
  out.push("  " + line("FPL xP", report.all.fplXp));
  out.push("");
  out.push("BY POSITION (starters, our model)");
  for (const [pos, m] of Object.entries(report.byPosition)) out.push("  " + line(pos, m));
  out.push("");

  const m = report.starters.model;
  const passes = m.ok && m.rmse < BAR.rmse && m.spearman > BAR.spearman;
  out.push(
    `SHIP GATE: ${passes ? "PASS" : "FAIL"}  ` +
      `(need RMSE < ${BAR.rmse} and rho > ${BAR.spearman} on starters)`,
  );

  mkdirSync(".backtest", { recursive: true });
  writeFileSync(".backtest/report.json", JSON.stringify(report, null, 2));
  writeFileSync(".backtest/report.txt", out.join("\n") + "\n");
  process.stdout.write(out.join("\n") + "\n");
  process.stdout.write("\nwrote .backtest/report.json and .backtest/report.txt\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`backtest failed: ${String(error)}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Write the reproducibility manifest**

`buildManifest` exists but nothing calls it, so `npm run backtest` could not yet be
shown to reproduce a previous run. Add to `scripts/backtest.ts`:

```typescript
import { readFileSync, readdirSync } from "node:fs";

import { buildManifest, sha256, type ManifestEntry } from "../src/lib/backtest/corpus";
```

and insert before `mkdirSync(".backtest", { recursive: true });`:

```typescript
  const cacheDir = `.backtest/${RULE_CURRENT_SEASON}`;
  const entries: ManifestEntry[] = readdirSync(cacheDir)
    .filter((f) => f.endsWith(".csv"))
    .map((file) => {
      const text = readFileSync(`${cacheDir}/${file}`, "utf8");
      const rows = text.trim().split("\n");
      return {
        season: RULE_CURRENT_SEASON,
        round: Number(file.replace(/^gw|\.csv$/g, "")),
        rows: rows.length - 1,
        sha256: sha256(text),
        hasXp: rows.slice(1).some((line) => {
          const cols = rows[0].split(",");
          const idx = cols.indexOf("xP");
          return idx >= 0 && Number(line.split(",")[idx]) !== 0;
        }),
      };
    });
  writeFileSync("docs/backtest-manifest.json", buildManifest(entries));
```

Commit `docs/backtest-manifest.json` — it is the record that lets a later run be
checked against this one.

- [ ] **Step 7: Add the npm script**

Add to `scripts` in `package.json`:

```json
"backtest": "node --experimental-strip-types scripts/backtest.ts"
```

- [ ] **Step 8: Run the real backtest**

Run: `npm run backtest`
Expected: downloads the corpus (first run takes a minute), prints the starters table and a `SHIP GATE: PASS` or `FAIL` line. **Record the actual numbers — Task 10 tunes against them.** A `FAIL` here is an acceptable outcome at this point; it is information, not a blocker.

- [ ] **Step 9: Commit**

```bash
git add src/lib/backtest/runner.ts src/lib/backtest/runner.test.ts scripts/backtest.ts package.json docs/backtest-manifest.json
git commit -m "feat(backtest): runner, CLI and ship-gate report

Scores the eight held-out 2025-26 gameweeks against three baselines and prints
whether the model clears FPL's own xP on starters."
```

---

### Task 10: Variance from residuals — defect 5

**Files:**
- Create: `src/lib/projections/variance.ts`
- Create: `src/lib/projections/variance.test.ts`
- Modify: `scripts/backtest.ts` (emit the fitted table)

**Interfaces:**
- Consumes: `Prediction` from Task 9, `Position` from `@/lib/types`.
- Produces:
  - `interface VarianceTable { byPosition: Record<Position, number[]>; buckets: number[] }`
  - `fitVariance(predictions: Array<{ position: Position; ourXp: number; actual: number }>): VarianceTable`
  - `estimateVariance(position: Position, xPoints: number, table?: VarianceTable): number`
  - `FITTED_VARIANCE: VarianceTable` — the committed table

- [ ] **Step 1: Write the failing test**

Create `src/lib/projections/variance.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import type { Position } from "@/lib/types";
import { estimateVariance, fitVariance } from "@/lib/projections/variance";

function sample(position: Position, ourXp: number, actual: number) {
  return { position, ourXp, actual };
}

describe("regression: variance is derived from residuals, not constants", () => {
  it("gives a larger variance to a population with larger residuals", () => {
    const tight = fitVariance(
      Array.from({ length: 200 }, (_, i) => sample("MID", 4, 4 + (i % 2 === 0 ? 0.5 : -0.5))),
    );
    const loose = fitVariance(
      Array.from({ length: 200 }, (_, i) => sample("MID", 4, 4 + (i % 2 === 0 ? 8 : -8))),
    );
    expect(estimateVariance("MID", 4, loose)).toBeGreaterThan(estimateVariance("MID", 4, tight));
  });

  it("produces different variances for different positions from the same data", () => {
    const table = fitVariance([
      ...Array.from({ length: 100 }, (_, i) => sample("DEF", 3, 3 + (i % 2 ? 0.4 : -0.4))),
      ...Array.from({ length: 100 }, (_, i) => sample("FWD", 3, 3 + (i % 2 ? 6 : -6))),
    ]);
    expect(estimateVariance("FWD", 3, table)).toBeGreaterThan(estimateVariance("DEF", 3, table));
  });

  it("is not a fixed positional constant scaled by xPoints", () => {
    const table = fitVariance([
      ...Array.from({ length: 100 }, (_, i) => sample("MID", 1, 1 + (i % 2 ? 0.2 : -0.2))),
      ...Array.from({ length: 100 }, (_, i) => sample("MID", 9, 9 + (i % 2 ? 7 : -7))),
    ]);
    const lowRatio = estimateVariance("MID", 1, table) / 1;
    const highRatio = estimateVariance("MID", 9, table) / 9;
    expect(Math.abs(highRatio - lowRatio)).toBeGreaterThan(0.01);
  });
});

describe("estimateVariance", () => {
  it("is always strictly positive so the Monte Carlo never degenerates", () => {
    const table = fitVariance([sample("MID", 0, 0)]);
    expect(estimateVariance("MID", 0, table)).toBeGreaterThan(0);
  });

  it("falls back to the committed table when none is supplied", () => {
    expect(estimateVariance("MID", 5)).toBeGreaterThan(0);
  });

  it("never returns NaN for an out-of-range xPoints", () => {
    expect(Number.isNaN(estimateVariance("MID", 999))).toBe(false);
    expect(Number.isNaN(estimateVariance("MID", -5))).toBe(false);
  });
});

describe("fitVariance", () => {
  it("returns a bucket edge list and a per-position array of equal length", () => {
    const table = fitVariance([sample("MID", 2, 3), sample("DEF", 4, 4)]);
    expect(table.byPosition.MID).toHaveLength(table.buckets.length);
    expect(table.byPosition.DEF).toHaveLength(table.buckets.length);
  });

  it("handles an empty sample without producing NaN", () => {
    const table = fitVariance([]);
    expect(Number.isNaN(estimateVariance("MID", 3, table))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/projections/variance.test.ts`
Expected: FAIL — cannot resolve `@/lib/projections/variance`.

- [ ] **Step 3: Implement variance fitting**

Create `src/lib/projections/variance.ts`:

```typescript
// Variance for the overtake Monte Carlo, fitted from historical residuals.
//
// Previously this was a hand-picked positional constant scaled by xPoints,
// which meant the published overtake percentage rested on an invented spread.
// Here it is the observed mean squared residual, bucketed by predicted points
// so that high-scoring predictions carry their genuinely wider spread.

import type { Position } from "@/lib/types";

/** Upper edges of the predicted-points buckets. */
const BUCKET_EDGES = [1, 2, 3, 4, 5, 6, 8, 10, Infinity];

const POSITIONS: readonly Position[] = ["GKP", "DEF", "MID", "FWD"];

/** Floor so the Monte Carlo never samples from a degenerate distribution. */
const MIN_VARIANCE = 0.25;

export interface VarianceTable {
  buckets: number[];
  byPosition: Record<Position, number[]>;
}

function bucketIndex(xPoints: number): number {
  const x = Number.isFinite(xPoints) ? Math.max(0, xPoints) : 0;
  const i = BUCKET_EDGES.findIndex((edge) => x < edge);
  return i === -1 ? BUCKET_EDGES.length - 1 : i;
}

export function fitVariance(
  predictions: Array<{ position: Position; ourXp: number; actual: number }>,
): VarianceTable {
  const sums: Record<Position, number[]> = {
    GKP: BUCKET_EDGES.map(() => 0),
    DEF: BUCKET_EDGES.map(() => 0),
    MID: BUCKET_EDGES.map(() => 0),
    FWD: BUCKET_EDGES.map(() => 0),
  };
  const counts: Record<Position, number[]> = {
    GKP: BUCKET_EDGES.map(() => 0),
    DEF: BUCKET_EDGES.map(() => 0),
    MID: BUCKET_EDGES.map(() => 0),
    FWD: BUCKET_EDGES.map(() => 0),
  };

  for (const p of predictions) {
    const i = bucketIndex(p.ourXp);
    sums[p.position][i] += (p.actual - p.ourXp) ** 2;
    counts[p.position][i] += 1;
  }

  const byPosition = {} as Record<Position, number[]>;
  for (const pos of POSITIONS) {
    byPosition[pos] = sums[pos].map((sum, i) =>
      counts[pos][i] > 0 ? Math.max(MIN_VARIANCE, sum / counts[pos][i]) : MIN_VARIANCE,
    );
  }

  return { buckets: [...BUCKET_EDGES], byPosition };
}

/**
 * Committed table. Regenerate with `npm run backtest` and paste the
 * `fittedVariance` block from .backtest/report.json. Do not hand-adjust.
 */
export const FITTED_VARIANCE: VarianceTable = {
  buckets: [...BUCKET_EDGES],
  byPosition: {
    GKP: [1.6, 2.4, 3.2, 4.4, 5.6, 7.0, 9.0, 11.0, 13.0],
    DEF: [1.8, 2.8, 3.8, 5.2, 6.6, 8.4, 10.6, 13.0, 15.0],
    MID: [2.0, 3.0, 4.2, 5.8, 7.4, 9.4, 12.0, 15.0, 18.0],
    FWD: [2.2, 3.4, 4.8, 6.6, 8.4, 10.8, 13.8, 17.0, 20.0],
  },
};

export function estimateVariance(
  position: Position,
  xPoints: number,
  table: VarianceTable = FITTED_VARIANCE,
): number {
  const row = table.byPosition[position] ?? FITTED_VARIANCE.byPosition[position];
  const value = row[bucketIndex(xPoints)];
  return Number.isFinite(value) && value > 0 ? value : MIN_VARIANCE;
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/projections/variance.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Emit the fitted table from the runner**

In `scripts/backtest.ts`, add the import:

```typescript
import { fitVariance } from "../src/lib/projections/variance";
```

and immediately before `mkdirSync(".backtest", { recursive: true });` insert:

```typescript
  const fittedVariance = fitVariance(
    report.predictions.map((p) => ({ position: p.position, ourXp: p.ourXp, actual: p.actual })),
  );
  const enriched = { ...report, fittedVariance };
```

then change the report write to use `enriched`:

```typescript
  writeFileSync(".backtest/report.json", JSON.stringify(enriched, null, 2));
```

- [ ] **Step 6: Report Monte-Carlo interval coverage**

`intervalCoverage` exists but nothing calls it, so the spec's coverage criterion
("80% intervals contain the truth 78–82% of the time") could not be checked. Now that
a fitted variance table exists, wire it in.

In `scripts/backtest.ts`, extend the evaluate import:

```typescript
import { intervalCoverage, type MetricResult } from "../src/lib/backtest/evaluate";
import { estimateVariance, fitVariance } from "../src/lib/projections/variance";
```

and immediately after the `fittedVariance` assignment:

```typescript
  const starters = report.predictions.filter((p) => p.started);
  const coverage80 = intervalCoverage(
    starters.map((p) => p.ourXp),
    starters.map((p) => Math.sqrt(estimateVariance(p.position, p.ourXp, fittedVariance))),
    starters.map((p) => p.actual),
  );
  const enriched = { ...report, fittedVariance, coverage80 };
```

(replacing the `const enriched = ...` line added in Step 5), and add to the printed
summary just above the SHIP GATE line:

```typescript
  out.push(
    `80% interval coverage (starters): ${(coverage80 * 100).toFixed(1)}%  ` +
      `(target 78-82%)`,
  );
```

- [ ] **Step 7: Regenerate and paste the fitted table**

Run: `npm run backtest`

Open `.backtest/report.json`, copy the `fittedVariance.byPosition` object, and replace the placeholder values in `FITTED_VARIANCE` in `src/lib/projections/variance.ts` with the real fitted numbers. Re-run `npx vitest run` to confirm nothing broke.

- [ ] **Step 8: Commit**

```bash
git add src/lib/projections/variance.ts src/lib/projections/variance.test.ts scripts/backtest.ts
git commit -m "feat(projections): fit Monte-Carlo variance from residuals

The published overtake probability previously rested on a hand-picked
positional constant. It now uses the observed mean squared residual, bucketed
by predicted points."
```

---

### Task 11: Route the live app through the shared scorer

**Files:**
- Create: `src/lib/projections/live-features.ts`
- Create: `src/lib/projections/live-features.test.ts`
- Modify: `src/lib/projections/model.ts`
- Modify: `src/lib/projections/model.test.ts` (create if absent)

**Interfaces:**
- Consumes: `buildFeatures`/`PlayerFeatures`/`FixtureContext` (Task 5), `scorePlayer` (Task 6), `estimateVariance` (Task 10).
- Produces:
  - `liveFeatures(args: { player: FplElement; team: FplTeam; position: Position; fixtures: FplFixture[]; gw: number }): PlayerFeatures`
  - `projectPlayer` and `projectSquad` keep their existing signatures and return types.

**This is the task that makes the backtest meaningful** — until now the app still scores through the old code, so the harness would be validating something that does not ship. `PlayerProjection`'s field names and types must not change; six files depend on them.

- [ ] **Step 1: Write the failing test**

Create `src/lib/projections/live-features.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import type { FplElement, FplFixture, FplTeam } from "@/lib/types";
import { fixtureContextFor, liveFeatures } from "@/lib/projections/live-features";

function element(overrides: Partial<FplElement> = {}): FplElement {
  return {
    id: 1,
    web_name: "Test",
    element_type: 3,
    team: 1,
    chance_of_playing_next_round: null,
    form: "5.0",
    expected_goals_per_90: 0.4,
    expected_assists_per_90: 0.2,
    starts_per_90: 1,
    ict_index: "120.0",
    ...(overrides as object),
  } as FplElement;
}

const team = { id: 1, name: "T", short_name: "T" } as FplTeam;

function fixture(overrides: Partial<FplFixture> = {}): FplFixture {
  return {
    id: 1,
    event: 10,
    team_h: 1,
    team_a: 2,
    team_h_difficulty: 2,
    team_a_difficulty: 4,
    finished: false,
    ...(overrides as object),
  } as FplFixture;
}

describe("fixtureContextFor", () => {
  it("reports a blank gameweek as zero fixtures", () => {
    const ctx = fixtureContextFor([], 1, 10);
    expect(ctx.fixtureCount).toBe(0);
  });

  it("counts a double gameweek", () => {
    const ctx = fixtureContextFor([fixture(), fixture({ id: 2, team_a: 1, team_h: 3 })], 1, 10);
    expect(ctx.fixtureCount).toBe(2);
  });

  it("detects home versus away correctly", () => {
    expect(fixtureContextFor([fixture()], 1, 10).isHome).toBe(true);
    expect(fixtureContextFor([fixture()], 2, 10).isHome).toBe(false);
  });

  it("reads the difficulty from the correct side", () => {
    expect(fixtureContextFor([fixture()], 1, 10).fdr).toBe(2);
    expect(fixtureContextFor([fixture()], 2, 10).fdr).toBe(4);
  });
});

describe("liveFeatures", () => {
  it("treats a null chance_of_playing as fully available", () => {
    const f = liveFeatures({ player: element(), team, position: "MID", fixtures: [fixture()], gw: 10 });
    expect(f.availability).toBe(1);
  });

  it("converts a percentage chance_of_playing into a 0..1 availability", () => {
    const f = liveFeatures({
      player: element({ chance_of_playing_next_round: 50 }),
      team,
      position: "MID",
      fixtures: [fixture()],
      gw: 10,
    });
    expect(f.availability).toBeCloseTo(0.5, 5);
  });

  it("carries the live per-90 rates into the shared feature shape", () => {
    const f = liveFeatures({ player: element(), team, position: "MID", fixtures: [fixture()], gw: 10 });
    expect(f.xg90).toBeCloseTo(0.4, 5);
    expect(f.xa90).toBeCloseTo(0.2, 5);
  });

  it("never produces NaN from missing live fields", () => {
    const f = liveFeatures({
      player: element({ expected_goals_per_90: undefined as never, starts_per_90: undefined as never }),
      team,
      position: "MID",
      fixtures: [fixture()],
      gw: 10,
    });
    expect(Number.isNaN(f.xg90)).toBe(false);
    expect(Number.isNaN(f.startRate)).toBe(false);
  });
});
```

Create `src/lib/projections/model.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import type { FplBootstrap, FplElement, FplFixture, FplTeam } from "@/lib/types";
import { projectPlayer } from "@/lib/projections/model";

function element(overrides: Partial<FplElement> = {}): FplElement {
  return {
    id: 1,
    web_name: "Test",
    element_type: 3,
    team: 1,
    chance_of_playing_next_round: null,
    status: "a",
    news: "",
    form: "5.0",
    expected_goals_per_90: 0.4,
    expected_assists_per_90: 0.2,
    starts_per_90: 1,
    ict_index: "120.0",
    ...(overrides as object),
  } as FplElement;
}

const team = { id: 1, name: "T", short_name: "T" } as FplTeam;
const bs = { elements: [], teams: [], events: [], element_types: [] } as unknown as FplBootstrap;
const fixtures = [
  { id: 1, event: 10, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 4, finished: false },
] as unknown as FplFixture[];

describe("projectPlayer public contract", () => {
  it("returns every field consumers depend on", () => {
    const p = projectPlayer({ player: element(), team, position: "MID", fixtures, gw: 10, bs });
    expect(Object.keys(p).sort()).toEqual(
      ["fixtureDifficulty", "injuryRisk", "notes", "playerId", "position", "variance", "webName", "xPoints"].sort(),
    );
  });

  it("keeps xPoints a finite non-negative number", () => {
    const p = projectPlayer({ player: element(), team, position: "MID", fixtures, gw: 10, bs });
    expect(Number.isFinite(p.xPoints)).toBe(true);
    expect(p.xPoints).toBeGreaterThanOrEqual(0);
  });

  it("reports injuryRisk as 1 minus availability", () => {
    const p = projectPlayer({
      player: element({ chance_of_playing_next_round: 25 }),
      team, position: "MID", fixtures, gw: 10, bs,
    });
    expect(p.injuryRisk).toBeCloseTo(0.75, 5);
  });

  it("notes a blank gameweek", () => {
    const p = projectPlayer({ player: element(), team, position: "MID", fixtures: [], gw: 10, bs });
    expect(p.notes.join(" ")).toMatch(/blank/i);
    expect(p.xPoints).toBe(0);
  });

  it("notes an availability doubt", () => {
    const p = projectPlayer({
      player: element({ chance_of_playing_next_round: 50, news: "Knock" }),
      team, position: "MID", fixtures, gw: 10, bs,
    });
    expect(p.notes.join(" ")).toMatch(/50%/);
  });

  it("uses the residual-fitted variance rather than a positional constant", () => {
    const p = projectPlayer({ player: element(), team, position: "MID", fixtures, gw: 10, bs });
    expect(p.variance).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/projections/live-features.test.ts src/lib/projections/model.test.ts`
Expected: FAIL — cannot resolve `@/lib/projections/live-features`.

- [ ] **Step 3: Implement the live feature adapter**

Create `src/lib/projections/live-features.ts`:

```typescript
// Adapts the live FPL bootstrap into the same PlayerFeatures shape the backtest
// builds from history, so both paths score through scorePlayer.
//
// Bootstrap exposes per-90 rates directly, so no rolling window is needed here.
// bps90 and dcPer90 are not available per-90 from bootstrap; they are derived
// from the season aggregates that are, and fall back to position medians.

import type { FplElement, FplFixture, FplTeam, Position } from "@/lib/types";
import type { FixtureContext, PlayerFeatures } from "@/lib/projections/features";

/** Median BPS per 90 by position, used when a player has no usable history. */
const DEFAULT_BPS90: Record<Position, number> = { GKP: 18, DEF: 16, MID: 14, FWD: 14 };
/** Median defensive-contribution count per 90 by position. */
const DEFAULT_DC90: Record<Position, number> = { GKP: 0, DEF: 6, MID: 5, FWD: 2 };
/** League-average expected goals conceded per 90, used when unknown. */
const LEAGUE_XGC90 = 1.35;

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function fixtureContextFor(
  fixtures: FplFixture[],
  teamId: number,
  gw: number,
): FixtureContext {
  const matching = fixtures.filter(
    (f) => f.event === gw && (f.team_h === teamId || f.team_a === teamId),
  );
  if (matching.length === 0) {
    return { fdr: 3, isHome: true, fixtureCount: 0, opponentXgcPer90: LEAGUE_XGC90 };
  }

  const isHome = matching[0].team_h === teamId;
  const fdr =
    matching.reduce(
      (sum, f) => sum + (f.team_h === teamId ? f.team_h_difficulty : f.team_a_difficulty),
      0,
    ) / matching.length;

  // FDR 1 (easiest opponent) implies a weak attack, so a low expected goals
  // conceded for us. This is the single place fixture difficulty enters.
  const opponentXgcPer90 = LEAGUE_XGC90 * (0.55 + 0.225 * (fdr - 1));

  return { fdr, isHome, fixtureCount: matching.length, opponentXgcPer90 };
}

export function liveFeatures(args: {
  player: FplElement;
  team: FplTeam;
  position: Position;
  fixtures: FplFixture[];
  gw: number;
}): PlayerFeatures {
  const { player, team, position, fixtures, gw } = args;
  const chance = player.chance_of_playing_next_round;
  const availability = chance === null || chance === undefined ? 1 : Math.max(0, Math.min(1, chance / 100));
  const startRate = Math.max(0, Math.min(1, num(player.starts_per_90, 1)));

  return {
    playerId: player.id,
    webName: player.web_name,
    position,
    xg90: num(player.expected_goals_per_90),
    xa90: num(player.expected_assists_per_90),
    bps90: DEFAULT_BPS90[position],
    dcPer90: DEFAULT_DC90[position],
    startRate,
    minutesPerStart: startRate > 0 ? 90 : 0,
    availability,
    ...fixtureContextFor(fixtures, team.id, gw),
    sampleRounds: 0,
  };
}
```

- [ ] **Step 4: Rewrite `projectPlayer` to delegate**

Replace the body of `projectPlayer` in `src/lib/projections/model.ts` (currently lines 116–186) with the version below, and add the imports. Keep `projectSquad` exactly as it is — it consumes `PlayerProjection`, which is unchanged. Delete the now-unused helpers `minutesProbability`, `expectedMinutes`, `teamCleanSheetProb`, `fdrAttackMultiplier`, `bonusExpectation`, `formBoost`, `fixtureForTeam`, and the `GOAL_PTS`/`CS_PTS`/`BASE_APPEARANCE_PTS`/`FDR_NEUTRAL`/`numeric`/`clampUnit` constants.

New imports at the top of `model.ts`:

```typescript
import { liveFeatures } from "@/lib/projections/live-features";
import { scorePlayer } from "@/lib/projections/scoring";
import { estimateVariance } from "@/lib/projections/variance";
```

New `projectPlayer`:

```typescript
export function projectPlayer(args: ProjectPlayerArgs): PlayerProjection {
  const { player, team, position, fixtures, gw } = args;
  const features = liveFeatures({ player, team, position, fixtures, gw });
  const scored = scorePlayer(features);

  const notes: string[] = [];
  if (features.fixtureCount === 0) notes.push("Blank gameweek — no fixture");
  if (features.fixtureCount > 1) notes.push(`Double gameweek (${features.fixtureCount} matches)`);
  if (features.fdr <= 2) notes.push(features.isHome ? "Favourable home fixture" : "Favourable away fixture");
  if (features.fdr >= 4) notes.push(features.isHome ? "Tough home fixture" : "Tough away fixture");

  const chance = player.chance_of_playing_next_round;
  if (chance !== null && chance !== undefined && chance < 100) {
    notes.push(`Availability: ${chance}%${player.news ? ` — ${player.news}` : ""}`);
  } else if (player.status !== "a") {
    notes.push(`Status: ${player.status}${player.news ? ` — ${player.news}` : ""}`);
  }
  if (scored.components.defensiveContribution >= 0.5) {
    notes.push("Regular defensive-contribution threat");
  }

  return {
    playerId: player.id,
    webName: player.web_name,
    position,
    xPoints: Number(scored.xPoints.toFixed(2)),
    variance: Number(estimateVariance(position, scored.xPoints).toFixed(2)),
    injuryRisk: Number((1 - features.availability).toFixed(2)),
    fixtureDifficulty: Number(features.fdr.toFixed(1)),
    notes,
  };
}
```

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Verify nothing downstream broke**

Run: `npx tsc --noEmit`
Expected: exit 0. If it reports unused-import or missing-symbol errors in `model.ts`, remove the leftover helpers listed in Step 4.

- [ ] **Step 7: Smoke-test the real app**

Run: `npm run dev`, then in a second shell:

```bash
curl -s "http://localhost:3000/api/projections?teamId=4778037&leagueId=218144" | head -c 400
```

Expected: HTTP 200 JSON containing a `projections` key. Confirm `xPoints` values are plausible (roughly 0–12 for a starter) and not all zero.

- [ ] **Step 8: Commit**

```bash
git add src/lib/projections/live-features.ts src/lib/projections/live-features.test.ts src/lib/projections/model.ts src/lib/projections/model.test.ts
git commit -m "refactor(projections): score the live app through the shared model

Until now the app scored through the old code path, so the backtest validated
something that did not ship. projectPlayer now builds PlayerFeatures and calls
scorePlayer, keeping the PlayerProjection interface its six consumers depend on
byte-for-byte identical."
```

---

### Task 12: Ship gate, model report endpoint and calibration panel

**Files:**
- Create: `src/lib/projections/model-report.ts`
- Create: `src/lib/projections/model-report.test.ts`
- Create: `src/app/api/model-report/route.ts`
- Create: `src/components/ModelCalibrationPanel.tsx`
- Create: `docs/model-report.json` (committed evaluation summary)
- Modify: `src/components/Dashboard.tsx` (render the panel inside the existing "Past gameweeks" details block)

**Interfaces:**
- Consumes: `BacktestReport` shape from Task 9.
- Produces:
  - `interface ModelReport { generatedAt: string; season: string; rounds: number[]; starters: { model: { rmse: number; mae: number; spearman: number; n: number }; fplXp: { rmse: number; mae: number; spearman: number; n: number } }; shipGate: { passes: boolean; rmseBar: number; spearmanBar: number }; calibration: Array<{ meanPredicted: number; meanActual: number; n: number }> }`
  - `evaluateShipGate(starters: { rmse: number; spearman: number }): { passes: boolean; rmseBar: number; spearmanBar: number }`
  - `SHIP_GATE_BAR = { rmse: 2.691, spearman: 0.507 }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/projections/model-report.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { SHIP_GATE_BAR, evaluateShipGate } from "@/lib/projections/model-report";

describe("SHIP_GATE_BAR", () => {
  it("is FPL's own xP performance on 2025-26 starters", () => {
    expect(SHIP_GATE_BAR.rmse).toBeCloseTo(2.691, 3);
    expect(SHIP_GATE_BAR.spearman).toBeCloseTo(0.507, 3);
  });
});

describe("evaluateShipGate", () => {
  it("passes only when both RMSE and Spearman beat the bar", () => {
    expect(evaluateShipGate({ rmse: 2.5, spearman: 0.55 }).passes).toBe(true);
  });

  it("fails when RMSE is worse even if the ranking is better", () => {
    expect(evaluateShipGate({ rmse: 2.9, spearman: 0.60 }).passes).toBe(false);
  });

  it("fails when ranking is worse even if RMSE is better", () => {
    expect(evaluateShipGate({ rmse: 2.4, spearman: 0.40 }).passes).toBe(false);
  });

  it("fails on an exact tie, since a tie is not an improvement", () => {
    expect(evaluateShipGate({ rmse: 2.691, spearman: 0.507 }).passes).toBe(false);
  });

  it("reports the bars it applied so a reader can check the claim", () => {
    const g = evaluateShipGate({ rmse: 2.5, spearman: 0.55 });
    expect(g.rmseBar).toBeCloseTo(2.691, 3);
    expect(g.spearmanBar).toBeCloseTo(0.507, 3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/projections/model-report.test.ts`
Expected: FAIL — cannot resolve `@/lib/projections/model-report`.

- [ ] **Step 3: Implement the ship gate**

Create `src/lib/projections/model-report.ts`:

```typescript
// The ship gate. We publish our own expected points only when they beat FPL's,
// which every manager already gets for nothing. A tie is not an improvement.
//
// The bar is FPL's xP measured on 2025-26 starters — the most recent season
// under the current scoring rules.

export const SHIP_GATE_BAR = { rmse: 2.691, spearman: 0.507 } as const;

export interface ShipGate {
  passes: boolean;
  rmseBar: number;
  spearmanBar: number;
}

export function evaluateShipGate(starters: { rmse: number; spearman: number }): ShipGate {
  return {
    passes: starters.rmse < SHIP_GATE_BAR.rmse && starters.spearman > SHIP_GATE_BAR.spearman,
    rmseBar: SHIP_GATE_BAR.rmse,
    spearmanBar: SHIP_GATE_BAR.spearman,
  };
}

export interface MetricSummary {
  rmse: number;
  mae: number;
  spearman: number;
  n: number;
}

export interface ModelReport {
  generatedAt: string;
  season: string;
  rounds: number[];
  starters: { model: MetricSummary; fplXp: MetricSummary };
  shipGate: ShipGate;
  calibration: Array<{ meanPredicted: number; meanActual: number; n: number }>;
}
```

- [ ] **Step 4: Generate and commit the report summary**

Run: `npm run backtest`

Then create `docs/model-report.json` by hand from `.backtest/report.json`, in the `ModelReport` shape. Use the real numbers the backtest printed — do not invent them. Example shape (replace every value):

```json
{
  "generatedAt": "2026-08-28T00:00:00.000Z",
  "season": "2025-26",
  "rounds": [4, 5, 6, 8, 9, 24, 29, 38],
  "starters": {
    "model": { "rmse": 0, "mae": 0, "spearman": 0, "n": 0 },
    "fplXp": { "rmse": 0, "mae": 0, "spearman": 0, "n": 0 }
  },
  "shipGate": { "passes": false, "rmseBar": 2.691, "spearmanBar": 0.507 },
  "calibration": []
}
```

- [ ] **Step 5: Create the API route**

Create `src/app/api/model-report/route.ts`:

```typescript
import { NextResponse } from "next/server";

import report from "@/../docs/model-report.json";
import type { ModelReport } from "@/lib/projections/model-report";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json(report as ModelReport, {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
```

- [ ] **Step 6: Create the calibration panel**

Create `src/components/ModelCalibrationPanel.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";

import type { ModelReport } from "@/lib/projections/model-report";

async function fetchReport(): Promise<ModelReport> {
  const res = await fetch("/api/model-report");
  if (!res.ok) throw new Error(`model report unavailable (${res.status})`);
  return (await res.json()) as ModelReport;
}

export function ModelCalibrationPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["model-report"],
    queryFn: fetchReport,
    staleTime: 60 * 60 * 1000,
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading model report…</div>;
  if (isError || !data) return null;

  const { starters, shipGate } = data;

  return (
    <section className="space-y-3 rounded-lg border bg-card/40 p-4">
      <header className="space-y-1">
        <h3 className="font-display text-sm font-bold uppercase tracking-tight">How accurate are these numbers?</h3>
        <p className="text-xs text-muted-foreground">
          Measured on {starters.model.n.toLocaleString()} players who started across{" "}
          {data.rounds.length} held-out gameweeks in {data.season}.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Our model</dt>
          <dd className="font-mono">
            RMSE {starters.model.rmse.toFixed(2)} · ρ {starters.model.spearman.toFixed(3)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">FPL&apos;s own xP</dt>
          <dd className="font-mono">
            RMSE {starters.fplXp.rmse.toFixed(2)} · ρ {starters.fplXp.spearman.toFixed(3)}
          </dd>
        </div>
      </dl>

      {!shipGate.passes && (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          Our model does not yet beat FPL&apos;s own expected points on this holdout, so treat
          the projections as directional rather than decisive.
        </p>
      )}

      {data.calibration.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs uppercase text-muted-foreground">Predicted vs actual</h4>
          <ul className="space-y-0.5 font-mono text-xs">
            {data.calibration
              .filter((b) => b.n > 0)
              .map((b) => (
                <li key={b.meanPredicted} className="flex justify-between">
                  <span>we said {b.meanPredicted.toFixed(1)}</span>
                  <span className="text-muted-foreground">
                    they scored {b.meanActual.toFixed(1)} (n={b.n})
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Mount the panel**

In `src/components/Dashboard.tsx`, add the import alongside the other component imports:

```typescript
import { ModelCalibrationPanel } from "@/components/ModelCalibrationPanel";
```

Then, inside the `<details>` block in the `squad` tab, add the panel directly above `<RetrospectivePanel ... />`:

```tsx
              <ModelCalibrationPanel />
```

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, tsc exits 0.

- [ ] **Step 9: Check coverage meets the threshold**

Run: `npx vitest run --coverage`
Expected: `src/lib/backtest/**` and `src/lib/projections/**` each at or above 80% lines. If short, add tests for the uncovered branches the report names — do not lower the threshold.

- [ ] **Step 10: Verify in the running app**

Run: `npm run dev`, open `http://localhost:3000/dashboard/4778037/218144`, expand "Past gameweeks", and confirm the calibration panel renders with the real numbers from `docs/model-report.json`.

Also: `curl -s http://localhost:3000/api/model-report | head -c 300` should return the JSON.

- [ ] **Step 11: Commit**

```bash
git add src/lib/projections/model-report.ts src/lib/projections/model-report.test.ts src/app/api/model-report/route.ts src/components/ModelCalibrationPanel.tsx src/components/Dashboard.tsx docs/model-report.json
git commit -m "feat(projections): ship gate, model report endpoint and calibration panel

We publish our own expected points only when they beat FPL's on the held-out
2025-26 starters, on both RMSE and Spearman. When they do not, the panel says
so rather than presenting the projections as decisive."
```

---

### Task 13: Gameweek snapshot collector

**Files:**
- Create: `src/lib/backtest/snapshot.ts`
- Create: `src/lib/backtest/snapshot.test.ts`
- Create: `src/app/api/cron/snapshot/route.ts`
- Modify: `vercel.json` (add the cron entry)

**Interfaces:**
- Consumes: `getBootstrap`, `getLive`, `currentEvent`, `nextEvent` from `@/lib/fpl/client`; `redis` helpers from `@/lib/store/redis`.
- Produces:
  - `interface PreDeadlineSnapshot { gw: number; capturedAt: string; players: Array<{ id: number; epNext: number; xg90: number; xa90: number; startsPer90: number; chanceOfPlaying: number | null; elementType: number; teamId: number }> }`
  - `interface SettledSnapshot { gw: number; capturedAt: string; players: Array<{ id: number; minutes: number; starts: number; bps: number; bonus: number; defensiveContribution: number; totalPoints: number; expectedGoals: number; expectedAssists: number }> }`
  - `buildPreDeadlineSnapshot(bs: FplBootstrap, gw: number, capturedAt: string): PreDeadlineSnapshot`
  - `buildSettledSnapshot(live: FplLive, gw: number, capturedAt: string): SettledSnapshot`
  - `snapshotKey(kind: "pre" | "settled", gw: number): string`

The archive carries FPL's `xP` for only 11 of 38 gameweeks in 2025-26, and 2026-27 is
not archived at all. This captures our own copy each gameweek so the ship gate stops
depending on someone else's coverage. It is Stage 2 of the gate in the spec.

- [ ] **Step 1: Write the failing test**

Create `src/lib/backtest/snapshot.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import type { FplBootstrap, FplLive } from "@/lib/types";
import {
  buildPreDeadlineSnapshot,
  buildSettledSnapshot,
  snapshotKey,
} from "@/lib/backtest/snapshot";

const bs = {
  elements: [
    {
      id: 1,
      element_type: 3,
      team: 2,
      ep_next: "4.5",
      expected_goals_per_90: 0.4,
      expected_assists_per_90: 0.2,
      starts_per_90: 0.9,
      chance_of_playing_next_round: null,
    },
    {
      id: 2,
      element_type: 2,
      team: 3,
      ep_next: "",
      expected_goals_per_90: 0.05,
      expected_assists_per_90: 0.1,
      starts_per_90: 1,
      chance_of_playing_next_round: 75,
    },
  ],
} as unknown as FplBootstrap;

const live = {
  elements: [
    {
      id: 1,
      stats: {
        minutes: 90, starts: 1, bps: 30, bonus: 2, defensive_contribution: 11,
        total_points: 9, expected_goals: 0.3, expected_assists: 0.1,
      },
    },
  ],
} as unknown as FplLive;

describe("snapshotKey", () => {
  it("namespaces by kind and gameweek", () => {
    expect(snapshotKey("pre", 7)).toBe("rs:snapshot:pre:7");
    expect(snapshotKey("settled", 7)).toBe("rs:snapshot:settled:7");
  });
});

describe("buildPreDeadlineSnapshot", () => {
  it("captures FPL's ep_next as a number", () => {
    const snap = buildPreDeadlineSnapshot(bs, 7, "2026-08-28T00:00:00.000Z");
    expect(snap.players[0].epNext).toBeCloseTo(4.5, 5);
  });

  it("records a missing ep_next as 0 rather than NaN", () => {
    const snap = buildPreDeadlineSnapshot(bs, 7, "2026-08-28T00:00:00.000Z");
    expect(snap.players[1].epNext).toBe(0);
  });

  it("preserves a null chance_of_playing rather than coercing it to 0", () => {
    const snap = buildPreDeadlineSnapshot(bs, 7, "2026-08-28T00:00:00.000Z");
    expect(snap.players[0].chanceOfPlaying).toBeNull();
    expect(snap.players[1].chanceOfPlaying).toBe(75);
  });

  it("stamps the gameweek and capture time", () => {
    const snap = buildPreDeadlineSnapshot(bs, 7, "2026-08-28T00:00:00.000Z");
    expect(snap.gw).toBe(7);
    expect(snap.capturedAt).toBe("2026-08-28T00:00:00.000Z");
  });

  it("captures every element", () => {
    expect(buildPreDeadlineSnapshot(bs, 7, "x").players).toHaveLength(2);
  });
});

describe("buildSettledSnapshot", () => {
  it("captures the actuals needed to score a prediction", () => {
    const snap = buildSettledSnapshot(live, 7, "2026-08-28T00:00:00.000Z");
    expect(snap.players[0]).toMatchObject({
      id: 1, minutes: 90, starts: 1, bps: 30, bonus: 2,
      defensiveContribution: 11, totalPoints: 9,
    });
  });

  it("defaults a missing defensive_contribution to 0", () => {
    const older = {
      elements: [{ id: 5, stats: { minutes: 90, starts: 1, bps: 10, bonus: 0, total_points: 3, expected_goals: 0, expected_assists: 0 } }],
    } as unknown as FplLive;
    expect(buildSettledSnapshot(older, 3, "x").players[0].defensiveContribution).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/backtest/snapshot.test.ts`
Expected: FAIL — cannot resolve `@/lib/backtest/snapshot`.

- [ ] **Step 3: Implement the snapshot builders**

Create `src/lib/backtest/snapshot.ts`:

```typescript
// Captures our own copy of each gameweek, so the benchmark stops depending on
// the archive's patchy xP coverage (11 of 38 gameweeks in 2025-26) and works for
// the current season, which is not archived at all.
//
// Two captures per gameweek:
//   pre     - before the deadline: the features, plus FPL's own ep_next
//   settled - after the gameweek finishes: the actuals

import type { FplBootstrap, FplLive } from "@/lib/types";

export interface PreDeadlinePlayer {
  id: number;
  epNext: number;
  xg90: number;
  xa90: number;
  startsPer90: number;
  chanceOfPlaying: number | null;
  elementType: number;
  teamId: number;
}

export interface PreDeadlineSnapshot {
  gw: number;
  capturedAt: string;
  players: PreDeadlinePlayer[];
}

export interface SettledPlayer {
  id: number;
  minutes: number;
  starts: number;
  bps: number;
  bonus: number;
  defensiveContribution: number;
  totalPoints: number;
  expectedGoals: number;
  expectedAssists: number;
}

export interface SettledSnapshot {
  gw: number;
  capturedAt: string;
  players: SettledPlayer[];
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function snapshotKey(kind: "pre" | "settled", gw: number): string {
  return `rs:snapshot:${kind}:${gw}`;
}

export function buildPreDeadlineSnapshot(
  bs: FplBootstrap,
  gw: number,
  capturedAt: string,
): PreDeadlineSnapshot {
  return {
    gw,
    capturedAt,
    players: bs.elements.map((e) => ({
      id: e.id,
      epNext: num((e as { ep_next?: string }).ep_next),
      xg90: num(e.expected_goals_per_90),
      xa90: num(e.expected_assists_per_90),
      startsPer90: num(e.starts_per_90),
      chanceOfPlaying:
        e.chance_of_playing_next_round === null || e.chance_of_playing_next_round === undefined
          ? null
          : num(e.chance_of_playing_next_round),
      elementType: e.element_type,
      teamId: e.team,
    })),
  };
}

export function buildSettledSnapshot(
  live: FplLive,
  gw: number,
  capturedAt: string,
): SettledSnapshot {
  return {
    gw,
    capturedAt,
    players: live.elements.map((e) => ({
      id: e.id,
      minutes: num(e.stats.minutes),
      starts: num(e.stats.starts),
      bps: num(e.stats.bps),
      bonus: num(e.stats.bonus),
      defensiveContribution: num(e.stats.defensive_contribution),
      totalPoints: num(e.stats.total_points),
      expectedGoals: num((e.stats as { expected_goals?: number }).expected_goals),
      expectedAssists: num((e.stats as { expected_assists?: number }).expected_assists),
    })),
  };
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/backtest/snapshot.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Create the cron route**

Read `src/app/api/cron/deadline-watch/route.ts` first and copy its `CRON_SECRET`
authorisation pattern exactly rather than inventing a new one.

Create `src/app/api/cron/snapshot/route.ts`:

```typescript
// Runs twice daily. Captures the pre-deadline feature set for the upcoming
// gameweek, and the settled actuals for any finished gameweek not yet stored.

import { NextResponse } from "next/server";

import {
  buildPreDeadlineSnapshot,
  buildSettledSnapshot,
  snapshotKey,
} from "@/lib/backtest/snapshot";
import { currentEvent, getBootstrap, getLive, nextEvent } from "@/lib/fpl/client";
import { redis } from "@/lib/store/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RETENTION_SECONDS = 60 * 60 * 24 * 400;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!redis) {
    return NextResponse.json({ ok: false, reason: "redis not configured" }, { status: 200 });
  }

  try {
    const bs = await getBootstrap();
    const capturedAt = new Date().toISOString();
    const upcoming = nextEvent(bs);
    const current = currentEvent(bs);
    const written: string[] = [];

    const preKey = snapshotKey("pre", upcoming.id);
    if (!(await redis.exists(preKey))) {
      await redis.set(preKey, buildPreDeadlineSnapshot(bs, upcoming.id, capturedAt), {
        ex: RETENTION_SECONDS,
      });
      written.push(preKey);
    }

    if (current.finished) {
      const settledKey = snapshotKey("settled", current.id);
      if (!(await redis.exists(settledKey))) {
        const live = await getLive(current.id);
        await redis.set(settledKey, buildSettledSnapshot(live, current.id, capturedAt), {
          ex: RETENTION_SECONDS,
        });
        written.push(settledKey);
      }
    }

    return NextResponse.json({ ok: true, written });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
```

If `redis` is not the export name in `src/lib/store/redis.ts`, read that file and use
whatever it actually exports. Do not guess.

- [ ] **Step 6: Register the cron**

In `vercel.json`, add to the `crons` array:

```json
    { "path": "/api/cron/snapshot", "schedule": "0 6,22 * * *" }
```

Twice daily catches both the pre-deadline window and post-settlement without needing
to track kickoff times.

- [ ] **Step 7: Verify locally**

Run: `npm run dev`, then:

```bash
curl -s http://localhost:3000/api/cron/snapshot | head -c 300
```

Expected: JSON with `ok: true` and a `written` array, or `ok: false, reason: "redis not configured"` when no Upstash credentials are present locally. Both are correct outcomes; a 500 is not.

- [ ] **Step 8: Commit**

```bash
git add src/lib/backtest/snapshot.ts src/lib/backtest/snapshot.test.ts src/app/api/cron/snapshot/route.ts vercel.json
git commit -m "feat(backtest): capture per-gameweek snapshots for Stage 2 of the ship gate

The archive carries FPL's xP for only 11 of 38 gameweeks in 2025-26 and does
not cover the current season at all. Capturing bootstrap ep_next before each
deadline and the live actuals after settlement makes the benchmark independent
of someone else's coverage."
```

---

## Verification

After Task 13, the following must all hold:

```bash
npx vitest run              # all tests pass
npx vitest run --coverage   # >=80% lines on src/lib/backtest and src/lib/projections
npx tsc --noEmit            # exit 0
npm run backtest            # reproduces the committed report from the manifest
```

And in the running app: `/api/projections` returns plausible non-zero `xPoints`, the
calibration panel renders real measured numbers, and `/api/cron/snapshot` returns
`ok: true` (or a clean `redis not configured` when running without Upstash).

## Notes for the executor

- **Task 9 Step 7 and Task 10 Step 6 produce real numbers.** Record them. If the ship gate fails, that is a legitimate result — the spec's whole point is that we withhold our numbers rather than publish ones we cannot justify. Report the numbers; do not tune coefficients to force a pass without re-running the full backtest.
- The two coefficients marked `TUNED` in `scoring.ts` (`BONUS_PER_BPS90`, `CLEAN_SHEET_BASE`) are starting values. If the gate fails, sweeping them against the **fit** set (never the holdout) is in scope. Sweeping against the holdout is not — that would invalidate the gate.
- Do not change any field name or type on `PlayerProjection`. Six files depend on it.
- If `next lint` still fails to resolve its config, that is a known pre-existing issue caused by a stray `package-lock.json` in the parent directory. It is not caused by this work and is out of scope here.
