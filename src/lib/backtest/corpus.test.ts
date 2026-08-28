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
