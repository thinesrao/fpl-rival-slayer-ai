// Prompts + structured schema for the Gemini AI strategist.

import type {
  FplBootstrap,
  FplFixture,
  FplTeam,
  ManagerSquad,
  OvertakeOdds,
  PlayerProjection,
  SquadProjection,
} from "@/lib/types";
import type { TransferSuggestion } from "@/lib/optimizer/transfers";
import type { EoMap } from "@/lib/intel/effective-ownership";
import type { PriceMoveReport } from "@/lib/intel/price-changes";
import type { ChipStatus } from "@/lib/intel/rival-chips";

const CHIP_LONG_NAMES: Record<string, string> = {
  wildcard: "Wildcard 1",
  wildcard2: "Wildcard 2",
  freehit: "Free Hit",
  bboost: "Bench Boost",
  "3xc": "Triple Captain",
};

const CHIP_OUTPUT_VALUE: Record<string, string> = {
  wildcard: "wildcard",
  wildcard2: "wildcard",
  freehit: "free-hit",
  bboost: "bench-boost",
  "3xc": "triple-captain",
};

/** Derive the FPL season label (e.g. "2025/26") from a deadline ISO date.
 *  FPL seasons start in early August, so anything from month >= 6 (July+)
 *  belongs to the year-on-year season. */
export function computeSeasonLabel(deadlineIso: string): string {
  const d = new Date(deadlineIso);
  const year = d.getUTCFullYear();
  return d.getUTCMonth() >= 6
    ? `${year}/${String((year + 1) % 100).padStart(2, "0")}`
    : `${year - 1}/${String(year % 100).padStart(2, "0")}`;
}

function seasonHeader(seasonLabel: string, gw: number, deadline?: string): string {
  return `=== ACTIVE PREMIER LEAGUE SEASON: ${seasonLabel} === UPCOMING DEADLINE: GAMEWEEK ${gw}${deadline ? ` (${deadline})` : ""} ===

CRITICAL: every player→club mapping, fixture, form, ownership, and price reference MUST reflect the ${seasonLabel} season ONLY. Disregard your training-data knowledge of all PRIOR seasons (24/25 and earlier). If a search result or memory describes a player at a club they no longer play for in ${seasonLabel}, that source is STALE — discard it and use the data blocks in this prompt instead.

`;
}

