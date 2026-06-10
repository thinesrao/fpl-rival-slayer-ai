// Streaming WC26 chat: live digest as a synthetic first turn, googleSearch
// grounding, markdown replies. History is client-held and replayed per
// request (works with or without Redis).

import { GoogleGenAI, type GroundingMetadata } from "@google/genai";
import { aiEnabled, env } from "@/lib/env";

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

  const stream = await ai.models.generateContentStream({
    model,
    contents,
    config: {
      systemInstruction: SYSTEM,
      temperature: 0.4,
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingBudget: 1024 },
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

  if (!aggregated) {
    // Same reliability fallback as the FPL chat: retry once ungrounded.
    const fallback = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: SYSTEM,
        temperature: 0.4,
        thinkingConfig: { thinkingBudget: 512 },
        maxOutputTokens: 4096,
      },
    });
    for await (const chunk of fallback) {
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
    if (!aggregated) throw new Error("Gemini stream returned no text.");
  }

  const g = extractGrounding(lastMeta);
  yield { done: true, citations: g.chunks, searchQueries: g.queries };
}
