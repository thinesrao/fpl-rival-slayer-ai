// Multi-turn Gemini chat scoped to a (team, league). We pass the same
// rival/projection context as a SYSTEM-INSTRUCTION-style preamble, then feed
// the prior turns as `contents[]` so the model can answer follow-ups
// coherently ("what if I captain Salah instead?"). Replies are markdown,
// not JSON — this is a conversation, not a structured-output call.

import { GoogleGenAI, type GroundingMetadata } from "@google/genai";
import { aiEnabled, env } from "@/lib/env";
import { buildChatContextBlock, buildChatSystemInstruction, computeSeasonLabel } from "./prompts";
import type { ChatMessage } from "@/lib/store/chat";
import type {
  FplBootstrap,
  FplFixture,
  OvertakeOdds,
  RivalContext,
  SquadProjection,
} from "@/lib/types";
import type { EoMap } from "@/lib/intel/effective-ownership";

let cachedClient: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!aiEnabled) throw new Error("GEMINI_API_KEY is not set; chat disabled.");
  cachedClient ||= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return cachedClient;
}

export interface ChatContext {
  gw: number;
  deadline: string;
  ctx: RivalContext;
  userProjection: SquadProjection;
  rivalProjections: SquadProjection[];
  overtake: OvertakeOdds[];
  fixtures: FplFixture[];
  bs: FplBootstrap;
  bank: number;
  freeTransfers: number;
  eo?: EoMap;
}

export interface ChatReply {
  reply: string;
  citations: Array<{ uri: string; title: string }>;
  searchQueries: string[];
  model: string;
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

export async function askChat(
  history: ChatMessage[],
  userMessage: string,
  context: ChatContext,
): Promise<ChatReply> {
  const ai = client();
  const model = env.GEMINI_MODEL;
  const seasonLabel = computeSeasonLabel(context.deadline);
  const systemInstruction = buildChatSystemInstruction({
    seasonLabel,
    gw: context.gw,
    deadline: context.deadline,
  });

  const contextBlock = buildChatContextBlock(context);

  // Turn-by-turn history → Gemini `contents`. Prepend the context block as the
  // first synthetic user turn so the model "knows" the squad state without
  // bloating the system instruction (which we want to keep cacheable).
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [
    { role: "user", parts: [{ text: contextBlock }] },
    {
      role: "model",
      parts: [
        {
          text: "Understood. I have your squad, your rivals, the upcoming fixtures, and the projection model loaded. Ask me anything.",
        },
      ],
    },
    ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: "user" as const, parts: [{ text: userMessage }] },
  ];

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction,
      temperature: 0.4,
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingBudget: 1024 },
      maxOutputTokens: 4096,
    },
  });

  const candidate = response.candidates?.[0];
  const partsText = (candidate?.content?.parts ?? [])
    .map((p) => ("text" in p && typeof p.text === "string" ? p.text : ""))
    .join("");
  let text = response.text || partsText || "";

  if (!text) {
    // Retry once without googleSearch — same fallback pattern as askStrategist.
    const fallback = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        temperature: 0.4,
        thinkingConfig: { thinkingBudget: 512 },
        maxOutputTokens: 4096,
      },
    });
    const fbCandidate = fallback.candidates?.[0];
    text =
      fallback.text ||
      (fbCandidate?.content?.parts ?? [])
        .map((p) => ("text" in p && typeof p.text === "string" ? p.text : ""))
        .join("") ||
      "";
    if (!text) {
      throw new Error(
        `Gemini returned no text (finishReason=${candidate?.finishReason ?? "UNKNOWN"}).`,
      );
    }
    const g = extractGrounding(fbCandidate?.groundingMetadata);
    return { reply: text.trim(), citations: g.chunks, searchQueries: g.queries, model };
  }

  const grounding = extractGrounding(candidate?.groundingMetadata);
  return { reply: text.trim(), citations: grounding.chunks, searchQueries: grounding.queries, model };
}
