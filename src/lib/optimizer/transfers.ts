// Lightweight transfer suggester. Picks the player from the user's squad
// whose net xPts loss is smallest (or who is injured), then finds an affordable
// replacement at the same position with highest xPts uplift. Used as a sanity
// shortlist for Gemini — the AI then validates with live news.
//
// Constraints honored:
//   - Same position swap
//   - now_cost <= sold_cost + bank
//   - max 3 from any single Premier League team
//   - replacement is not already in the squad

import { projectPlayer } from "@/lib/projections/model";
import type {
  FplBootstrap,
  FplElement,
  FplFixture,
  ManagerSquad,
  Position,
} from "@/lib/types";

export interface TransferSuggestion {
  out: { id: number; name: string; cost: number; xPoints: number; reason: string };
  in: { id: number; name: string; cost: number; xPoints: number };
  netGain: number; // xP_in - xP_out
  position: Position;
}

const POS_BY_ID: Record<number, Position> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

function teamCounts(squad: ManagerSquad, excludePlayerId?: number): Map<number, number> {
  const m = new Map<number, number>();
  for (const slot of squad.picks) {
    if (slot.player.id === excludePlayerId) continue;
    m.set(slot.player.team, (m.get(slot.player.team) ?? 0) + 1);
  }
  return m;
}

export function suggestTransfers(
  squad: ManagerSquad,
  bank: number,
  bs: FplBootstrap,
  fixtures: FplFixture[],
  gw: number,
  maxSuggestions = 5,
): TransferSuggestion[] {
  const teamsById = new Map(bs.teams.map((t) => [t.id, t]));
  const squadIds = new Set(squad.picks.map((s) => s.player.id));

  // Pre-project every squad player so we know their xPts.
  const squadProjections = squad.picks.map((slot) => ({
    slot,
    proj: projectPlayer({
      player: slot.player,
      team: slot.team,
      position: slot.position,
      fixtures,
      gw,
    }),
  }));

  // Pre-project candidate pool per position. Only players that are flagged
  // "available" (a=available, d=doubt) get considered as IN-replacements.
  const candidatePoolByPos = new Map<Position, Array<{ player: FplElement; xPts: number }>>();
  for (const p of bs.elements) {
    if (squadIds.has(p.id)) continue;
    if (p.status === "u" || p.status === "n" || p.status === "i" || p.status === "s") continue;
    const pos = POS_BY_ID[p.element_type];
    const team = teamsById.get(p.team);
    if (!team) continue;
    const proj = projectPlayer({ player: p, team, position: pos, fixtures, gw });
    if (!candidatePoolByPos.has(pos)) candidatePoolByPos.set(pos, []);
    candidatePoolByPos.get(pos)!.push({ player: p, xPts: proj.xPoints });
  }
  for (const list of candidatePoolByPos.values()) list.sort((a, b) => b.xPts - a.xPts);

  const suggestions: TransferSuggestion[] = [];

  // Sort current squad by ascending xPts (cheapest losses first) and biased to injured first.
  const ranked = [...squadProjections].sort((a, b) => {
    const injuryDiff = b.proj.injuryRisk - a.proj.injuryRisk;
    if (Math.abs(injuryDiff) > 0.25) return injuryDiff;
    return a.proj.xPoints - b.proj.xPoints;
  });

  for (const { slot, proj } of ranked) {
    const pool = candidatePoolByPos.get(slot.position) ?? [];
    const budget = slot.player.now_cost + bank;
    const tCounts = teamCounts(squad, slot.player.id);

    const candidate = pool.find((c) => {
      if (c.player.now_cost > budget) return false;
      const teamCount = tCounts.get(c.player.team) ?? 0;
      if (teamCount >= 3) return false;
      return c.xPts > proj.xPoints + 0.5; // require meaningful uplift
    });
    if (!candidate) continue;

    const reason =
      proj.injuryRisk >= 0.5
        ? `Injury risk (${Math.round(proj.injuryRisk * 100)}%)`
        : proj.xPoints < 2
          ? "Very low projected return"
          : "Outscored by available alternative";

    suggestions.push({
      out: {
        id: slot.player.id,
        name: slot.player.web_name,
        cost: slot.player.now_cost,
        xPoints: proj.xPoints,
        reason,
      },
      in: {
        id: candidate.player.id,
        name: candidate.player.web_name,
        cost: candidate.player.now_cost,
        xPoints: candidate.xPts,
      },
      netGain: Number((candidate.xPts - proj.xPoints).toFixed(2)),
      position: slot.position,
    });

    if (suggestions.length >= maxSuggestions) break;
  }

  return suggestions.sort((a, b) => b.netGain - a.netGain);
}
