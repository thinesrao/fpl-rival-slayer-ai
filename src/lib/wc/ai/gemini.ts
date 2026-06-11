// Shared Gemini call wrapper for the WC flows: grounded call → text extract →
// ungrounded retry → JSON parse → reformat retry. Mirrors askStrategist's
// reliability ladder in src/lib/ai/gemini.ts.

import { GoogleGenAI } from "@google/genai";
import { aiEnabled, env } from "@/lib/env";
import { extractGrounding, extractJsonBlock } from "./json";

let cachedClient: GoogleGenAI | null = null;

function client(): GoogleGenAI {
  if (!aiEnabled) throw new Error("GEMINI_API_KEY is not set; AI features disabled.");
  cachedClient ||= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return cachedClient;
}

const FALLBACK_MODEL = "gemini-2.5-flash";

/** Gemini returns 503 UNAVAILABLE ("high demand") and 429 during spikes —
 *  transient by definition, so we retry and then downgrade models. */
export function isTransientGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /503|UNAVAILABLE|overloaded|high demand|try again later|429|RESOURCE_EXHAUSTED/i.test(msg);
}

export function friendlyGeminiError(err: unknown): string {
  if (isTransientGeminiError(err)) {
    return "Gemini is overloaded right now (Google-side spike). Wait ~30s and tap retry — the app already retried on a backup model.";
  }
  return err instanceof Error ? err.message : String(err);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Google's 429s carry a RetryInfo hint ("retryDelay": "15s") — honor it,
 *  capped so we don't blow the function deadline. */
export function suggestedRetryDelayMs(err: unknown, fallbackMs: number): number {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /retryDelay[\\"':\s]+(\d+)s/i.exec(msg);
  if (!m) return fallbackMs;
  return Math.min(Number(m[1]) * 1000 + 500, 25_000);
}

/** The (model, delay) attempt ladder: primary twice with backoff, then flash. */
export function modelAttempts(primary: string): Array<{ model: string; delayMs: number }> {
  return [
    { model: primary, delayMs: 0 },
    { model: primary, delayMs: 2500 },
    ...(primary !== FALLBACK_MODEL ? [{ model: FALLBACK_MODEL, delayMs: 1500 }] : [{ model: primary, delayMs: 5000 }]),
  ];
}

/** Run `fn` against the attempt ladder. Non-transient errors throw at once. */
export async function withModelRetry<R>(primary: string, fn: (model: string) => Promise<R>): Promise<R> {
  let lastErr: unknown;
  for (const attempt of modelAttempts(primary)) {
    const delayMs = lastErr ? suggestedRetryDelayMs(lastErr, attempt.delayMs) : attempt.delayMs;
    if (delayMs) await sleep(delayMs);
    try {
      return await fn(attempt.model);
    } catch (err) {
      lastErr = err;
      if (!isTransientGeminiError(err)) throw err;
      console.warn(`[wc/ai] transient Gemini error on ${attempt.model}, retrying`, err instanceof Error ? err.message.slice(0, 120) : err);
    }
  }
  throw lastErr;
}

export interface GroundedJsonResult<T> {
  parsed: T;
  raw: string;
  searchQueries: string[];
  groundingChunks: Array<{ uri: string; title: string }>;
  model: string;
}

export async function askGroundedJson<T>(args: {
  systemInstruction: string;
  userPrompt: string;
  coerce: (parsed: unknown) => T;
  thinkingBudget?: number;
}): Promise<GroundedJsonResult<T>> {
  const ai = client();
  const model = env.GEMINI_MODEL;

  function extractText(resp: Awaited<ReturnType<typeof ai.models.generateContent>>) {
    const candidate = resp.candidates?.[0];
    const partsText = (candidate?.content?.parts ?? [])
      .map((p) => ("text" in p && typeof p.text === "string" ? p.text : ""))
      .join("");
    return {
      text: resp.text || partsText || "",
      finishReason: candidate?.finishReason ?? "UNKNOWN",
      candidate,
    };
  }

  let usedModel = model;
  // Grounded ladder first; if quota/overload kills every grounded attempt
  // (search-grounding has its own, tighter quota), fall through to the
  // ungrounded ladder below rather than failing the whole request.
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
  try {
    response = await withModelRetry(model, (m) => {
      usedModel = m;
      return ai.models.generateContent({
        model: m,
        contents: args.userPrompt,
        config: {
          systemInstruction: args.systemInstruction,
          temperature: 0.3,
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingBudget: args.thinkingBudget ?? 2048 },
          maxOutputTokens: 16384,
        },
      });
    });
  } catch (err) {
    if (!isTransientGeminiError(err)) throw err;
    console.warn("[wc/ai] grounded ladder exhausted, falling back to ungrounded", err instanceof Error ? err.message.slice(0, 120) : err);
  }

  let usedResponse = response;
  let { text, finishReason, candidate } = response
    ? extractText(response)
    : { text: "", finishReason: "UNKNOWN" as string, candidate: undefined };

  if (!text) {
    // Grounded call produced no usable text — retry once without googleSearch,
    // trading live news for a guaranteed answer.
    const fallback = await withModelRetry(usedModel, (m) =>
      ai.models.generateContent({
        model: m,
        contents: args.userPrompt,
        config: {
          systemInstruction: args.systemInstruction,
          temperature: 0.3,
          thinkingConfig: { thinkingBudget: 1024 },
          maxOutputTokens: 16384,
          responseMimeType: "application/json",
        },
      }),
    );
    ({ text, finishReason, candidate } = extractText(fallback));
    usedResponse = fallback;
  }

  if (!text) {
    const err = new Error(
      `Gemini returned no text content (finishReason=${finishReason}). ` +
        `This usually means a safety/recitation block or a quota issue.`,
    );
    (err as Error & { rawText?: string }).rawText = JSON.stringify(
      { finishReason, safetyRatings: candidate?.safetyRatings, promptFeedback: usedResponse?.promptFeedback },
      null,
      2,
    );
    throw err;
  }

  let parsedJson: unknown;
  try {
    parsedJson = extractJsonBlock(text);
  } catch (firstErr) {
    const reformat = await withModelRetry(usedModel, (m) =>
      ai.models.generateContent({
        model: m,
        contents:
        `The following text was meant to be a JSON object matching a schema, but failed to parse. ` +
        `Re-emit it as a single valid JSON object. Output NOTHING except the JSON — no prose, no markdown ` +
        `fences, no comments. If a field is missing, fill with a sensible default ("", [], "medium", "none"). ` +
        `Preserve every concrete recommendation from the source text.\n\nSOURCE:\n${text.slice(0, 12000)}`,
        config: { temperature: 0.0, responseMimeType: "application/json" },
      }),
    );
    try {
      parsedJson = extractJsonBlock(reformat.text ?? "");
    } catch {
      throw firstErr;
    }
  }

  const grounding = extractGrounding(usedResponse?.candidates?.[0]?.groundingMetadata);
  return {
    parsed: args.coerce(parsedJson),
    raw: text,
    searchQueries: grounding.queries,
    groundingChunks: grounding.chunks,
    model: usedModel,
  };
}
