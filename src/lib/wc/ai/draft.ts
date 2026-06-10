// AI MD1 draft flow: optimizer candidates → grounded Gemini review → token
// reconciliation → rules re-validation (illegal swaps reverted, never trusted).

import type { WcContext } from "@/lib/wc/context";
import { displayName } from "@/lib/wc/fifa/client";
import type { WcPlayer } from "@/lib/wc/fifa/types";
import { validateWcSquad, validateWcLineup } from "@/lib/wc/rules/validate";
import { buildCandidates, pickLineup, type CandidateSquad } from "@/lib/wc/optimizer/draft";
import { projectAll } from "@/lib/wc/projections/model";
import { askGroundedJson } from "./gemini";
import { buildDraftPrompt, draftSystemInstruction, parsePlayerToken } from "./prompts";

interface DraftAiOutput {
  chosen_base: "A" | "B" | "C";
  swaps: Array<{ out_token: string; in_token: string; reason: string }>;
  captain_token: string;
  vice_token: string;
  starting_xi_tokens: string[];
  bench_order_tokens: string[];
  per_pick_notes: Array<{ token: string; note: string }>;
  risks: string[];
  news_citations: Array<{ player: string; summary: string; source_url?: string }>;
  overall_strategy: string;
  confidence: "low" | "medium" | "high";
}

export interface DraftResult {
  squad: {
    picks: number[];
    startingXI: number[];
    bench: number[];
    captainId: number;
    viceId: number;
    totalCost: number;
  };
  baseLabel: CandidateSquad["label"];
  appliedSwaps: Array<{ out: string; in: string; reason: string }>;
  revertedSwaps: Array<{ out: string; in: string; reason: string; whyReverted: string }>;
  perPickNotes: Array<{ playerId: number; note: string }>;
  risks: string[];
  newsCitations: Array<{ player: string; summary: string; source_url?: string }>;
  overallStrategy: string;
  confidence: string;
  searchQueries: string[];
  groundingChunks: Array<{ uri: string; title: string }>;
  candidates: CandidateSquad[];
  aiUsed: boolean;
}

function coerceDraft(parsed: unknown): DraftAiOutput {
  const p = parsed as Partial<DraftAiOutput> & Record<string, unknown>;
  return {
    chosen_base: (["A", "B", "C"].includes(String(p.chosen_base)) ? p.chosen_base : "A") as "A" | "B" | "C",
    swaps: Array.isArray(p.swaps) ? (p.swaps as DraftAiOutput["swaps"]) : [],
    captain_token: String(p.captain_token ?? ""),
    vice_token: String(p.vice_token ?? ""),
    starting_xi_tokens: Array.isArray(p.starting_xi_tokens) ? (p.starting_xi_tokens as string[]) : [],
    bench_order_tokens: Array.isArray(p.bench_order_tokens) ? (p.bench_order_tokens as string[]) : [],
    per_pick_notes: Array.isArray(p.per_pick_notes) ? (p.per_pick_notes as DraftAiOutput["per_pick_notes"]) : [],
    risks: Array.isArray(p.risks) ? (p.risks as string[]) : [],
    news_citations: Array.isArray(p.news_citations) ? (p.news_citations as DraftAiOutput["news_citations"]) : [],
    overall_strategy: String(p.overall_strategy ?? ""),
    confidence: (p.confidence as DraftAiOutput["confidence"]) ?? "medium",
  };
}