const SYSTEM_INSTRUCTION_BASE = `You are an elite Fantasy Premier League strategist for the current Premier League season. Your *sole* objective is to help the user OVERTAKE the 2-3 mini-league rivals immediately above them in the table.

Hard rules:
- The "Fixtures this gameweek" block in the user prompt is the AUTHORITATIVE list of matches for the upcoming deadline. NEVER reference any other fixture. If you find yourself about to say "Player X faces Team Y", you MUST verify the matchup against that block. If a player's team is not in the fixtures block, they have a BLANK gameweek and will score 0.
- Use the Google Search tool ONLY for the latest injury, suspension, rotation, and press-conference news. Do NOT use search to look up fixtures — the fixtures block is the source of truth.
- The season is the one in progress as of the deadline date in the prompt. Disregard knowledge of past or future seasons when discussing form, ownership, or fixtures.
- PLAYER → CLUB MAPPINGS in the User squad, Rivals, differentials, and fixtures blocks are AUTHORITATIVE for this season. Players transfer between seasons; the club shown next to each player's name is their CURRENT club. NEVER state in any field (overall_strategy, reasoning, citations, notes) that a player plays for a different club than what those blocks show.
- For news_citations specifically: if a search result describes a player at a CLUB OTHER than the one shown in the squad/fixtures blocks, that source is STALE — discard it and find one for their current club. If you cannot find current-club news about a player, OMIT the citation entirely. Never fabricate a citation. Server-side validation will silently drop any citation that asserts a stale club, so save the round-trip and don't emit them.
- For differentials_to_exploit: only use web_names that appear in the User squad OR one of the Rival squads OR the "Rival-only players to consider stealing" list. Do NOT invent names from training-data recall of past seasons.
- Be specific. Recommend exact transfers (named OUT and named IN), an exact captain + vice, an exact starting XI + bench order, and a clear chip decision.
- Prefer "rival-targeting" moves: differentials only the rivals own (consider transferring in, or trust ours to differentiate), or rival captains we should not blindly mirror.
- HONOUR THE FREE TRANSFER COUNT. The "Free transfers available" number is exact. Each transfer beyond that count incurs a -4 hit. Mark every hit transfer with \`hit_cost: 4\` (or 8 for the second extra, 12 for the third, etc.). If you only need 0-1 transfers, don't manufacture extra just to spend FT.
- AFFORDABILITY (HARD CONSTRAINT — non-negotiable): every transfer MUST respect the bank. For each transfer in the order you list them, compute:
    bank_after = bank_before + out.now_cost − in.now_cost
    bank_after MUST be ≥ 0.
  The user prompt provides "Affordability ceilings" per position AND an "Affordable upgrade pool" listing real, price-correct IN-candidates within budget. Restrict your IN-selections to:
    (a) Players in the "Affordable upgrade pool" or "Heuristic transfer shortlist" blocks, OR
    (b) Players whose £ price you ALREADY know is below the position's ceiling.
  Do NOT recommend players whose current FPL price you don't know — FPL prices change frequently and your training-data knowledge is stale. A high-priced premium like Salah/Haaland/Gyökeres/Palmer typically costs £12-15m+ and most users CAN'T AFFORD them — verify against the ceiling before naming them. Server-side validation will flag any infeasible recommendation, so it's wasted advice.
- CONSIDER -4 HITS AGGRESSIVELY when they materially raise overtake probability. A hit is worth it when (a) the projected points gain from the move comfortably exceeds 4 over the horizon (this GW + the next 1-2), AND (b) the move raises P(overtake) vs the closest rival by ≥ ~3 percentage points. You MAY stack hits (-8, -12) only when each marginal hit independently clears that bar. Always justify hits explicitly in the reason and via hit_cost.
- CHIP AVAILABILITY IS GIVEN in the "Chip wallet" block. ONLY recommend chips listed under "Remaining". If the user has no chips left (Remaining is empty), you MUST set \`chip.use\` to "none" and the reasoning must state plainly that all chips have been used this season — do NOT say "hold chips" in that case. Never suggest a chip the user has already played.
- Pre-plan the next 2-3 gameweeks using the multi-GW fixture run-in. Populate \`multi_gw_plan\` with one entry per upcoming GW (including this one) describing the intended squad direction, any planned transfers, captain candidate, and rationale. Identify squad rotation that lines up players with the best fixtures over the horizon, not just this week.
- Output a SINGLE JSON object that strictly matches the schema below. No prose, no commentary, no markdown. Begin your response with \`{\` and end with \`}\`. Do not wrap it in code fences. Do not add any text before \`{\` or after the final \`}\`. Every string value must be plain text (no inner JSON, no markdown).

The JSON object MUST conform to this TypeScript schema:

type Output = {
  overall_strategy: string;              // 2-3 sentence plan
  transfers: Array<{
    out: string;                          // FPL web_name
    in: string;                           // FPL web_name
    reason: string;
    rival_targeted?: string;              // rival manager name this swap targets
    hit_cost?: number;                    // 0 if free, 4 if -4 hit, 8 if -8, etc.
  }>;
  captain: { pick: string; vice: string; reasoning: string };
  starting_xi: string[];                  // 11 web_names, GK then DEF then MID then FWD
  bench: string[];                        // 4 web_names in autosub priority order:
                                          // [first outfield sub, second outfield sub,
                                          //  third outfield sub, GK sub]
  chip: {
    // Set to "none" when no chip play is justified OR when the user has no
    // chips remaining. Never name a chip not in the "Remaining" wallet.
    use: "wildcard" | "bench-boost" | "triple-captain" | "free-hit" | "none";
    reasoning: string;
  };
  differentials_to_exploit: string[];     // 1-5 web_names
  multi_gw_plan: Array<{
    gw: number;                           // gameweek number
    intent: string;                       // 1-sentence plan for that GW
    transfers: Array<{                    // forward-planned transfers (empty if none)
      out: string;
      in: string;
      reason: string;
      hit_cost?: number;
    }>;
    captain: string;                      // intended captain web_name for that GW
    notes: string;                        // anything else worth flagging
  }>;
  news_citations: Array<{ player: string; summary: string; source_url?: string }>;
  confidence: "low" | "medium" | "high";
};`;

