// Streaming WC26 chat: live digest as a synthetic first turn, googleSearch
// grounding, markdown replies. History is client-held and replayed per
// request (works with or without Redis).

import { GoogleGenAI, type GroundingMetadata } from "@google/genai";
import { aiEnabled, env } from "@/lib/env";
import { isTransientGeminiError, modelAttempts, suggestedRetryDelayMs } from "./gemini";

let cachedClient: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!aiEnabled) throw new Error("GEMINI_API_KEY is not set; chat disabled.");
  cachedClient ||= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return cachedClient;
}

export interface WcChatMessage {
  role: "user" | "model";
  text: string;
}

export interface WcChatStreamEvent {
  delta?: string;
  done?: boolean;
  citations?: Array<{ uri: string; title: string }>;
  searchQueries?: string[];
}

function extractGrounding(meta: GroundingMetadata | undefined) {
  const queries: string[] = Array.isArray(meta?.webSearchQueries)
    ? (meta!.webSearchQueries as string[])
    : [];
  const chunks =
    (meta?.groundingChunks ?? [])
      .map((c) => ({ uri: c.web?.uri ?? "", title: c.web?.title ?? c.web?.uri ?? "" }))
      .filter((c) => c.uri) ?? [];
  return { queries, chunks };
}

const SYSTEM = [
  "You are the user's FIFA World Cup 2026 Fantasy co-pilot (official game at play.fifa.com/fantasy).",
  "Be sharp, concrete and concise; markdown is fine. Your training data predates this tournament's",
  "squads, injuries and results — when asked about anything time-sensitive, verify with web search.",
  "The CONTEXT turn contains live official data (squad, fixtures, rules, deltas): trust it over memory.",
  "Remember the WC-specific meta: captaincy and bench subs can be changed mid-round onto players who",
  "haven't played yet; prices never change; Scouting Bonus rewards <5%-owned scorers.",
].join(" ");

export async function* wcChatStream(
  history: WcChatMessage[],
  userMessage: string,
  contextBlock: string,
): AsyncGenerator<WcChatStreamEvent, void, unknown> {
  const ai = client();
  const model = env.GEMINI_MODEL;

  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [
    { role: "user", parts: [{ text: `CONTEXT (live official data):\n${contextBlock}` }] },
    { role: "model", parts: [{ text: "Loaded. I have your squad, the live round state and the rules. Ask away." }] },
    ...history.slice(-12).map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: "user" as const, parts: [{ text: userMessage }] },
  ];

  let aggregated = "";
  let lastMeta: GroundingMetadata | undefined;

  // Streams can fail DURING iteration (Gemini 429/503 surfaces mid-stream),
  // so the whole create-and-consume cycle walks the retry ladder: primary
  // grounded, primary grounded again, flash grounded, then one ungrounded
  // pass. Once any text has been yielded to the client we can't restart
  // without duplicating output, so mid-text errors propagate.
  const attempts = [
    ...modelAttempts(model).map((a) => ({ ...a, grounded: true })),
    { model, delayMs: 2000, grounded: false },
    { model: "gemini-2.5-flash", delayMs: 2000, grounded: false },
  ];
  let lastErr: unknown;

  for (const attempt of attempts) {
    const delayMs = lastErr ? suggestedRetryDelayMs(lastErr, attempt.delayMs) : attempt.delayMs;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    try {
      const stream = await ai.models.generateContentStream({
        model: attempt.model,
        contents,
        config: {
          systemInstruction: SYSTEM,
          temperature: 0.4,
          ...(attempt.grounded ? { tools: [{ googleSearch: {} }] } : {}),
          thinkingConfig: { thinkingBudget: attempt.grounded ? 1024 : 512 },
          maxOutputTokens: 4096,
        },
      });
      for await (const chunk of stream) {
        const candidate = chunk.candidates?.[0];
        const partsText = (candidate?.content?.parts ?? [])
          .map((p) => ("text" in p && typeof p.text === "string" ? p.text : ""))
          .join("");
        const delta = chunk.text || partsText || "";
        if (delta) {
          aggregated += delta;
          yield { delta };
        }
        if (candidate?.groundingMetadata) lastMeta = candidate.groundingMetadata;
      }
      if (aggregated) break; // success — empty streams fall through to the next attempt
      lastErr = new Error("Gemini stream returned no text.");
    } catch (err) {
      lastErr = err;
      if (!isTransientGeminiError(err) || aggregated) throw err;
      console.warn(
        `[wc/chat] transient Gemini error on ${attempt.model}${attempt.grounded ? "" : " (ungrounded)"}, retrying`,
        err instanceof Error ? err.message.slice(0, 120) : err,
      );
    }
  }
  if (!aggregated) throw lastErr ?? new Error("Gemini stream returned no text.");

  const g = extractGrounding(lastMeta);
  yield { done: true, citations: g.chunks, searchQueries: g.queries };
}