export async function runAiDraft(ctx: WcContext, useAi: boolean): Promise<DraftResult> {
  const completedRounds = ctx.rounds.filter((r) => r.status === "complete").length;
  const candidates = buildCandidates(
    ctx.players,
    ctx.target,
    ctx.teamIndex,
    ctx.targetRules,
    completedRounds,
  );
  if (candidates.length === 0) throw new Error("Optimizer produced no valid candidate squads");

  // Swap menu: top value players per position not exhausted by candidates.
  const projections = projectAll(ctx.players, ctx.target, ctx.teamIndex, completedRounds);
  const swapMenu = ctx.players
    .filter((p) => p.status === "playing" && projections.has(p.id))
    .sort((a, b) => projections.get(b.id)!.value - projections.get(a.id)!.value)
    .slice(0, 60);

  if (!useAi) {
    return optimizerOnlyResult(candidates);
  }

  const result = await askGroundedJson<DraftAiOutput>({
    systemInstruction: draftSystemInstruction(ctx.targetLockIso),
    userPrompt: buildDraftPrompt({
      candidates,
      swapMenu,
      playerById: ctx.playerById,
      teamIndex: ctx.teamIndex,
      round: ctx.target,
      rules: ctx.targetRules,
    }),
    coerce: coerceDraft,
  });
  const ai = result.parsed;

  const baseIdx = { A: 0, B: 1, C: 2 }[ai.chosen_base] ?? 0;
  const base = candidates[Math.min(baseIdx, candidates.length - 1)];
  let picks = [...base.picks];

  // Apply swaps one at a time; re-validate after each and revert violations.
  const appliedSwaps: DraftResult["appliedSwaps"] = [];
  const revertedSwaps: DraftResult["revertedSwaps"] = [];

  for (const swap of ai.swaps) {
    const outId = parsePlayerToken(swap.out_token);
    const inId = parsePlayerToken(swap.in_token);
    const outP = outId != null ? ctx.playerById.get(outId) : undefined;
    const inP = inId != null ? ctx.playerById.get(inId) : undefined;
    const record = {
      out: outP ? displayName(outP) : String(swap.out_token),
      in: inP ? displayName(inP) : String(swap.in_token),
      reason: swap.reason ?? "",
    };

    if (!outP || !inP || !picks.includes(outP.id) || picks.includes(inP.id)) {
      revertedSwaps.push({ ...record, whyReverted: "unknown token or player not in/already in squad" });
      continue;
    }
    if (outP.position !== inP.position) {
      revertedSwaps.push({ ...record, whyReverted: "position mismatch" });
      continue;
    }
    if (inP.status !== "playing") {
      revertedSwaps.push({ ...record, whyReverted: `incoming player status is "${inP.status}"` });
      continue;
    }
    const trial = picks.map((id) => (id === outP.id ? inP.id : id));
    const check = validateWcSquad(trial, ctx.playerById, ctx.teamIndex.byId, ctx.targetRules);
    if (!check.ok) {
      revertedSwaps.push({ ...record, whyReverted: check.errors.join("; ") });
      continue;
    }
    picks = trial;
    appliedSwaps.push(record);
  }

  // Lineup: trust the AI's XI when it's a legal arrangement of the final
  // picks; otherwise rebuild from projections.
  const squadPlayers = picks
    .map((id) => ctx.playerById.get(id))
    .filter((p): p is WcPlayer => Boolean(p));
  const aiXi = ai.starting_xi_tokens
    .map(parsePlayerToken)
    .filter((id): id is number => id != null && picks.includes(id));
  const aiBench = ai.bench_order_tokens
    .map(parsePlayerToken)
    .filter((id): id is number => id != null && picks.includes(id) && !aiXi.includes(id));
  let captainId = parsePlayerToken(ai.captain_token);
  let viceId = parsePlayerToken(ai.vice_token);

  let startingXI: number[];
  let bench: number[];
  const lineupCheck =
    aiXi.length === 11 && aiBench.length === 4
      ? validateWcLineup(aiXi, aiBench, captainId, viceId, ctx.playerById)
      : { ok: false, errors: ["AI lineup incomplete"] };

  if (lineupCheck.ok) {
    startingXI = aiXi;
    bench = aiBench;
  } else {
    const score = (p: WcPlayer) => projections.get(p.id)?.xPts ?? 0;
    const built = pickLineup(squadPlayers, score);
    startingXI = built.startingXI.map((p) => p.id);
    bench = built.bench.map((p) => p.id);
    if (captainId == null || !startingXI.includes(captainId)) captainId = startingXI[0];
    if (viceId == null || viceId === captainId || !startingXI.includes(viceId)) {
      viceId = startingXI.find((id) => id !== captainId) ?? startingXI[1];
    }
  }
  if (captainId == null || !startingXI.includes(captainId)) captainId = startingXI[0];
  if (viceId == null || viceId === captainId || !startingXI.includes(viceId)) {
    viceId = startingXI.find((id) => id !== captainId)!;
  }

  const totalCost =
    Math.round(squadPlayers.reduce((s, p) => s + p.price, 0) * 10) / 10;

  return {
    squad: { picks, startingXI, bench, captainId, viceId, totalCost },
    baseLabel: base.label,
    appliedSwaps,
    revertedSwaps,
    perPickNotes: ai.per_pick_notes
      .map((n) => ({ playerId: parsePlayerToken(n.token), note: n.note }))
      .filter((n): n is { playerId: number; note: string } => n.playerId != null)
      .map((n) => ({ playerId: n.playerId, note: n.note })),
    risks: ai.risks,
    newsCitations: ai.news_citations,
    overallStrategy: ai.overall_strategy,
    confidence: ai.confidence,
    searchQueries: result.searchQueries,
    groundingChunks: result.groundingChunks,
    candidates,
    aiUsed: true,
  };

  function optimizerOnlyResult(cands: CandidateSquad[]): DraftResult {
    const best = cands[0];
    return {
      squad: {
        picks: best.picks,
        startingXI: best.startingXI,
        bench: best.bench,
        captainId: best.captainId,
        viceId: best.viceId,
        totalCost: best.totalCost,
      },
      baseLabel: best.label,
      appliedSwaps: [],
      revertedSwaps: [],
      perPickNotes: [],
      risks: ["AI review unavailable (no GEMINI_API_KEY) — optimizer pick only, verify injury news yourself."],
      newsCitations: [],
      overallStrategy: best.description,
      confidence: "low",
      searchQueries: [],
      groundingChunks: [],
      candidates: cands,
      aiUsed: false,
    };
  }
}