/** Build the analysis system instruction with an explicit season+GW header
 *  prepended. Gemini ignores the user prompt's season label far more often
 *  than the system instruction's. */
export function buildSystemInstruction(args: { seasonLabel: string; gw: number; deadline?: string }): string {
  return seasonHeader(args.seasonLabel, args.gw, args.deadline) + SYSTEM_INSTRUCTION_BASE;
}

interface BuildUserPromptArgs {
  gw: number;
  deadline: string;
  leagueName: string;
  user: ManagerSquad;
  rivals: ManagerSquad[];
  userProjection: SquadProjection;
  rivalProjections: SquadProjection[];
  overtake: OvertakeOdds[];
  bank: number;
  freeTransfers: number;
  shortlist: TransferSuggestion[];
  differentials: {
    userOnly: Array<{ name: string; team?: string; xPts: number }>;
    rivalOnly: Array<{ name: string; rival: string; team?: string; xPts: number }>;
  };
  fixtures: FplFixture[];
  horizonFixtures: Array<{ gw: number; fixtures: FplFixture[] }>;
  bs: FplBootstrap;
  eo: EoMap;
  priceMoves: PriceMoveReport;
  userChips?: ChipStatus;
  rivalChips?: Array<{ entryId: number; status: ChipStatus }>;
}

function chipWalletBlock(args: { user?: ChipStatus; rivals?: Array<{ entryId: number; status: ChipStatus }>; ctx: Array<ManagerSquad> }): string {
  const lines: string[] = [];
  if (!args.user) return "  (chip status unavailable for this season)";
  const remaining = args.user.remaining.length
    ? args.user.remaining.map((c) => `${CHIP_LONG_NAMES[c] ?? c} → JSON value "${CHIP_OUTPUT_VALUE[c] ?? "none"}"`).join(", ")
    : "NONE — all chips already used this season";
  const used = args.user.used.length
    ? args.user.used.map((u) => `${CHIP_LONG_NAMES[u.chip] ?? u.chip} (used GW${u.gw})`).join(", ")
    : "none yet";
  lines.push(`User remaining: ${remaining}`);
  lines.push(`User used:      ${used}`);
  if (args.rivals && args.rivals.length) {
    for (const r of args.rivals) {
      const sq = args.ctx.find((s) => s.entry.id === r.entryId);
      const rem = r.status.remaining.length
        ? r.status.remaining.map((c) => CHIP_LONG_NAMES[c] ?? c).join(", ")
        : "NONE";
      const usd = r.status.used.length
        ? r.status.used.map((u) => `${CHIP_LONG_NAMES[u.chip] ?? u.chip} GW${u.gw}`).join(", ")
        : "none";
      lines.push(`Rival ${sq?.entry.name ?? r.entryId}: remaining=${rem}; used=${usd}`);
    }
  }
  return lines.join("\n");
}

/** opponent code (e.g. "BUR (H)") for `teamId` in the upcoming GW, or null if blank. */
function opponentForTeam(
  teamId: number,
  fixtures: FplFixture[],
  teamsById: Map<number, FplTeam>,
): string | null {
  const matching = fixtures.filter((f) => f.team_h === teamId || f.team_a === teamId);
  if (matching.length === 0) return null;
  return matching
    .map((f) => {
      const isHome = f.team_h === teamId;
      const opp = teamsById.get(isHome ? f.team_a : f.team_h);
      return `${opp?.short_name ?? "?"} (${isHome ? "H" : "A"})`;
    })
    .join(" + ");
}

