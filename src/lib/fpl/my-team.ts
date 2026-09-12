// Authenticated read of the squad a manager has SAVED for the upcoming
// deadline — the one case the public API cannot serve.
//
// `/entry/{id}/event/{gw}/picks/` 404s until that gameweek's deadline has
// passed, so a wildcard squad picked on Friday is invisible to every
// unauthenticated route in this app until Saturday, by which point it is too
// late to change anything. `/api/my-team/{id}/` returns it, and it is the
// manager's own login that unlocks it.
//
// Handling of the credential, deliberately narrow:
//   - it arrives per request and is never written to disk, Redis or a log;
//   - the response is never cached (`cache: "no-store"`);
//   - the request goes DIRECT to fantasy.premierleague.com. It must not take
//     the FPL_PROXY_URL failover path that the rest of ./origins uses: that
//     proxy is separate infrastructure and has no business seeing a session
//     cookie.

import { z } from "zod";
import { env } from "@/lib/env";
import { FplError } from "./client";

const MY_TEAM_BASE = "https://fantasy.premierleague.com/api";

/** Cookie names FPL's own site sends on an authenticated API call. Anything
 *  else in the pasted blob is dropped rather than forwarded. */
const ALLOWED_COOKIES = ["pl_profile", "sessionid", "csrftoken", "datadome"] as const;

/** The two that actually carry the login. At least one must be present. */
const AUTH_COOKIES = ["pl_profile", "sessionid"] as const;

const MyTeamSchema = z.object({
  picks: z
    .array(
      z.object({
        element: z.number().int().positive(),
        position: z.number().int().positive(),
        selling_price: z.number().int().nonnegative().optional(),
        purchase_price: z.number().int().nonnegative().optional(),
        multiplier: z.number().int().nonnegative().optional(),
        is_captain: z.boolean().optional(),
        is_vice_captain: z.boolean().optional(),
      }),
    )
    .min(1),
  chips: z
    .array(
      z.object({
        name: z.string(),
        status_for_entry: z.string().optional(),
      }),
    )
    .optional(),
  transfers: z
    .object({
      bank: z.number().int().nonnegative().optional(),
      value: z.number().int().nonnegative().optional(),
      limit: z.number().int().nullable().optional(),
      made: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type FplMyTeam = z.infer<typeof MyTeamSchema>;

export class FplAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FplAuthError";
  }
}

/**
 * Reduce whatever the user pasted — a `Cookie:` header, a `document.cookie`
 * dump, or a single `name=value` pair — to the cookies FPL needs.
 *
 * @throws {FplAuthError} when no login cookie is present.
 */
export function sanitizeFplCookie(raw: string): string {
  const found = new Map<string, string>();
  for (const part of raw.replace(/^\s*cookie\s*:/i, "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!value) continue;
    if (!(ALLOWED_COOKIES as readonly string[]).includes(name)) continue;
    found.set(name, value);
  }
  if (!AUTH_COOKIES.some((name) => found.has(name))) {
    throw new FplAuthError(
      "That paste didn't contain an FPL login cookie. Copy the pl_profile (and sessionid) cookie from fantasy.premierleague.com while you're signed in.",
    );
  }
  return [...found].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * Fetch the manager's pending squad.
 *
 * @throws {FplAuthError} when FPL rejects the credential.
 * @throws {FplError} for any other upstream failure.
 */
export async function getMyTeam(teamId: number, rawCookie: string): Promise<FplMyTeam> {
  const cookie = sanitizeFplCookie(rawCookie);

  const res = await fetch(`${MY_TEAM_BASE}/my-team/${teamId}/`, {
    cache: "no-store",
    headers: {
      "User-Agent": env.FPL_USER_AGENT,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-GB,en;q=0.9",
      Referer: "https://fantasy.premierleague.com/my-team",
      Origin: "https://fantasy.premierleague.com",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookie,
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new FplAuthError(
      "FPL rejected that cookie. It expires when you sign out or after a while — sign in at fantasy.premierleague.com and copy a fresh one.",
    );
  }
  if (res.status === 404) {
    throw new FplAuthError(
      `FPL has no team ${teamId} on that account. The cookie has to belong to the manager who owns the team ID.`,
    );
  }
  if (!res.ok) {
    // The body can echo request headers back; keep it out of the message.
    throw new FplError(res.status, `FPL ${res.status} on my-team/${teamId}.`);
  }

  const parsed = MyTeamSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    throw new FplError(502, "FPL returned an unexpected my-team payload.");
  }
  return parsed.data;
}

/** The chip active on the pending squad ("wildcard", "freehit", …), if any. */
export function activeChipOf(team: FplMyTeam): string | null {
  return team.chips?.find((c) => c.status_for_entry === "active")?.name ?? null;
}
