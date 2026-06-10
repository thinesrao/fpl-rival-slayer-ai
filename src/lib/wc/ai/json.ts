// JSON extraction + grounding helpers for Gemini responses. Copied from
// src/lib/ai/gemini.ts (where they're module-private) so the WC flows don't
// touch the FPL module; worth unifying into a shared lib later.

import type { GroundingMetadata } from "@google/genai";

function findBalancedObjects(text: string): string[] {
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

export function extractJsonBlock(text: string): unknown {
  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct !== null) return direct;

  const fenceRe = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  for (const m of text.matchAll(fenceRe)) {
    const parsed = tryParse(m[1].trim());
    if (parsed !== null) return parsed;
  }

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

export function extractGrounding(meta: GroundingMetadata | undefined) {
  const queries: string[] = Array.isArray(meta?.webSearchQueries)
    ? (meta!.webSearchQueries as string[])
    : [];
  const chunks =
    (meta?.groundingChunks ?? [])
      .map((c) => ({ uri: c.web?.uri ?? "", title: c.web?.title ?? c.web?.uri ?? "" }))
      .filter((c) => c.uri) ?? [];
  return { queries, chunks };
}