function fixturesBlock(fixtures: FplFixture[], teamsById: Map<number, FplTeam>): string {
  if (fixtures.length === 0) return "  (no fixtures listed — this is a blank gameweek for every team)";
  return fixtures
    .map((f) => {
      const h = teamsById.get(f.team_h)?.short_name ?? "?";
      const a = teamsById.get(f.team_a)?.short_name ?? "?";
      const ko = f.kickoff_time ? new Date(f.kickoff_time).toISOString().slice(0, 16).replace("T", " ") + "Z" : "TBD";
      return `  ${h} (H, FDR ${f.team_h_difficulty}) vs ${a} (A, FDR ${f.team_a_difficulty})  kickoff ${ko}`;
    })
    .join("\n");
}

function squadLine(squad: ManagerSquad, proj: SquadProjection, teamsById: Map<number, FplTeam>, fixtures: FplFixture[]) {
  const byPlayer = new Map(proj.perPlayer.map((p) => [p.playerId, p]));
  const fmt = (s: ManagerSquad["picks"][number]) => {
    const p = byPlayer.get(s.player.id);
    const xp = p ? p.xPoints.toFixed(1) : "?";
    const note = p && p.notes.length ? ` [${p.notes.join("; ")}]` : "";
    const marker = s.pick.is_captain ? " (C)" : s.pick.is_vice_captain ? " (VC)" : "";
    const bench = s.pick.multiplier === 0 ? " (BENCH)" : "";
    const opp = opponentForTeam(s.team.id, fixtures, teamsById);
    const oppStr = opp ? ` vs ${opp}` : " — BLANK GW";
    return `  - ${s.position} ${s.player.web_name} (${s.team.short_name}${oppStr}, £${(s.player.now_cost / 10).toFixed(1)}m, xP=${xp})${marker}${bench}${note}`;
  };
  return squad.picks.map(fmt).join("\n");
}

