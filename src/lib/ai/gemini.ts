// Gemini client wrapper. We use the official @google/genai SDK, the
// `googleSearch` tool for live web grounding (so the strategist actually
// reads the latest injury news), and post-process the JSON output ourselves
// since grounded calls don't support `responseSchema`.

import { GoogleGenAI, type GroundingMetadata } from "@google/genai";
import { aiEnabled, env } from "@/lib/env";
import { SYSTEM_INSTRUCTION, buildUserPrompt } from "./prompts";
import type {
  ManagerSquad,
  OvertakeOdds,
  RivalContext,
  SquadProjection,
} from "@/lib/types";
import type { TransferSuggestion } from "@/lib/optimizer/transfers";

export interface AiRecommendation {
  overall_strategy: string;
  transfers: Array<{
    out: string;
    in: string;
    reason: string;
    rival_targeted?: string;
    hit_cost?: number;
  }>;
  captain: { pick: string; vice: string; reasoning: string };
  starting_xi: string[];
  chip: {
    use: "wildcard" | "bench-boost" | "triple-captain" | "free-hit" | "none";
    reasoning: string;
  };
  differentials_to_exploit: string[];
  news_citations: Array<{ player: string; summary: string; source_url?: string }>;
  confidence: "low" | "medium" | "high";
}

export interface AiResult {
  recommendation: AiRecommendation;
  raw: string;
  searchQueries: string[];
  groundingChunks: Array<{ uri: string; title: string }>;
  model: string;
}

let cachedClient: GoogleGenAI | null = null;

function client(): GoogleGenAI {
  if (!aiEnabled) throw new Error("GEMINI_API_KEY is not set; AI features disabled.");
  cachedClient ||= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return cachedClient;
}

function extractJsonBlock(text: string): unknown {
  // Prefer fenced ```json block.
  const fence = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      // fall through
    }
  }
  // Fall back to the largest balanced { ... } block.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch {
      // fall through
    }
  }
  throw new Error("Gemini response did not contain a parseable JSON object");
}

function coerceRecommendation(parsed: unknown): AiRecommendation {
  const p = parsed as Partial<AiRecommendation> & Record<string, unknown>;
  return {
    overall_strategy: String(p.overall_strategy ?? ""),
    transfers: Array.isArray(p.transfers) ? (p.transfers as AiRecommendation["transfers"]) : [],
    captain: (p.captain as AiRecommendation["captain"]) ?? {
      pick: "",
      vice: "",
      reasoning: "",
    },
    starting_xi: Array.isArray(p.starting_xi) ? (p.starting_xi as string[]) : [],
    chip: (p.chip as AiRecommendation["chip"]) ?? { use: "none", reasoning: "" },
    differentials_to_exploit: Array.isArray(p.differentials_to_exploit)
      ? (p.differentials_to_exploit as string[])
      : [],
    news_citations: Array.isArray(p.news_citations)
      ? (p.news_citations as AiRecommendation["news_citations"])
      : [],
    confidence: (p.confidence as AiRecommendation["confidence"]) ?? "medium",
  };
}

function extractGrounding(meta: GroundingMetadata | undefined) {
  const queries: string[] = Array.isArray(meta?.webSearchQueries) ? (meta!.webSearchQueries as string[]) : [];
  const chunks =
    (meta?.groundingChunks ?? [])
      .map((c) => ({ uri: c.web?.uri ?? "", title: c.web?.title ?? c.web?.uri ?? "" }))
      .filter((c) => c.uri) ?? [];
  return { queries, chunks };
}

export interface AskStrategistArgs {
  ctx: RivalContext;
  gw: number;
  deadline: string;
  userProjection: SquadProjection;
  rivalProjections: SquadProjection[];
  overtake: OvertakeOdds[];
  bank: number;
  freeTransfers: number;
  shortlist: TransferSuggestion[];
  differentials: {
    userOnly: Array<{ name: string; xPts: number }>;
    rivalOnly: Array<{ name: string; rival: string; xPts: number }>;
  };
}

export async function askStrategist(args: AskStrategistArgs): Promise<AiResult> {
  const ai = client();
  const userPrompt = buildUserPrompt({
    gw: args.gw,
    deadline: args.deadline,
    leagueName: args.ctx.leagueName,
    user: args.ctx.user,
    rivals: args.ctx.rivals,
    userProjection: args.userProjection,
    rivalProjections: args.rivalProjections,
    overtake: args.overtake,
    bank: args.bank,
    freeTransfers: args.freeTransfers,
    shortlist: args.shortlist,
    differentials: args.differentials,
  });

  const model = env.GEMINI_MODEL;
  const response = await ai.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.4,
      tools: [{ googleSearch: {} }],
    },
  });

  const text = response.text ?? "";
  const parsed = extractJsonBlock(text);
  const recommendation = coerceRecommendation(parsed);
  const grounding = extractGrounding(response.candidates?.[0]?.groundingMetadata);

  // Backfill source_url on citations from grounding chunks where the AI omitted them.
  if (recommendation.news_citations.length && grounding.chunks.length) {
    recommendation.news_citations = recommendation.news_citations.map((c, i) => ({
      ...c,
      source_url: c.source_url || grounding.chunks[i]?.uri,
    }));
  }

  return {
    recommendation,
    raw: text,
    searchQueries: grounding.queries,
    groundingChunks: grounding.chunks,
    model,
  };
}

// Unused-export guard so TypeScript still references the types for editors.
export type { ManagerSquad };
