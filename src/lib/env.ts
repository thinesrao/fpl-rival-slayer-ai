import { z } from "zod";

// FPL's bot filter rejects custom User-Agents (anything mentioning a repo URL
// or "bot"/"crawler" gets 403'd). Default to a real Chrome string; override
// via env var if you need something else.
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const schema = z.object({
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-pro"),
  FPL_USER_AGENT: z.string().default(CHROME_UA),
});

const parsed = schema.safeParse({
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  FPL_USER_AGENT: process.env.FPL_USER_AGENT,
});

if (!parsed.success) {
  console.warn("[env] invalid env vars", parsed.error.flatten().fieldErrors);
}

export const env = parsed.success
  ? parsed.data
  : { GEMINI_API_KEY: undefined, GEMINI_MODEL: "gemini-2.5-pro", FPL_USER_AGENT: CHROME_UA };

export const aiEnabled = Boolean(env.GEMINI_API_KEY);

// Public defaults — readable on the client so the form can pre-fill them.
// Inlined as `process.env.NEXT_PUBLIC_*` so Next.js statically substitutes at build time.
function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const defaults = {
  teamId: parsePositiveInt(process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID),
  leagueId: parsePositiveInt(process.env.NEXT_PUBLIC_DEFAULT_LEAGUE_ID),
};
