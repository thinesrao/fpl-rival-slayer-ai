// Compact URL-safe encoding for a SquadDraft. Used by the share-card
// route so the entire draft round-trips through a single query param
// — no server-side persistence required.

import type { SquadDraft } from "./types";

interface Encoded {
  n: string;          // name
  b: number;          // budget (tenths)
  p: (number | null)[]; // picks (15)
  c: number | null;   // captain id
  v: number | null;   // vice id
}

export function encodeDraft(d: SquadDraft): string {
  const slim: Encoded = {
    n: d.name,
    b: d.budget,
    p: d.picks,
    c: d.captainId,
    v: d.viceId,
  };
  const json = JSON.stringify(slim);
  // URL-safe base64. Use Buffer on Node / btoa on the edge.
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf8").toString("base64url");
  }
  // Fallback for environments without Buffer.
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeDraft(s: string): Encoded | null {
  try {
    let json: string;
    if (typeof Buffer !== "undefined") {
      json = Buffer.from(s, "base64url").toString("utf8");
    } else {
      const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
      json = decodeURIComponent(escape(atob(b64)));
    }
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.p) || parsed.p.length !== 15) return null;
    return parsed as Encoded;
  } catch {
    return null;
  }
}
