// Compact URL-safe encoding for a SquadDraft. Round-trips through a
// single ?d= / /draft/<x> path segment — no server-side persistence
// required.
//
// Implementation note: must run in BOTH the browser and Node. We
// detect the environment with `typeof window` rather than trusting
// `typeof Buffer`, because some browser bundlers polyfill `Buffer`
// with a shim that does NOT support the 'base64url' encoding name
// (throws "Unknown encoding: base64url"). Use btoa/atob with the
// URL-safe substitution in the browser, Node Buffer with
// 'base64url' on the server.

import type { SquadDraft } from "./types";

interface Encoded {
  n: string;
  b: number;
  p: (number | null)[];
  c: number | null;
  v: number | null;
}

const isBrowser = () => typeof window !== "undefined";

function toBase64UrlBrowser(json: string): string {
  // btoa needs Latin-1; round-trip UTF-8 via encodeURIComponent.
  const bin = unescape(encodeURIComponent(json));
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64UrlBrowser(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  // Pad to a multiple of 4 — atob requires it.
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
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
  if (isBrowser()) return toBase64UrlBrowser(json);
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeDraft(s: string): Encoded | null {
  try {
    const json = isBrowser()
      ? fromBase64UrlBrowser(s)
      : Buffer.from(s, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.p) || parsed.p.length !== 15) return null;
    return parsed as Encoded;
  } catch {
    return null;
  }
}
