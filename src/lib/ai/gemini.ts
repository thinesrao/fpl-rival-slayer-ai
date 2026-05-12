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

function findBalancedObjects(text: string): string[] {
  // Walk the string string-aware, returning every top-level `{...}` slice.
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) depth--;
      if (depth === 0 && start !== -1) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return results;
}

function tryParse(candidate: string): unknown | null {
  try {
    return JSON.parse(candidate);
  } catch {
    // Try simple repairs: smart quotes, trailing commas.
    const repaired = candidate
      .replace(/,(\s*[}\]])/g, "$1")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    try {
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

function extractJsonBlock(text: string): unknown {
  const trimmed = text.trim();
  // 1) Direct parse (model returned strict JSON).
  const direct = tryParse(trimmed);
  if (direct !== null) return direct;

  // 2) Every fenced block, in order — try each body.
  const fenceRe = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  const fenceMatches = [...text.matchAll(fenceRe)];
  for (const m of fenceMatches) {
    const parsed = tryParse(m[1].trim());
    if (parsed !== null) return parsed;
  }

  // 3) Balanced { ... } objects, largest first (the schema object is usually the biggest).
  const candidates = findBalancedObjects(text).sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    const parsed = tryParse(c);
    if (parsed !== null) return parsed;
  }

  const sample = trimmed.length > 400 ? `${trimmed.slice(0, 400)}…[+${trimmed.length - 400}b]` : trimmed;
  const err = new Error(`Gemini response did not contain a parseable JSON object. Sample: ${sample}`);
  (err as Error & { rawText?: string }).rawText = text;
  throw err;
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
      temperature: 0.3,
      tools: [{ googleSearch: {} }],
    },
  });

  const text = response.text ?? "";
  let parsed: unknown;
  try {
    parsed = extractJsonBlock(text);
  } catch (firstErr) {
    // Reformat-only retry: no tools, low temperature, strict JSON prompt.
    // We still keep the original grounding metadata (the search was already done).
    const reformat = await ai.models.generateContent({
      model,
      contents: `The following text was meant to be a JSON object matching a schema, but failed to parse. Re-emit it as a single valid JSON object. Output NOTHING except the JSON — no prose, no markdown fences, no comments. If a field is missing, fill with a sensible default ("", [], "medium", "none"). Preserve every concrete recommendation (transfers, captain, citations) from the source text.\n\nSOURCE:\n${text.slice(0, 12000)}`,
      config: { temperature: 0.0, responseMimeType: "application/json" },
    });
    try {
      parsed = extractJsonBlock(reformat.text ?? "");
    } catch {
      // Surface the original error (with raw sample) so the route can return it.
      throw firstErr;
    }
  }

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