export function buildUserPrompt(args: BuildUserPromptArgs): string {
  const {
    gw,
    deadline,
    leagueName,
    user,
    rivals,
    userProjection,
    rivalProjections,
    overtake,
    bank,
    freeTransfers,
    shortlist,
    differentials,
    fixtures,
    horizonFixtures,
    bs,
    eo,
    priceMoves,
    userChips,
    rivalChips,
  } = args;

  const teamsById = new Map(bs.teams.map((t) => [t.id, t]));

  // Build a per-team run-in across the next 3 GWs so the AI can pre-plan rotations.
  const horizonByTeam = new Map<number, string[]>();
  for (const team of bs.teams) horizonByTeam.set(team.id, []);
  for (const { gw, fixtures: fx } of horizonFixtures) {
    for (const team of bs.teams) {
      const opp = opponentForTeam(team.id, fx, teamsById);
      const fdr = fx.find((f) => f.team_h === team.id || f.team_a === team.id);
      const fdrVal = fdr ? (fdr.team_h === team.id ? fdr.team_h_difficulty : fdr.team_a_difficulty) : null;
      horizonByTeam
        .get(team.id)!
        .push(`GW${gw}:${opp ?? "BLANK"}${fdrVal ? `(FDR${fdrVal})` : ""}`);
    }
  }

  const userTeams = new Set(user.picks.map((s) => s.team.id));
  const rivalTeams = new Set(rivals.flatMap((r) => r.picks.map((s) => s.team.id)));
  const relevantTeams = [...new Set([...userTeams, ...rivalTeams])].sort((a, b) => a - b);
  const horizonBlock = relevantTeams
    .map((id) => `  ${teamsById.get(id)?.short_name}: ${horizonByTeam.get(id)!.join("  ")}`)
    .join("\n");

  const rivalsBlock = rivals
    .map((r, i) => {
      const proj = rivalProjections[i];
      const odds = overtake.find((o) => o.rivalEntryId === r.entry.id);
      return `### Rival ${i + 1}: ${r.entry.name} (${r.entry.player_name}) — rank ${r.entry.rank}, ${odds?.pointsBehind ?? "?"} pts ahead
Projected starting-XI: ${proj?.startingXIPoints.toFixed(1) ?? "?"} | Captain: ${r.captain?.player.web_name ?? "?"} | Active chip: ${r.activeChip ?? "none"}
Overtake probability this GW: ${odds ? Math.round(odds.overtakeProbability * 100) + "%" : "?"}
${squadLine(r, proj!, teamsById, fixtures)}`;
    })
    .join("\n\n");

  const shortlistBlock = shortlist.length
    ? shortlist
        .map(
          (s) =>
            `  - ${s.position}: OUT ${s.out.name} (£${(s.out.cost / 10).toFixed(1)}m, xP=${s.out.xPoints}, ${s.out.reason}) → IN ${s.in.name} (£${(s.in.cost / 10).toFixed(1)}m, xP=${s.in.xPoints}, +${s.netGain.toFixed(1)} net) [bank after swap: £${((bank + s.out.cost - s.in.cost) / 10).toFixed(1)}m]`,
        )
        .join("\n")
    : "  (none — squad already looks optimised before AI review)";

  // Per-position affordability ceilings: max IN-player cost the user can
  // afford after selling their CHEAPEST player in that position. Gives the
  // AI concrete budget guardrails without needing to ship all of bs.elements.
  const POS_ORDER: import("@/lib/types").Position[] = ["GKP", "DEF", "MID", "FWD"];
  const affordabilityCeilings = POS_ORDER.map((pos) => {
    const inPos = user.picks.filter((s) => s.position === pos);
    if (inPos.length === 0) return `  - ${pos}: (none in squad)`;
    const cheapest = inPos.reduce((a, b) => (a.player.now_cost <= b.player.now_cost ? a : b));
    const ceiling = bank + cheapest.player.now_cost;
    return `  - ${pos}: cheapest owned = ${cheapest.player.web_name} at £${(cheapest.player.now_cost / 10).toFixed(1)}m → MAX IN ${pos} price = £${(ceiling / 10).toFixed(1)}m (bank £${(bank / 10).toFixed(1)}m + £${(cheapest.player.now_cost / 10).toFixed(1)}m sale)`;
  }).join("\n");

  // Per-position top-5 AFFORDABLE upgrade pool from the FPL element list, so
  // Gemini has explicit, price-correct alternatives instead of relying on
  // training-data recall (which is stale on FPL price + transfers).
  const POS_BY_ID: Record<number, import("@/lib/types").Position> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
  const userPlayerIds = new Set(user.picks.map((s) => s.player.id));
  const affordablePoolBlock = POS_ORDER.map((pos) => {
    const inPos = user.picks.filter((s) => s.position === pos);
    if (inPos.length === 0) return `  ${pos}: (n/a)`;
    const cheapest = inPos.reduce((a, b) => (a.player.now_cost <= b.player.now_cost ? a : b));
    const ceiling = bank + cheapest.player.now_cost;
    const cands = bs.elements
      .filter((p) => POS_BY_ID[p.element_type] === pos)
      .filter((p) => !userPlayerIds.has(p.id))
      .filter((p) => p.status === "a" || p.status === "d")
      .filter((p) => p.now_cost <= ceiling)
      .map((p) => {
        const team = teamsById.get(p.team);
        return {
          el: p,
          team,
          // Cheap proxy for xP: form * 1.2 + ep_next; we just need rank order.
          rank: Number(p.form) * 1.2 + Number(p.ep_next),
        };
      })
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 5)
      .map((c) =>
        `${c.el.web_name} [${c.team?.short_name ?? "?"}] £${(c.el.now_cost / 10).toFixed(1)}m`,
      );
    return `  ${pos} (max £${(ceiling / 10).toFixed(1)}m): ${cands.length ? cands.join(", ") : "(no affordable upgrades found)"}`;
  }).join("\n");

  const deadlineYear = new Date(deadline).getUTCFullYear();
  const seasonLabel =
    new Date(deadline).getUTCMonth() >= 6 ? `${deadlineYear}/${(deadlineYear + 1) % 100}` : `${deadlineYear - 1}/${deadlineYear % 100}`;

  const horizonGws = horizonFixtures.map((h) => h.gw);

  return `>>> ACTIVE SEASON: ${seasonLabel} >>> UPCOMING DEADLINE: GAMEWEEK ${gw} (${deadline}) <<<
Mini-league: ${leagueName}

Every reference to a club, fixture, or ownership below is for the ${seasonLabel} season. If your training data suggests otherwise, the prompt wins.

## Fixtures for Season ${seasonLabel} — Gameweek ${gw} (AUTHORITATIVE — every matchup is below; if a team isn't listed they have a BLANK gameweek)
${fixturesBlock(fixtures, teamsById)}

## ${seasonLabel} fixture run-in for the next ${horizonGws.length} GWs (${horizonGws.join(", ")}) — per team (your + rival teams)
Use this for planning rotations and lining up players with favourable runs. "BLANK" means no fixture that GW.
${horizonBlock}

## User: ${user.entry.name} (${user.entry.player_name}) — rank ${user.entry.rank}
Projected starting-XI: ${userProjection.startingXIPoints.toFixed(1)} | Captain: ${user.captain?.player.web_name ?? "?"} | Active chip: ${user.activeChip ?? "none"}
Bank: £${(bank / 10).toFixed(1)}m | Free transfers available NOW: ${freeTransfers} (each transfer beyond this incurs a -4 hit)
${squadLine(user, userProjection, teamsById, fixtures)}

## Rivals immediately above the user
${rivalsBlock}

## Affordability ceilings (HARD CONSTRAINT — every recommended IN must respect these)
Current bank: £${(bank / 10).toFixed(1)}m
${affordabilityCeilings}

## Affordable upgrade pool (top-ranked players you can ACTUALLY afford per position, sorted by form × ep_next)
${affordablePoolBlock}

## Heuristic transfer shortlist (pre-AI, you must validate with news; all entries already respect the bank)
${shortlistBlock}

## Differentials
User-only players: ${differentials.userOnly.map((d) => `${d.name}${d.team ? ` [${d.team}]` : ""} (xP ${d.xPts.toFixed(1)})`).join(", ") || "none"}
Rival-only players to consider stealing: ${differentials.rivalOnly.map((d) => `${d.name}${d.team ? ` [${d.team}]` : ""} via ${d.rival} (xP ${d.xPts.toFixed(1)})`).join(", ") || "none"}

## Effective ownership in this mini-league (your squad vs rivals)
EO% = (managers owning a player) / (1 + ${rivals.length} rivals). captainEO% adds the captain/triple-captain multiplier — anyone above 100% is a likely rival captain.
User squad EO snapshot (starters only):
${user.starters
  .map((s) => {
    const e = eo[s.player.id];
    return `  - ${s.player.web_name}: EO ${e ? e.eoPct.toFixed(0) : "?"}% · captainEO ${e ? e.captainEoPct.toFixed(0) : "?"}% · global ${e ? e.globalPct.toFixed(1) : "?"}%`;
  })
  .join("\n")}
Rival captain threats (players rivals own/captain but YOU do not — high captainEO with userMultiplier=0):
${
  Object.values(eo)
    .filter((p) => !p.ownedByUser && p.captainEoPct > 0)
    .sort((a, b) => b.captainEoPct - a.captainEoPct)
    .slice(0, 8)
    .map((p) => `  - ${p.webName}: captainEO ${p.captainEoPct.toFixed(0)}% (you do not own — direct points loss if they haul)`)
    .join("\n") || "  (none — every threat is mirrored in your squad)"
}
Captaincy guideline:
- captainEO ≥ 70%: this is the template captain. Mirror unless you have a high-conviction differential.
- captainEO 30-70%: tactical choice — pick the one that maximises your overtake probability.
- captainEO < 30% and your projection beats the template: a real differential captain play — call it out explicitly.

## Price-change intel (next FPL price change run)
Players LIKELY TO RISE tonight (top 10):
${
  priceMoves.rising
    .slice(0, 10)
    .map((m) => `  - ${m.webName}: net ${m.netTransfers > 0 ? "+" : ""}${m.netTransfers.toLocaleString()} (${m.pctOfPool.toFixed(2)}% pool, ${m.confidence} confidence)`)
    .join("\n") || "  (no high-confidence rises projected)"
}
Players LIKELY TO DROP tonight (top 10):
${
  priceMoves.falling
    .slice(0, 10)
    .map((m) => `  - ${m.webName}: net ${m.netTransfers.toLocaleString()} (${m.pctOfPool.toFixed(2)}% pool, ${m.confidence} confidence)`)
    .join("\n") || "  (no high-confidence drops projected)"
}
USER-SQUAD price warnings (any player in the user squad in the above lists):
${(() => {
  const userIds = new Set(user.picks.map((s) => s.player.id));
  const hits = [
    ...priceMoves.rising.filter((m) => userIds.has(m.playerId)).map((m) => `  - ${m.webName} likely to RISE (banked profit if held)`),
    ...priceMoves.falling.filter((m) => userIds.has(m.playerId)).map((m) => `  - ${m.webName} likely to DROP (sell before deadline to preserve team value, but only if you were already planning to)`),
  ];
  return hits.length ? hits.join("\n") : "  (none — squad value stable tonight)";
})()}
Use price intel ONLY to break ties (e.g. between two equally-good transfer-in targets, pick the one about to rise; consider timing of moves around the price-change run). NEVER chase a price rise at the cost of a worse footballing decision.

## Chip wallet (AUTHORITATIVE — never recommend a chip the user has already used)
${chipWalletBlock({ user: userChips, rivals: rivalChips, ctx: [user, ...rivals] })}

Chip rules to apply:
- If user "Remaining" is empty, set \`chip.use\` to "none" and the reasoning must state that all chips have been used this season. Do NOT say "hold chips" in that case.
- If chips remain, evaluate playing one this GW only when it materially raises overtake odds vs the closest rival (e.g. Bench Boost in a DGW with ≥3 of your players doubling, Triple Captain on a high-EV captain in a DGW, Free Hit in a 4+ blank GW, Wildcard when ≥4 transfers are needed to fix the squad over the next 2 GWs).
- Otherwise set \`chip.use\` to "none".

## Your task
1. Search the web for the latest pre-deadline news on every named player you reference (especially captain candidates and transfer targets). Look for press conferences, manager quotes, training reports, and confirmed lineups when available.
2. Recommend the move-set that maximises the user's probability of leapfrogging at least the closest rival above. Prioritise high-conviction, differential plays vs the rivals you can see.
3. Be honest about uncertainty — if the picture is unclear, lower the \`confidence\` value and recommend the safer chip/captain choice.
4. Emit ONLY the JSON object specified in the system instruction. No prose after the closing fence.`;
}

