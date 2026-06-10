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

  const response = await ai.models.generateContent({
    model,
    contents: args.userPrompt,
    config: {
      systemInstruction: args.systemInstruction,
      temperature: 0.3,
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingBudget: args.thinkingBudget ?? 2048 },
      maxOutputTokens: 16384,
    },
  });

  let { text, finishReason, candidate } = extractText(response);
  let usedResponse = response;

  if (!text) {
    // Grounded call produced no usable text — retry once without googleSearch,
    // trading live news for a guaranteed answer.
    const fallback = await ai.models.generateContent({
      model,
      contents: args.userPrompt,
      config: {
        systemInstruction: args.systemInstruction,
        temperature: 0.3,
        thinkingConfig: { thinkingBudget: 1024 },
        maxOutputTokens: 16384,
        responseMimeType: "application/json",
      },
    });
    ({ text, finishReason, candidate } = extractText(fallback));
    usedResponse = fallback;
  }

  if (!text) {
    const err = new Error(
      `Gemini returned no text content (finishReason=${finishReason}). ` +
        `This usually means a safety/recitation block or a quota issue.`,
    );
    (err as Error & { rawText?: string }).rawText = JSON.stringify(
      { finishReason, safetyRatings: candidate?.safetyRatings, promptFeedback: usedResponse.promptFeedback },
      null,
      2,
    );
    throw err;
  }

  let parsedJson: unknown;
  try {
    parsedJson = extractJsonBlock(text);
  } catch (firstErr) {
    const reformat = await ai.models.generateContent({
      model,
      contents:
        `The following text was meant to be a JSON object matching a schema, but failed to parse. ` +
        `Re-emit it as a single valid JSON object. Output NOTHING except the JSON — no prose, no markdown ` +
        `fences, no comments. If a field is missing, fill with a sensible default ("", [], "medium", "none"). ` +
        `Preserve every concrete recommendation from the source text.\n\nSOURCE:\n${text.slice(0, 12000)}`,
      config: { temperature: 0.0, responseMimeType: "application/json" },
    });
    try {
      parsedJson = extractJsonBlock(reformat.text ?? "");
    } catch {
      throw firstErr;
    }
  }

  const grounding = extractGrounding(usedResponse.candidates?.[0]?.groundingMetadata);
  return {
    parsed: args.coerce(parsedJson),
    raw: text,
    searchQueries: grounding.queries,
    groundingChunks: grounding.chunks,
    model,
  };
}
