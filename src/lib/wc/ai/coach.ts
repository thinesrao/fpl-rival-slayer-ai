// AI Matchday Coach: transfer advice within the free-transfer allowance, a
// kickoff-ordered captain-rotation plan, bench order, and booster strategy —
// all grounded in the live digest + web search, all token-reconciled.

import type { WcContext } from "@/lib/wc/context";
import { isPreTournamentLock } from "@/lib/wc/context";
import { displayName } from "@/lib/wc/fifa/client";
import type { WcSquadState } from "@/lib/wc/squad/types";
import { validateWcSquad } from "@/lib/wc/rules/validate";
import { projectAll } from "@/lib/wc/projections/model";
import { BOOSTER_LABELS, type BoosterId } from "@/lib/wc/rules/config";
import { buildWcDigest } from "@/lib/wc/digest";
import { askGroundedJson } from "./gemini";
import { parsePlayerToken, playerLine } from "./prompts";

interface CoachAiOutput {
  transfers: Array<{ out_token: string; in_token: string; reason: string; hit_cost?: number }>;
  captain_plan: Array<{
    kickoff: string;
    captain_token: string;
    condition: string;
    rationale: string;
  }>;
  bench_order_tokens: string[];
  booster: { use: BoosterId | "none"; reasoning: string };
  watchouts: string[];
  news_citations: Array<{ player: string; summary: string; source_url?: string }>;
  overall: string;
  confidence: "low" | "medium" | "high";
}

/** Compact memory of the last plan we gave this user — injected into the next
 *  run so advice stays consistent (or explains why it changed). */
export interface CoachMemory {
  at: string;
  roundId: number;
  overall: string;
  transfers: string[];
  captainPlan: string[];
  booster: string;
}

export function toCoachMemory(result: CoachResult, roundId: number): CoachMemory {
  return {
    at: new Date().toISOString(),
    roundId,
    overall: result.overall,
    transfers: result.transfers.map((t) => `${t.out} → ${t.in}${t.legal ? "" : " (rejected)"}`),
    captainPlan: result.captainPlan.map((c) => `${c.player} (${c.condition})`),
    booster: result.booster.label,
  };
}

export interface CoachResult {
  transfers: Array<{
    outId: number;
    inId: number;
    out: string;
    in: string;
    reason: string;
    hitCost: number;
    legal: boolean;
    whyIllegal?: string;
    /** Set when the server auto-repaired an illegal AI proposal. */
    adjusted?: string;
  }>;
  captainPlan: Array<{ playerId: number | null; player: string; kickoff: string; condition: string; rationale: string }>;
  benchOrder: number[];
  booster: { use: BoosterId | "none"; label: string; reasoning: string; allowed: boolean };
  watchouts: string[];
  newsCitations: Array<{ player: string; summary: string; source_url?: string }>;
  overall: string;
  confidence: string;
  searchQueries: string[];
  groundingChunks: Array<{ uri: string; title: string }>;
  freeTransfers: number | "unlimited";
}

function coerceCoach(parsed: unknown): CoachAiOutput {
  const p = parsed as Partial<CoachAiOutput> & Record<string, unknown>;
  return {
    transfers: Array.isArray(p.transfers) ? (p.transfers as CoachAiOutput["transfers"]) : [],
    captain_plan: Array.isArray(p.captain_plan) ? (p.captain_plan as CoachAiOutput["captain_plan"]) : [],
    bench_order_tokens: Array.isArray(p.bench_order_tokens) ? (p.bench_order_tokens as string[]) : [],
    booster: (p.booster as CoachAiOutput["booster"]) ?? { use: "none", reasoning: "" },
    watchouts: Array.isArray(p.watchouts) ? (p.watchouts as string[]) : [],
    news_citations: Array.isArray(p.news_citations) ? (p.news_citations as CoachAiOutput["news_citations"]) : [],
    overall: String(p.overall ?? ""),
    confidence: (p.confidence as CoachAiOutput["confidence"]) ?? "medium",
  };
}

