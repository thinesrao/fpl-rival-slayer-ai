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

export const SYSTEM_INSTRUCTION = `You are an elite Fantasy Premier League strategist for the current Premier League season. Your *sole* objective is to help the user OVERTAKE the 2-3 mini-league rivals immediately above them in the table.

Hard rules:
- The "Fixtures this gameweek" block in the user prompt is the AUTHORITATIVE list of matches for the upcoming deadline. NEVER reference any other fixture. If you find yourself about to say "Player X faces Team Y", you MUST verify the matchup against that block. If a player's team is not in the fixtures block, they have a BLANK gameweek and will score 0.
- Use the Google Search tool ONLY for the latest injury, suspension, rotation, and press-conference news. Do NOT use search to look up fixtures — the fixtures block is the source of truth.
- The season is the one in progress as of the deadline date in the prompt. Disregard knowledge of past or future seasons when discussing form, ownership, or fixtures.
- Be specific. Recommend exact transfers (named OUT and named IN), an exact captain + vice, an exact starting XI, and a clear chip decision.
- Prefer "rival-targeting" moves: differentials only the rivals own (consider transferring in, or trust ours to differentiate), or rival captains we should not blindly mirror.
- HONOUR THE FREE TRANSFER COUNT. The "Free transfers available" number is exact. Each transfer in your "transfers" list beyond that count incurs a -4 hit (set hit_cost on those transfers). Never silently exceed the FT count without explicit hit_cost values. If you only need 0-1 transfers, don't manufacture extra just to spend FT.
- Pre-plan the next 2-3 gameweeks using the multi-GW fixture run-in. Populate \`multi_gw_plan\` with one entry per upcoming GW (including this one) describing the intended squad direction, any planned transfers, captain candidate, and rationale. Identify squad rotation that lines up players with the best fixtures over the horizon, not just this week.
- Never recommend hits (-4 transfer cost) unless the projected gain comfortably exceeds the points cost AND it materially raises overtake probability.
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
  chip: {
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
    userOnly: Array<{ name: string; xPts: number }>;
    rivalOnly: Array<{ name: string; rival: string; xPts: number }>;
  };
  fixtures: FplFixture[];
  horizonFixtures: Array<{ gw: number; fixtures: FplFixture[] }>;
  bs: FplBootstrap;
  eo: EoMap;
  priceMoves: PriceMoveReport;
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
            `  - ${s.position}: OUT ${s.out.name} (xP=${s.out.xPoints}, ${s.out.reason}) → IN ${s.in.name} (xP=${s.in.xPoints}, +${s.netGain.toFixed(1)})`,
        )
        .join("\n")
    : "  (none — squad already looks optimised before AI review)";

  const deadlineYear = new Date(deadline).getUTCFullYear();
  const seasonLabel =
    new Date(deadline).getUTCMonth() >= 6 ? `${deadlineYear}/${(deadlineYear + 1) % 100}` : `${deadlineYear - 1}/${deadlineYear % 100}`;

  const horizonGws = horizonFixtures.map((h) => h.gw);

  return `Premier League season: ${seasonLabel}
Gameweek ${gw} deadline: ${deadline}
Mini-league: ${leagueName}

## Fixtures this gameweek (AUTHORITATIVE — every matchup is below; if a team isn't listed they have a BLANK gameweek)
${fixturesBlock(fixtures, teamsById)}

## Fixture run-in for the next ${horizonGws.length} GWs (${horizonGws.join(", ")}) — per team (your + rival teams)
Use this for planning rotations and lining up players with favourable runs. "BLANK" means no fixture that GW.
${horizonBlock}

## User: ${user.entry.name} (${user.entry.player_name}) — rank ${user.entry.rank}
Projected starting-XI: ${userProjection.startingXIPoints.toFixed(1)} | Captain: ${user.captain?.player.web_name ?? "?"} | Active chip: ${user.activeChip ?? "none"}
Bank: £${(bank / 10).toFixed(1)}m | Free transfers available NOW: ${freeTransfers} (each transfer beyond this incurs a -4 hit)
${squadLine(user, userProjection, teamsById, fixtures)}

## Rivals immediately above the user
${rivalsBlock}

## Heuristic transfer shortlist (pre-AI, you must validate with news)
${shortlistBlock}

## Differentials
User-only players: ${differentials.userOnly.map((d) => `${d.name} (xP ${d.xPts.toFixed(1)})`).join(", ") || "none"}
Rival-only players to consider stealing: ${differentials.rivalOnly.map((d) => `${d.name} via ${d.rival} (xP ${d.xPts.toFixed(1)})`).join(", ") || "none"}

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

## Your task
1. Search the web for the latest pre-deadline news on every named player you reference (especially captain candidates and transfer targets). Look for press conferences, manager quotes, training reports, and confirmed lineups when available.
2. Recommend the move-set that maximises the user's probability of leapfrogging at least the closest rival above. Prioritise high-conviction, differential plays vs the rivals you can see.
3. Be honest about uncertainty — if the picture is unclear, lower the \`confidence\` value and recommend the safer chip/captain choice.
4. Emit ONLY the JSON object specified in the system instruction. No prose after the closing fence.`;
}

export function summarizeProjectionForDigest(p: PlayerProjection): string {
  return `${p.webName} (${p.position}) xP=${p.xPoints} FDR=${p.fixtureDifficulty}${p.notes.length ? " — " + p.notes.join("; ") : ""}`;
}
