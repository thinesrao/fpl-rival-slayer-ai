import { z } from "zod";

const schema = z.object({
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-pro"),
  FPL_USER_AGENT: z
    .string()
    .default("fpl-rival-slayer-ai/0.1 (+https://github.com/thinesrao/fpl-rival-slayer-ai)"),
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
  : { GEMINI_API_KEY: undefined, GEMINI_MODEL: "gemini-2.5-pro", FPL_USER_AGENT: "fpl-rival-slayer-ai/0.1" };

export const aiEnabled = Boolean(env.GEMINI_API_KEY);
