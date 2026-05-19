// Find the 2-3 rivals immediately above the user in a classic mini-league
// and assemble the side-by-side squad context used by the rest of the app.

import {
  FplError,
  currentEvent,
  getBootstrap,
  getEntry,
  getLeagueStandings,
  getPicks,
  previousEvent,
  targetEvent,
} from "./client";
import type {
  FplBootstrap,
  FplLeagueStandingEntry,
  FplPick,
  ManagerSquad,
  Position,
  RivalContext,
  SquadSlot,
} from "@/lib/types";

const MAX_PAGES = 20; // safety cap when walking large leagues

async function walkStandingsForUser(
  leagueId: number,
  teamId: number,
): Promise<{ leagueName: string; allEntries: FplLeagueStandingEntry[]; userIndex: number }> {
  const collected: FplLeagueStandingEntry[] = [];
  let leagueName = "";
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await getLeagueStandings(leagueId, page);
    leagueName ||= res.league.name;
    collected.push(...res.standings.results);
    const idx = collected.findIndex((e) => e.entry === teamId);
    if (idx !== -1 && (!res.standings.has_next || idx >= 0)) {
      // We have the user; also keep walking one more page so we can show
      // the rivals above plus a comfortable context window. But for "above",
      // we already have everyone above since standings are sorted.
      return { leagueName, allEntries: collected, userIndex: idx };
    }
    if (!res.standings.has_next) break;
  }
  throw new FplError(404, `Team ${teamId} not found in league ${leagueId} (within ${MAX_PAGES} pages)`);
}

export function pickRivals(
  allEntries: FplLeagueStandingEntry[],
  userIndex: number,
  n = 3,
): FplLeagueStandingEntry[] {
  if (userIndex <= 0) {
    // User is the leader — return the closest chasers behind so we can defend the lead.
    return allEntries.slice(1, 1 + n);
  }
  const start = Math.max(0, userIndex - n);
  return allEntries.slice(start, userIndex);
}

function classifyPosition(elementType: number, types: FplBootstrap["element_types"]): Position {
  return (types.find((t) => t.id === elementType)?.singular_name_short ?? "MID") as Position;
}

function hydrateSquad(
  picks: FplPick[],
  bs: FplBootstrap,
): { slots: SquadSlot[]; missing: number[] } {
  const playersById = new Map(bs.elements.map((p) => [p.id, p]));
  const teamsById = new Map(bs.teams.map((t) => [t.id, t]));
  const slots: SquadSlot[] = [];
  const missing: number[] = [];
  for (const pick of picks) {
    const player = playersById.get(pick.element);
    if (!player) {
      missing.push(pick.element);
      continue;
    }
    const team = teamsById.get(player.team)!;
    slots.push({
      pick,
      player,
      team,
      position: classifyPosition(player.element_type, bs.element_types),
    });
  }
  return { slots, missing };
}

async function buildManagerSquad(
  teamId: number,
  gw: number,
  rankInfo: { rank: number; total: number; entry_name: string; player_name: string },
  bs: FplBootstrap,
): Promise<ManagerSquad> {
  const picks = await getPicks(teamId, gw);
  const { slots } = hydrateSquad(picks.picks, bs);
  const starters = slots.filter((s) => s.pick.multiplier > 0).sort((a, b) => a.pick.position - b.pick.position);
  const bench = slots.filter((s) => s.pick.multiplier === 0).sort((a, b) => a.pick.position - b.pick.position);
  return {
    entry: {
      id: teamId,
      name: rankInfo.entry_name,
      player_name: rankInfo.player_name,
      total: rankInfo.total,
      rank: rankInfo.rank,
    },
    gw,
    picks: slots,
    starters,
    bench,
    captain: slots.find((s) => s.pick.is_captain),
    viceCaptain: slots.find((s) => s.pick.is_vice_captain),
    activeChip: picks.active_chip,
  };
}

/** Resolve the GW we should base picks on. Near a deadline FPL hasn't yet
 *  exposed `picks` for the upcoming GW, so we fall back to the latest one we
 *  can actually fetch. */
async function resolvePicksGw(teamId: number, bs: FplBootstrap): Promise<number> {
  const cur = currentEvent(bs);
  const prev = previousEvent(bs);
  // Try current first (works during a running GW), fall back to previous.
  const candidates = [cur.id, prev?.id].filter((x): x is number => typeof x === "number");
  for (const gw of candidates) {
    try {
      await getPicks(teamId, gw);
      return gw;
    } catch (err) {
      if (err instanceof FplError && err.status === 404) continue;
      throw err;
    }
  }
  throw new FplError(404, `No picks available for team ${teamId}`);
}

