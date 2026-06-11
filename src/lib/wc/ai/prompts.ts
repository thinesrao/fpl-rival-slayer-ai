// Prompt builders for the WC26 AI flows. Players are always referenced by
// stable P{id} tokens — the server resolves tokens back to real players, so
// a hallucinated name can never enter the squad.

import type { WcPlayer, WcRound } from "@/lib/wc/fifa/types";
import type { WcTeamIndex } from "@/lib/wc/fifa/teams";
import { displayName } from "@/lib/wc/fifa/client";
import { scoringDigest } from "@/lib/wc/rules/scoring";
import { BOOSTER_LABELS, type WcRoundRules } from "@/lib/wc/rules/config";
import { opponentInRound } from "@/lib/wc/context";
import type { CandidateSquad } from "@/lib/wc/optimizer/draft";

export function playerToken(id: number): string {
  return `P${id}`;
}

export function parsePlayerToken(token: unknown): number | null {
  if (typeof token !== "string") return null;
  const m = /^P(\d+)$/.exec(token.trim());
  return m ? Number(m[1]) : null;
}

export function playerLine(
  p: WcPlayer,
  teamIndex: WcTeamIndex,
  round: WcRound,
): string {
  const team = teamIndex.byId.get(p.squadId);
  const opp = opponentInRound(round, p.squadId);
  const bits = [
    playerToken(p.id),
    displayName(p),
    `${team?.abbr ?? "?"}`,
    p.position,
    `$${p.price.toFixed(1)}m`,
    `own ${p.percentSelected.toFixed(1)}%`,
  ];
  if (p.stats.totalPoints > 0) bits.push(`${p.stats.totalPoints}pts`);
  if (opp) bits.push(opp.label);
  if (p.oneToWatch) bits.push("⭐one-to-watch");
  if (p.status !== "playing") bits.push(`STATUS:${p.status}`);
  return bits.join(" | ");
}

export function rulesDigest(rules: WcRoundRules): string {
  const ft = rules.unlimitedTransferWindow
    ? "UNLIMITED free transfers this window"
    : `${rules.freeTransfers} free transfers (${rules.extraTransferPenalty} pts per extra)`;
  return [
    `OFFICIAL RULES (${rules.label}): 15-player squad = 2 GK / 5 DEF / 5 MID / 3 FWD.`,
    `Budget $${rules.budget}m. Max ${rules.maxPerNation} players per nation. Prices are FIXED all tournament.`,
    `${ft}.`,
    `Boosters available this round: ${rules.boostersAllowed.map((b) => BOOSTER_LABELS[b]).join(", ") || "none"}.`,
    `Captaincy and bench subs CAN be changed DURING a live round onto players who haven't played yet — `,
    `the optimal meta is captain-rotation: captain a premium in the earliest kickoff, move the armband to a `,
    `later-playing star if he blanks.`,
    scoringDigest(),
  ].join(" ");
}

export function draftSystemInstruction(deadlineIso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `You are an elite FIFA World Cup 2026 Fantasy strategist (official game at play.fifa.com/fantasy).`,
    `Today is ${today}. Matchday 1 locks at ${deadlineIso}.`,
    `Your training data predates the final 26-man squad announcements, late injuries, and confirmed`,
    `starting lineups — you MUST use web search to verify availability and starter status before`,
    `recommending any player. Search for: confirmed squads, this week's injury news, predicted MD1`,
    `lineups for the favourites, and penalty/set-piece takers.`,
    `Reference players ONLY by their P-number token from the menus provided. Never invent players.`,
    `Respond with a single JSON object matching the requested schema and nothing else.`,
  ].join(" ");
}

export function buildDraftPrompt(args: {
  candidates: CandidateSquad[];
  swapMenu: WcPlayer[];
  playerById: Map<number, WcPlayer>;
  teamIndex: WcTeamIndex;
  round: WcRound;
  rules: WcRoundRules;
}): string {
  const { candidates, swapMenu, playerById, teamIndex, round, rules } = args;
  const labels = ["A", "B", "C"];

  const candidateBlocks = candidates
    .map((c, i) => {
      const lines = c.picks
        .map((id) => playerById.get(id))
        .filter((p): p is WcPlayer => Boolean(p))
        .map((p) => {
          const starter = c.startingXI.includes(p.id) ? "XI" : "BENCH";
          const cap = p.id === c.captainId ? " (C)" : p.id === c.viceId ? " (VC)" : "";
          return `  ${starter}${cap} ${playerLine(p, teamIndex, round)}`;
        })
        .join("\n");
      return `SQUAD ${labels[i]} — ${c.label.toUpperCase()}: ${c.description}\nCost $${c.totalCost}m | projected ${c.projectedPoints} pts\n${lines}`;
    })
    .join("\n\n");

  const menuByPos = ["GK", "DEF", "MID", "FWD"]
    .map((pos) => {
      const rows = swapMenu
        .filter((p) => p.position === pos)
        .map((p) => `  ${playerLine(p, teamIndex, round)}`)
        .join("\n");
      return `${pos}:\n${rows}`;
    })
    .join("\n");

  return [
    rulesDigest(rules),
    ``,
    `Below are three rule-valid candidate squads built by a price/fixture optimizer (it cannot read the news — that's your job).`,
    ``,
    candidateBlocks,
    ``,
    `SWAP MENU — strongest alternatives per position (you may swap any candidate player for one of these):`,
    menuByPos,
    ``,
    `TASK: Search the web for current news, then pick the best base squad and refine it.`,
    `1. Verify every player you keep is in his confirmed squad, fit, and expected to START MD1. Swap out doubts.`,
    `2. CRITICAL swap legality (illegal swaps are discarded server-side, leaving the weaker player in!):`,
    `   out and in MUST have the same listed position (the GK/DEF/MID/FWD printed on each line — this game's`,
    `   labels can differ from real-world roles); after EACH swap, recompute total cost (price deltas are shown)`,
    `   and keep it ≤ $${rules.budget}m and ≤ ${rules.maxPerNation}/nation. Prefer a cheaper in-player or a second`,
    `   downgrade swap to fund an upgrade.`,
    `3. Captain: highest-ceiling premium in an early MD1 kickoff (captain-rotation meta). Vice from a later match.`,
    `4. Flag 1-2 low-ownership (<5%) picks with real Scouting Bonus upside.`,
    ``,
    `Respond with ONLY this JSON:`,
    `{`,
    `  "chosen_base": "A" | "B" | "C",`,
    `  "swaps": [{ "out_token": "P123", "in_token": "P456", "reason": "..." }],`,
    `  "captain_token": "P123", "vice_token": "P456",`,
    `  "starting_xi_tokens": ["P1", ...11 tokens...],`,
    `  "bench_order_tokens": [...4 tokens, backup GK last...],`,
    `  "per_pick_notes": [{ "token": "P123", "note": "one-line rationale" }],`,
    `  "risks": ["..."],`,
    `  "news_citations": [{ "player": "name", "summary": "what the news says", "source_url": "https://..." }],`,
    `  "overall_strategy": "2-3 sentences",`,
    `  "confidence": "low" | "medium" | "high"`,
    `}`,
  ].join("\n");
}