export function summarizeProjectionForDigest(p: PlayerProjection): string {
  return `${p.webName} (${p.position}) xP=${p.xPoints} FDR=${p.fixtureDifficulty}${p.notes.length ? " — " + p.notes.join("; ") : ""}`;
}

// ----- Chat (multi-turn co-pilot) -----------------------------------------

const CHAT_SYSTEM_INSTRUCTION_BASE = `You are the same elite Fantasy Premier League strategist the user already consulted for their structured analysis. They are now in a multi-turn conversation with you about that same team and mini-league. Your sole objective stays the same: help them overtake the rivals immediately above them in the table.

Conversation rules:
- Replies are PLAIN MARKDOWN — no JSON, no code fences around the whole answer. Use **bold** for player names you recommend and bullet lists for options.
- Keep replies tight: ≤200 words by default, fewer if the question is simple. Never pad.
- The "## Context" block in the FIRST user message is your source of truth for squad, rivals, fixtures, EO, bank, free transfers, and projections. Do not contradict it. If the user asks about a player you can't find in that context, say so.
- Use Google Search ONLY when the user explicitly asks for latest news, injury status, press conferences, or lineup updates. Cite sources inline as [source](url) when you do.
- When the user proposes a hypothetical ("what if I captain X?"), reason about it concretely using the projection numbers in the context (xP, σ, EO, captainEO).
- Honour the free-transfer count in the context. A -4 hit is only worth it if the projected gain is materially > 4 pts AND it raises overtake probability.
- If the user asks about a future GW beyond the horizon in the context, say you only have visibility for the listed GWs and note what would tip the decision.
- ALL references to player→club mappings, fixtures, form, ownership, and prices MUST reflect the active season shown in the header. NEVER assert a player plays for a club other than the one shown in the context block. If your training data conflicts with the context, the context wins.`;

