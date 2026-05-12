// Prompts + structured schema for the Gemini AI strategist.

import type {
  ManagerSquad,
  OvertakeOdds,
  PlayerProjection,
  SquadProjection,
} from "@/lib/types";
import type { TransferSuggestion } from "@/lib/optimizer/transfers";

export const SYSTEM_INSTRUCTION = `You are an elite Fantasy Premier League strategist. Your *sole* objective is to help the user OVERTAKE the 2-3 mini-league rivals immediately above them in the table.

Hard rules:
- Use the Google Search tool to verify the latest injury, suspension, and rotation news for every named player you propose to transfer in/out or captain. Do not rely solely on the data blob — news moves fast near the deadline.
- Be specific. Recommend exact transfers (named OUT and named IN), an exact captain + vice, an exact starting XI, and a clear chip decision.
- Prefer "rival-targeting" moves: differentials only the rivals own (consider transferring in, or trust ours to differentiate), or rival captains we should not blindly mirror.
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
    hit_cost?: number;                    // 0 if free, 4 if -4 hit, etc.
  }>;
  captain: { pick: string; vice: string; reasoning: string };
  starting_xi: string[];                  // 11 web_names, GK then DEF then MID then FWD
  chip: {
    use: "wildcard" | "bench-boost" | "triple-captain" | "free-hit" | "none";
    reasoning: string;
  };
  differentials_to_exploit: string[];     // 1-5 web_names
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
}

function squadLine(squad: ManagerSquad, proj: SquadProjection) {
  const byPlayer = new Map(proj.perPlayer.map((p) => [p.playerId, p]));
  const fmt = (s: ManagerSquad["picks"][number]) => {
    const p = byPlayer.get(s.player.id);
    const xp = p ? p.xPoints.toFixed(1) : "?";
    const note = p && p.notes.length ? ` [${p.notes.join("; ")}]` : "";
    const marker = s.pick.is_captain ? " (C)" : s.pick.is_vice_captain ? " (VC)" : "";
    const bench = s.pick.multiplier === 0 ? " (BENCH)" : "";
    return `  - ${s.position} ${s.player.web_name} (${s.team.short_name}, £${(s.player.now_cost / 10).toFixed(1)}m, xP=${xp})${marker}${bench}${note}`;
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
  } = args;

  const rivalsBlock = rivals
    .map((r, i) => {
      const proj = rivalProjections[i];
      const odds = overtake.find((o) => o.rivalEntryId === r.entry.id);
      return `### Rival ${i + 1}: ${r.entry.name} (${r.entry.player_name}) — rank ${r.entry.rank}, ${odds?.pointsBehind ?? "?"} pts ahead
Projected starting-XI: ${proj?.startingXIPoints.toFixed(1) ?? "?"} | Captain: ${r.captain?.player.web_name ?? "?"} | Active chip: ${r.activeChip ?? "none"}
Overtake probability this GW: ${odds ? Math.round(odds.overtakeProbability * 100) + "%" : "?"}
${squadLine(r, proj!)}`;
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

  return `Gameweek ${gw} deadline: ${deadline}
Mini-league: ${leagueName}

## User: ${user.entry.name} (${user.entry.player_name}) — rank ${user.entry.rank}
Projected starting-XI: ${userProjection.startingXIPoints.toFixed(1)} | Captain: ${user.captain?.player.web_name ?? "?"} | Active chip: ${user.activeChip ?? "none"}
Bank: £${(bank / 10).toFixed(1)}m | Free transfers available: ${freeTransfers}
${squadLine(user, userProjection)}

## Rivals immediately above the user
${rivalsBlock}

## Heuristic transfer shortlist (pre-AI, you must validate with news)
${shortlistBlock}

## Differentials
User-only players: ${differentials.userOnly.map((d) => `${d.name} (xP ${d.xPts.toFixed(1)})`).join(", ") || "none"}
Rival-only players to consider stealing: ${differentials.rivalOnly.map((d) => `${d.name} via ${d.rival} (xP ${d.xPts.toFixed(1)})`).join(", ") || "none"}

## Your task
1. Search the web for the latest pre-deadline news on every named player you reference (especially captain candidates and transfer targets). Look for press conferences, manager quotes, training reports, and confirmed lineups when available.
2. Recommend the move-set that maximises the user's probability of leapfrogging at least the closest rival above. Prioritise high-conviction, differential plays vs the rivals you can see.
3. Be honest about uncertainty — if the picture is unclear, lower the \`confidence\` value and recommend the safer chip/captain choice.
4. Emit ONLY the JSON object specified in the system instruction. No prose after the closing fence.`;
}

export function summarizeProjectionForDigest(p: PlayerProjection): string {
  return `${p.webName} (${p.position}) xP=${p.xPoints} FDR=${p.fixtureDifficulty}${p.notes.length ? " — " + p.notes.join("; ") : ""}`;
}
