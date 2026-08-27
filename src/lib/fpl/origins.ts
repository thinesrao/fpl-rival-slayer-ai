// Ordered list of network paths we can use to reach the FPL API, plus a
// fetch helper that fails over between them.
//
// Why this exists: FPL fronts its API with Cloudflare bot management, which
// challenges requests from data-centre egress. Which *specific* networks are
// blocked changes over time — Vercel's AWS ranges were blocked in May 2026,
// and the Cloudflare Worker that was built to dodge that is itself blocked
// now (Worker -> Cloudflare-fronted origin scores as automated). Pinning the
// app to any single path means one upstream policy change takes the whole
// product down, which is exactly what happened.
//
// So: try direct first, fall back to the proxy, and remember which one
// worked so steady-state traffic costs one request, not two.

import { env } from "@/lib/env";

export interface FplOrigin {
  /** Short name used in error messages and the /api/diag report. */
  readonly label: string;
  /** Absolute base URL; paths are appended verbatim. */
  readonly base: string;
  readonly headers: Readonly<Record<string, string>>;
}

// FPL's bot filter 403s anything that looks like a generic HTTP client, so
// every request carries the header set a real Chrome navigation would send.
function browserHeaders(): Record<string, string> {
  return {
    "User-Agent": env.FPL_USER_AGENT,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-GB,en;q=0.9",
    Referer: "https://fantasy.premierleague.com/",
    Origin: "https://fantasy.premierleague.com",
  };
}

function buildOrigins(): readonly FplOrigin[] {
  const direct: FplOrigin = {
    label: "direct",
    base: "https://fantasy.premierleague.com/api",
    headers: Object.freeze(browserHeaders()),
  };

  if (!env.FPL_PROXY_URL) return Object.freeze([direct]);

  const proxy: FplOrigin = {
    label: "proxy",
    base: `${env.FPL_PROXY_URL.replace(/\/$/, "")}/api`,
    headers: Object.freeze({
      ...browserHeaders(),
      ...(env.FPL_PROXY_SECRET ? { "X-FPL-Proxy-Secret": env.FPL_PROXY_SECRET } : {}),
    }),
  };

  // Direct first: one hop fewer, and it removes the proxy from the critical
  // path entirely whenever the host's own egress is allowed through.
  return Object.freeze([direct, proxy]);
}

export const ORIGINS = buildOrigins();

/**
 * A status that means "this network path is blocked", as opposed to "the
 * resource genuinely isn't there". Only these are worth retrying elsewhere —
 * a 404 for a bad team ID would return 404 from every origin.
 */
function isPathBlocked(status: number): boolean {
  return status === 403 || status === 429 || status === 451;
}

// Index into ORIGINS that most recently succeeded. Starting at 0 (direct)
// means a cold process probes direct once; after that it sticks to whatever
// works, so we don't pay a wasted round trip per request.
let preferredIndex = 0;

/** Try `preferredIndex` first, then every other origin in order. */
function attemptOrder(): readonly number[] {
  const rest = ORIGINS.map((_, i) => i).filter((i) => i !== preferredIndex);
  return [preferredIndex, ...rest];
}

export class FplBlockedError extends Error {
  constructor(
    public readonly status: number,
    public readonly attempts: ReadonlyArray<{ label: string; status: number; body: string }>,
    message: string,
  ) {
    super(message);
    this.name = "FplBlockedError";
  }
}

function describeAttempts(
  path: string,
  attempts: ReadonlyArray<{ label: string; status: number; body: string }>,
): string {
  const tried = attempts.map((a) => `${a.label}=${a.status}`).join(", ");
  const sample = attempts[attempts.length - 1]?.body.slice(0, 120) ?? "";
  return (
    `FPL blocked ${path} on every route (${tried}). ` +
    `Every available network path is being challenged by FPL's bot filter. ` +
    `Add a working FPL_PROXY_URL, or check whether the host's egress IP is on the block list. ` +
    `Last body: ${sample}`
  );
}

/**
 * Fetch `path` (e.g. "/bootstrap-static/") from the first FPL origin that
 * isn't blocked. Non-blocking failures (404, 500) are returned as-is so the
 * caller can handle them; only blocked statuses trigger failover.
 *
 * @throws {FplBlockedError} when every origin is blocked.
 */
export async function fetchFpl(path: string, init: RequestInit = {}): Promise<Response> {
  const attempts: Array<{ label: string; status: number; body: string }> = [];

  for (const index of attemptOrder()) {
    const origin = ORIGINS[index];
    let res: Response;
    try {
      res = await fetch(`${origin.base}${path}`, {
        ...init,
        headers: { ...origin.headers, ...(init.headers as Record<string, string> | undefined) },
      });
    } catch (error) {
      // Network-level failure (DNS, TLS, timeout) — treat like a blocked path
      // so the next origin still gets a turn.
      attempts.push({
        label: origin.label,
        status: 0,
        body: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (res.ok) {
      preferredIndex = index;
      return res;
    }

    if (!isPathBlocked(res.status)) return res;

    attempts.push({
      label: origin.label,
      status: res.status,
      body: await res.text().catch(() => ""),
    });
  }

  const status = attempts.find((a) => a.status !== 0)?.status ?? 503;
  throw new FplBlockedError(status, attempts, describeAttempts(path, attempts));
}

/** Which origin served the last successful request. Used by /api/diag. */
export function activeOriginLabel(): string {
  return ORIGINS[preferredIndex]?.label ?? "none";
}
