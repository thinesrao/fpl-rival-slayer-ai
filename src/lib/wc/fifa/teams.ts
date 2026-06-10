// Derives the 48 World Cup 2026 teams from rounds.json + players.json.
//
// Why not squads_fifa.json? That file still serves the 2022 tournament
// (32 teams, Qatar in group A) and its ids don't join to anything in the 2026
// feed. The 2026 match objects, however, embed each side's small-int squadId
// AND its name/abbr — and the group-stage pairing graph partitions cleanly
// into 12 components of 4, which we label A..L in kickoff order (matching the
// official draw's schedule ordering).
//
// Team strength has no direct field in the feed, so we proxy it with the sum
// of the team's 11 priciest active players — FIFA's own pricing encodes squad
// quality (ENG/FRA/ESP top out, minnows bottom).

import type { WcPlayer, WcRound, WcTeam } from "./types";

export interface WcTeamIndex {
  byId: Map<number, WcTeam>;
  teams: WcTeam[];
}

export function buildTeamIndex(rounds: WcRound[], players: WcPlayer[]): WcTeamIndex {
  const names = new Map<number, { name: string; abbr: string }>();
  const adj = new Map<number, Set<number>>();

  for (const round of rounds) {
    for (const m of round.tournaments) {
      const sides = [
        { id: m.homeSquadId, name: m.homeSquadName, abbr: m.homeSquadAbbr },
        { id: m.awaySquadId, name: m.awaySquadName, abbr: m.awaySquadAbbr },
      ];
      for (const s of sides) {
        if (s.id != null && s.abbr && !names.has(s.id)) {
          names.set(s.id, { name: s.name ?? s.abbr, abbr: s.abbr });
        }
      }
      if (round.stage === "GROUP" && m.homeSquadId != null && m.awaySquadId != null) {
        if (!adj.has(m.homeSquadId)) adj.set(m.homeSquadId, new Set());
        if (!adj.has(m.awaySquadId)) adj.set(m.awaySquadId, new Set());
        adj.get(m.homeSquadId)!.add(m.awaySquadId);
        adj.get(m.awaySquadId)!.add(m.homeSquadId);
      }
    }
  }

  // Connected components of the group-stage graph = the groups.
  const seen = new Set<number>();
  const components: number[][] = [];
  for (const start of [...adj.keys()].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const comp: number[] = [];
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      comp.push(cur);
      for (const n of adj.get(cur) ?? []) if (!seen.has(n)) stack.push(n);
    }
    components.push(comp.sort((a, b) => a - b));
  }

  // Label groups A..L by each component's earliest group-stage kickoff.
  const firstKickoff = new Map<number, number>();
  for (const round of rounds) {
    if (round.stage !== "GROUP") continue;
    for (const m of round.tournaments) {
      const t = new Date(m.date).getTime();
      for (const id of [m.homeSquadId, m.awaySquadId]) {
        if (id == null) continue;
        firstKickoff.set(id, Math.min(firstKickoff.get(id) ?? Infinity, t));
      }
    }
  }
  components.sort(
    (a, b) =>
      Math.min(...a.map((id) => firstKickoff.get(id) ?? Infinity)) -
      Math.min(...b.map((id) => firstKickoff.get(id) ?? Infinity)),
  );

  const groupOf = new Map<number, string>();
  components.forEach((comp, i) => {
    const label = String.fromCharCode(65 + i);
    for (const id of comp) groupOf.set(id, label);
  });

  // Strength: sum of the 11 priciest active players per team.
  const prices = new Map<number, number[]>();
  for (const p of players) {
    if (p.status !== "playing") continue;
    if (!prices.has(p.squadId)) prices.set(p.squadId, []);
    prices.get(p.squadId)!.push(p.price);
  }
  const strengthOf = new Map<number, number>();
  for (const [id, list] of prices) {
    const top11 = list.sort((a, b) => b - a).slice(0, 11);
    strengthOf.set(id, Math.round(top11.reduce((s, v) => s + v, 0) * 10) / 10);
  }

  const ranked = [...names.keys()].sort(
    (a, b) => (strengthOf.get(b) ?? 0) - (strengthOf.get(a) ?? 0),
  );
  const rankOf = new Map(ranked.map((id, i) => [id, i + 1] as const));

  const teams: WcTeam[] = [...names.entries()]
    .map(([id, { name, abbr }]) => ({
      id,
      name,
      abbr,
      group: groupOf.get(id) ?? "?",
      strength: strengthOf.get(id) ?? 0,
      strengthRank: rankOf.get(id) ?? 48,
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || b.strength - a.strength);

  // Fail loudly if the feed shape drifts — every player must resolve to a team.
  const ids = new Set(names.keys());
  const orphanSquadIds = new Set(players.filter((p) => !ids.has(p.squadId)).map((p) => p.squadId));
  if (orphanSquadIds.size > 0) {
    throw new Error(
      `[wc/teams] ${orphanSquadIds.size} squadIds in players.json have no match in rounds.json: ` +
        [...orphanSquadIds].slice(0, 10).join(","),
    );
  }

  return { byId: new Map(teams.map((t) => [t.id, t])), teams };
}