export async function buildRivalContext(
  leagueId: number,
  teamId: number,
  n = 3,
): Promise<{ context: RivalContext; bs: FplBootstrap; targetGw: number }> {
  const [bs, { leagueName, allEntries, userIndex }] = await Promise.all([
    getBootstrap(),
    walkStandingsForUser(leagueId, teamId),
  ]);

  const userRow = allEntries[userIndex];
  const rivalRows = pickRivals(allEntries, userIndex, n);
  // Reverse so rivals[0] is the manager immediately above the user.
  const orderedRivals = [...rivalRows].reverse();

  // Always read picks for the latest accessible GW (same for user + rivals so the
  // comparison is consistent).
  const picksGw = await resolvePicksGw(teamId, bs);
  const target = targetEvent(bs);

  const [userSquad, ...rivalSquads] = await Promise.all([
    buildManagerSquad(
      userRow.entry,
      picksGw,
      {
        rank: userRow.rank,
        total: userRow.total,
        entry_name: userRow.entry_name,
        player_name: userRow.player_name,
      },
      bs,
    ),
    ...orderedRivals.map((row) =>
      buildManagerSquad(
        row.entry,
        picksGw,
        {
          rank: row.rank,
          total: row.total,
          entry_name: row.entry_name,
          player_name: row.player_name,
        },
        bs,
      ).catch(() => null),
    ),
  ]);

  const cleanRivals = rivalSquads.filter((s): s is ManagerSquad => s !== null);

  // Sanity: also fetch user entry metadata for richer info in case standings name is empty.
  const entry = await getEntry(teamId).catch(() => null);
  if (entry?.name) userSquad.entry.name = entry.name;

  return {
    context: { user: userSquad, rivals: cleanRivals, leagueName },
    bs,
    targetGw: target.id,
  };
}

/** Like buildRivalContext but returns every manager in the league (not just
 *  the N above the user). Used by the Live tab to render the full standings.
 *  Walks every standings page (capped at MAX_PAGES) so this is heavier than
 *  the default 3-rival path — expect 1 FPL call per manager for picks. */
export async function buildFullLeagueContext(
  leagueId: number,
  teamId: number,
): Promise<{ context: RivalContext; bs: FplBootstrap; targetGw: number }> {
  const [bs, walked] = await Promise.all([
    getBootstrap(),
    walkAllPages(leagueId, teamId),
  ]);
  const { leagueName, allEntries, userIndex } = walked;
  const userRow = allEntries[userIndex];

  const picksGw = await resolvePicksGw(teamId, bs);
  const target = targetEvent(bs);

  const allOthers = allEntries.filter((_, i) => i !== userIndex);
  const [userSquad, ...rivalSquads] = await Promise.all([
    buildManagerSquad(
      userRow.entry,
      picksGw,
      {
        rank: userRow.rank,
        total: userRow.total,
        entry_name: userRow.entry_name,
        player_name: userRow.player_name,
      },
      bs,
    ),
    ...allOthers.map((row) =>
      buildManagerSquad(
        row.entry,
        picksGw,
        {
          rank: row.rank,
          total: row.total,
          entry_name: row.entry_name,
          player_name: row.player_name,
        },
        bs,
      ).catch(() => null),
    ),
  ]);

  const cleanRivals = rivalSquads.filter((s): s is ManagerSquad => s !== null);
  const entry = await getEntry(teamId).catch(() => null);
  if (entry?.name) userSquad.entry.name = entry.name;

  return {
    context: { user: userSquad, rivals: cleanRivals, leagueName },
    bs,
    targetGw: target.id,
  };
}

async function walkAllPages(
  leagueId: number,
  teamId: number,
): Promise<{ leagueName: string; allEntries: FplLeagueStandingEntry[]; userIndex: number }> {
  const collected: FplLeagueStandingEntry[] = [];
  let leagueName = "";
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await getLeagueStandings(leagueId, page);
    leagueName ||= res.league.name;
    collected.push(...res.standings.results);
    if (!res.standings.has_next) break;
  }
  const userIndex = collected.findIndex((e) => e.entry === teamId);
  if (userIndex === -1) {
    throw new FplError(404, `Team ${teamId} not found in league ${leagueId} (within ${MAX_PAGES} pages)`);
  }
  return { leagueName, allEntries: collected, userIndex };
}

export function computeDifferentials(ctx: RivalContext) {
  // Players the user owns that NO rival owns (advantage) and vice-versa.
  const userIds = new Set(ctx.user.picks.map((s) => s.player.id));
  const rivalUnion = new Set<number>();
  ctx.rivals.forEach((r) => r.picks.forEach((s) => rivalUnion.add(s.player.id)));

  const userOnly = ctx.user.picks.filter((s) => !rivalUnion.has(s.player.id));
  const rivalOnly = ctx.rivals.flatMap((r) =>
    r.picks
      .filter((s) => !userIds.has(s.player.id))
      .map((s) => ({ rivalEntryId: r.entry.id, rivalName: r.entry.name, slot: s })),
  );

  // Dedupe rivalOnly by player id, keeping the first occurrence.
  const seen = new Set<number>();
  const dedupedRivalOnly = rivalOnly.filter((r) => {
    if (seen.has(r.slot.player.id)) return false;
    seen.add(r.slot.player.id);
    return true;
  });

  return { userOnly, rivalOnly: dedupedRivalOnly };
}
