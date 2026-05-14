// Candidate ranking for the What-If swap simulator: given a player to sell
// (outPlayer), return the top N same-position FPL-pool players the user can
// actually afford, ranked by projected xPts for the target GW.
//
// Filters:
//   - Same FPL position (1=GKP, 2=DEF, 3=MID, 4=FWD)
//   - now_cost <= outPlayer.now_cost + bank
//   - Not already owned (in `ownedIds`)
//   - Status must be playable: 'a' (available) or 'd' (doubt). Skip 'i','n','s','u'.
//   - Honour the 3-per-team cap: if user already has 3 from `inTeam`, exclude.

import { projectPlayer } from "@/lib/projections/model";
import type { FplBootstrap, FplElement, FplFixture, Position } from "@/lib/types";

const POS_BY_ID: Record<number, Position> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

export interface SwapCandidate {
  playerId: number;
  webName: string;
  teamId: number;
  teamShort: string;
  cost: number; // tenths of £m
  xPoints: number;
  selectedByPct: number; // global ownership
  injuryRisk: number; // 0..1
  notes: string[];
  status: FplElement["status"];
}

export interface RankReplacementsArgs {
  outPlayer: FplElement;
  bank: number; // tenths of £m
  ownedIds: Set<number>;
  teamCounts: Map<number, number>; // team_id -> count of squad players from that team (excluding outPlayer)
  bs: FplBootstrap;
  fixtures: FplFixture[];
  gw: number;
  limit?: number;
}

export function rankReplacements(args: RankReplacementsArgs): SwapCandidate[] {
  const { outPlayer, bank, ownedIds, teamCounts, bs, fixtures, gw, limit = 10 } = args;

  const targetPos = POS_BY_ID[outPlayer.element_type];
  const budget = outPlayer.now_cost + bank;
  const teamsById = new Map(bs.teams.map((t) => [t.id, t]));

  const out: SwapCandidate[] = [];
  for (const p of bs.elements) {
    if (p.id === outPlayer.id) continue;
    if (ownedIds.has(p.id)) continue;
    if (p.element_type !== outPlayer.element_type) continue;
    if (p.now_cost > budget) continue;
    if (p.status === "u" || p.status === "n" || p.status === "i" || p.status === "s") continue;
    // 3-per-team cap: only fail if the incoming team already has 3 (the OUT
    // player's team has been pre-decremented in teamCounts by the caller).
    if ((teamCounts.get(p.team) ?? 0) >= 3) continue;
    const team = teamsById.get(p.team);
    if (!team) continue;
    const proj = projectPlayer({ player: p, team, position: targetPos, fixtures, gw, bs });
    out.push({
      playerId: p.id,
      webName: p.web_name,
      teamId: p.team,
      teamShort: team.short_name,
      cost: p.now_cost,
      xPoints: proj.xPoints,
      selectedByPct: Number(p.selected_by_percent) || 0,
      injuryRisk: proj.injuryRisk,
      notes: proj.notes,
      status: p.status,
    });
  }

  out.sort((a, b) => b.xPoints - a.xPoints);
  return out.slice(0, limit);
}
