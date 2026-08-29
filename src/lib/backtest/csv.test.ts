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
