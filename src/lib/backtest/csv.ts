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