function coachSystemInstruction(): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `You are an elite FIFA World Cup 2026 Fantasy matchday coach. Today is ${today}.`,
    `Your training data is stale for this tournament — verify injuries, suspensions, rotation and`,
    `predicted lineups with web search before advising. The CONTEXT block below is live official data; trust it.`,
    `KEY WC-SPECIFIC META (encode in your plan):`,
    `1. CAPTAIN ROTATION: captaincy can be MOVED during a live round to any player who hasn't played yet.`,
    `   Always produce a captain_plan ordered by kickoff: open with a premium in an early match; for each step,`,
    `   give the condition to keep or move the armband (e.g. "if he returns ≤4 pts, switch to X at 20:00").`,
    `2. BENCH SUBS work the same mid-round — flag bench plays if a starter is benched IRL.`,
    `3. TRANSFERS: stay within the free allowance unless a hit is clearly +EV; state hit_cost honestly.`,
    `4. BOOSTERS: Wildcard best near round 3 (qualified teams rotate); Qualification Booster best at the R32`,
    `   (most lopsided ties, up to +22); Maximum Captain for coin-flip slates; 12th Man when the bench is strong.`,
    `   Recommend "none" freely — boosters are scarce.`,
    `5. SCOUTING BONUS: +2 for <5%-owned players scoring 4+; flag differential opportunities.`,
    `Reference players ONLY by P-number tokens from the context. Respond with a single JSON object only.`,
  ].join("\n");
}