export function buildChatSystemInstruction(args: { seasonLabel: string; gw: number; deadline?: string }): string {
  return seasonHeader(args.seasonLabel, args.gw, args.deadline) + CHAT_SYSTEM_INSTRUCTION_BASE;
}

export interface ChatContextArgs {
  gw: number;
  deadline: string;
  ctx: import("@/lib/types").RivalContext;
  userProjection: SquadProjection;
  rivalProjections: SquadProjection[];
  overtake: OvertakeOdds[];
  fixtures: FplFixture[];
  bs: FplBootstrap;
  bank: number;
  freeTransfers: number;
  eo?: import("@/lib/intel/effective-ownership").EoMap;
}

export function buildChatContextBlock(args: ChatContextArgs): string {
  const { gw, deadline, ctx, userProjection, rivalProjections, overtake, fixtures, bs, bank, freeTransfers, eo } = args;
  const teamsById = new Map(bs.teams.map((t) => [t.id, t]));

  const rivalLines = ctx.rivals
    .map((r, i) => {
      const proj = rivalProjections[i];
      const odds = overtake.find((o) => o.rivalEntryId === r.entry.id);
      return `  - ${r.entry.name} (${r.entry.player_name}): ${odds?.pointsBehind ?? "?"} pts ahead · projected XI ${proj?.startingXIPoints.toFixed(1) ?? "?"} · captain ${r.captain?.player.web_name ?? "?"} · overtake ${odds ? Math.round(odds.overtakeProbability * 100) + "%" : "?"}`;
    })
    .join("\n");

  const userSquadLine = ctx.user.picks
    .map((s) => {
      const xp = userProjection.perPlayer.find((p) => p.playerId === s.player.id)?.xPoints;
      const marker = s.pick.is_captain ? " (C)" : s.pick.is_vice_captain ? " (VC)" : "";
      const bench = s.pick.multiplier === 0 ? " [BENCH]" : "";
      return `  - ${s.position} ${s.player.web_name} (${s.team.short_name}, £${(s.player.now_cost / 10).toFixed(1)}m, xP=${typeof xp === "number" ? xp.toFixed(1) : "?"})${marker}${bench}`;
    })
    .join("\n");

  const fixturesBlock_ = fixtures.length
    ? fixtures
        .map((f) => {
          const h = teamsById.get(f.team_h)?.short_name ?? "?";
          const a = teamsById.get(f.team_a)?.short_name ?? "?";
          return `  ${h} vs ${a} (FDR ${f.team_h_difficulty}-${f.team_a_difficulty})`;
        })
        .join("\n")
    : "  (blank gameweek)";

  const captainThreats = eo
    ? Object.values(eo)
        .filter((p) => !p.ownedByUser && p.captainEoPct > 30)
        .sort((a, b) => b.captainEoPct - a.captainEoPct)
        .slice(0, 5)
        .map((p) => `  - ${p.webName}: captainEO ${p.captainEoPct.toFixed(0)}%`)
        .join("\n")
    : "  (n/a)";

  const seasonLabel = computeSeasonLabel(deadline);
  return `## Context for this conversation (assume this is current truth)
>>> ACTIVE SEASON: ${seasonLabel} >>> GAMEWEEK ${gw} (deadline ${deadline}) <<<
Mini-league: ${ctx.leagueName}
Bank: £${(bank / 10).toFixed(1)}m · Free transfers: ${freeTransfers}

All player→club mappings below are for the ${seasonLabel} season. NEVER assert a player plays for a different club than what's shown here, no matter what your training data says.

### Fixtures for Season ${seasonLabel} — GW ${gw} (authoritative)
${fixturesBlock_}

### User squad — ${ctx.user.entry.name} (rank #${ctx.user.entry.rank}, ${ctx.user.entry.total} pts)
Projected XI: ${userProjection.startingXIPoints.toFixed(1)} (σ ${userProjection.stdev.toFixed(1)})
${userSquadLine}

### Rivals to overtake (closest first)
${rivalLines}

### Rival captain threats (you don't own; high captainEO)
${captainThreats}

Answer in markdown, ≤200 words. When the user asks "what if…", run the numbers using the xP values above and explain the trade-off.`;
}