export async function runCoach(
  ctx: WcContext,
  squad: WcSquadState,
  memory?: CoachMemory | null,
): Promise<CoachResult> {
  const digest = await buildWcDigest(ctx, squad);
  const completedRounds = ctx.rounds.filter((r) => r.status === "complete").length;
  const projections = projectAll(ctx.players, ctx.target, ctx.teamIndex, completedRounds);

  // Transfer-market menu: top value players not already owned.
  const market = ctx.players
    .filter((p) => p.status === "playing" && !squad.picks.includes(p.id) && projections.has(p.id))
    .sort((a, b) => projections.get(b.id)!.value - projections.get(a.id)!.value)
    .slice(0, 50);

  const rules = ctx.targetRules;
  const transfersMade = squad.transfersByRound[ctx.target.id]?.length ?? 0;
  // Before the Round 1 lock the squad isn't locked at all — the user is still
  // freely building the initial 15. Transfer limits only start at MD2.
  const preLock = isPreTournamentLock(ctx);
  const freeLeft =
    preLock || rules.unlimitedTransferWindow
      ? ("unlimited" as const)
      : Math.max(0, rules.freeTransfers - transfersMade);

  // Exact constraint numbers — the model is bad at deriving these itself.
  const squadPlayers = squad.picks
    .map((id) => ctx.playerById.get(id))
    .filter((p): p is NonNullable<ReturnType<typeof ctx.playerById.get>> => Boolean(p));
  const squadCost = Math.round(squadPlayers.reduce((s, p) => s + p.price, 0) * 10) / 10;
  const bank = Math.round((rules.budget - squadCost) * 10) / 10;
  const nationCounts = new Map<string, number>();
  for (const p of squadPlayers) {
    const abbr = ctx.teamIndex.byId.get(p.squadId)?.abbr ?? "?";
    nationCounts.set(abbr, (nationCounts.get(abbr) ?? 0) + 1);
  }
  const constraintLines = [
    `EXACT CONSTRAINTS (use these numbers, do not estimate):`,
    `  Squad cost $${squadCost}m of $${rules.budget}m budget → BANK: $${bank.toFixed(1)}m.`,
    `  A swap is affordable only if in.price ≤ out.price + ${bank.toFixed(1)} (recompute bank after each swap).`,
    `  Nation counts (max ${rules.maxPerNation}): ${[...nationCounts.entries()].map(([a, n]) => `${a}:${n}`).join(" ")}.`,
    `  Positions shown are THIS GAME's official listings and may differ from real-world roles —`,
    `  out and in MUST have the same listed position (GK/DEF/MID/FWD as printed on each line).`,
  ].join("\n");

  const transferStateLine = preLock
    ? `SQUAD NOT LOCKED YET: this is Matchday 1 BEFORE the deadline (${ctx.targetLockIso}). The user can still ` +
      `change ANY number of players, captain, bench and formation freely with NO transfer cost — these are not ` +
      `"transfers", it's initial squad selection. Transfer limits (2 free per matchday) only begin once Round 1 ` +
      `locks. Recommend as many changes as genuinely improve the squad.`
    : `FREE TRANSFERS REMAINING THIS ROUND: ${freeLeft}.`;

  const memoryBlock =
    memory && memory.captainPlan.length + memory.transfers.length > 0
      ? [
          ``,
          `YOUR PREVIOUS PLAN (round ${memory.roundId}, ${memory.at.slice(0, 16)}Z) — keep continuity; if you change advice, say what new information changed it:`,
          `  strategy: ${memory.overall.slice(0, 300)}`,
          memory.transfers.length ? `  transfers advised: ${memory.transfers.join("; ")}` : "",
          memory.captainPlan.length ? `  captain plan: ${memory.captainPlan.join(" → ")}` : "",
          `  booster: ${memory.booster}`,
        ].filter(Boolean)
      : [];

  const userPrompt = [
    `CONTEXT (live official data):`,
    digest,
    ...memoryBlock,
    ``,
    `TRANSFER MARKET (best available by our value model):`,
    ...market.map((p) => `  ${playerLine(p, ctx.teamIndex, ctx.target)}`),
    ``,
    constraintLines,
    ``,
    transferStateLine,
    ``,
    `TASK: search the news, then produce this round's plan. Respond with ONLY this JSON:`,
    `{`,
    `  "transfers": [{ "out_token": "P1", "in_token": "P2", "reason": "...", "hit_cost": 0 }],`,
    `  "captain_plan": [{ "kickoff": "ISO datetime", "captain_token": "P1", "condition": "open with him" | "if previous captain scored <X, move here", "rationale": "..." }],`,
    `  "bench_order_tokens": ["P1","P2","P3","P4"],`,
    `  "booster": { "use": "wildcard"|"twelfth_man"|"max_captain"|"qualification"|"mystery"|"none", "reasoning": "..." },`,
    `  "watchouts": ["..."],`,
    `  "news_citations": [{ "player": "...", "summary": "...", "source_url": "..." }],`,
    `  "overall": "2-3 sentence round strategy",`,
    `  "confidence": "low"|"medium"|"high"`,
    `}`,
  ].join("\n");

  const result = await askGroundedJson<CoachAiOutput>({
    systemInstruction: coachSystemInstruction(),
    userPrompt,
    coerce: coerceCoach,
  });
  const ai = result.parsed;

  // Reconcile transfers: token-resolve, then test each sequentially against the rules.
  let workingPicks = [...squad.picks];
  const transfers: CoachResult["transfers"] = [];
  for (const t of ai.transfers) {
    const outId = parsePlayerToken(t.out_token);
    const inId = parsePlayerToken(t.in_token);
    const outP = outId != null ? ctx.playerById.get(outId) : undefined;
    const inP = inId != null ? ctx.playerById.get(inId) : undefined;
    if (!outP || !inP || !workingPicks.includes(outP.id) || workingPicks.includes(inP.id)) {
      transfers.push({
        outId: outId ?? -1,
        inId: inId ?? -1,
        out: outP ? displayName(outP) : t.out_token,
        in: inP ? displayName(inP) : t.in_token,
        reason: t.reason ?? "",
        hitCost: t.hit_cost ?? 0,
        legal: false,
        whyIllegal: "unknown token or player not in/already in squad",
      });
      continue;
    }
    const trial = workingPicks.map((id) => (id === outP.id ? inP.id : id));
    const check = validateWcSquad(trial, ctx.playerById, ctx.teamIndex.byId, rules);
    const positionOk = outP.position === inP.position;

    if (check.ok && positionOk) {
      workingPicks = trial;
      transfers.push({
        outId: outP.id,
        inId: inP.id,
        out: displayName(outP),
        in: displayName(inP),
        reason: t.reason ?? "",
        hitCost: t.hit_cost ?? 0,
        legal: true,
      });
      continue;
    }

    // Auto-repair instead of rejecting — preserve the AI's intent.
    const proj = (id: number) => projections.get(id)?.xPts ?? 0;
    let repaired: { out: typeof outP; in: typeof inP; note: string } | null = null;

    if (!positionOk) {
      // The AI wants `inP` but targeted an OUT at a different position. Sell
      // the weakest same-position-as-IN player from the squad instead.
      const candidates = workingPicks
        .map((id) => ctx.playerById.get(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .filter((p) => p.position === inP.position && p.id !== inP.id)
        .sort((a, b) => proj(a.id) - proj(b.id));
      for (const cand of candidates) {
        const t2 = workingPicks.map((id) => (id === cand.id ? inP.id : id));
        if (validateWcSquad(t2, ctx.playerById, ctx.teamIndex.byId, rules).ok) {
          repaired = {
            out: cand,
            in: inP,
            note: `${displayName(outP)} plays ${outP.position} — sold ${displayName(cand)} (${inP.position}) instead to fit ${displayName(inP)}`,
          };
          break;
        }
      }
    }

    if (!repaired) {
      // Budget / nation-cap failure (or no position repair found): keep the
      // AI's OUT but swap the IN for the best same-position market player
      // that passes validation.
      const outFinal = outP;
      const alternatives = market
        .filter((p) => p.position === outFinal.position && !workingPicks.includes(p.id))
        .sort((a, b) => proj(b.id) - proj(a.id));
      for (const alt of alternatives) {
        const t2 = workingPicks.map((id) => (id === outFinal.id ? alt.id : id));
        if (validateWcSquad(t2, ctx.playerById, ctx.teamIndex.byId, rules).ok) {
          repaired = {
            out: outFinal,
            in: alt,
            note: `${displayName(inP)} broke the rules (${positionOk ? check.errors.join("; ") : "position mismatch"}) — ${displayName(alt)} is the best legal alternative`,
          };
          break;
        }
      }
    }

    if (repaired) {
      workingPicks = workingPicks.map((id) => (id === repaired!.out.id ? repaired!.in.id : id));
      transfers.push({
        outId: repaired.out.id,
        inId: repaired.in.id,
        out: displayName(repaired.out),
        in: displayName(repaired.in),
        reason: t.reason ?? "",
        hitCost: t.hit_cost ?? 0,
        legal: true,
        adjusted: repaired.note,
      });
    } else {
      transfers.push({
        outId: outP.id,
        inId: inP.id,
        out: displayName(outP),
        in: displayName(inP),
        reason: t.reason ?? "",
        hitCost: t.hit_cost ?? 0,
        legal: false,
        whyIllegal: positionOk ? check.errors.join("; ") : "position mismatch",
      });
    }
  }

  const captainPlan = ai.captain_plan.map((c) => {
    const id = parsePlayerToken(c.captain_token);
    const p = id != null ? ctx.playerById.get(id) : undefined;
    return {
      playerId: p?.id ?? null,
      player: p ? displayName(p) : c.captain_token,
      kickoff: c.kickoff ?? "",
      condition: c.condition ?? "",
      rationale: c.rationale ?? "",
    };
  });

  const benchOrder = ai.bench_order_tokens
    .map(parsePlayerToken)
    .filter((id): id is number => id != null && squad.picks.includes(id));

  const boosterUse = ai.booster?.use ?? "none";
  const boosterAllowed =
    boosterUse === "none" ||
    (rules.boostersAllowed.includes(boosterUse) && squad.boostersUsed[boosterUse] == null);

  return {
    transfers,
    captainPlan,
    benchOrder,
    booster: {
      use: boosterUse,
      label: boosterUse === "none" ? "No booster" : BOOSTER_LABELS[boosterUse],
      reasoning: ai.booster?.reasoning ?? "",
      allowed: boosterAllowed,
    },
    watchouts: ai.watchouts,
    newsCitations: ai.news_citations,
    overall: ai.overall,
    confidence: ai.confidence,
    searchQueries: result.searchQueries,
    groundingChunks: result.groundingChunks,
    freeTransfers: freeLeft,
  };
}
