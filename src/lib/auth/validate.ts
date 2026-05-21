import { FplError, getEntry, getLeagueStandings } from "@/lib/fpl/client";

export interface MiniLeagueOption {
  id: number;
  name: string;
  rank: number | null;
  size: number;
}

export interface ValidatedTeam {
  ok: true;
  team: {
    id: number;
    name: string;
    managerName: string;
    totalPoints: number;
    rank: number | null;
  };
  // Present when leagueId was provided AND validated successfully.
  league: { id: number; name: string } | null;
  leagueMembershipChecked: boolean;
  // All invitational mini-leagues this team is in (sorted: smallest first —
  // these are typically the friend/work leagues people care about most).
  miniLeagues: MiniLeagueOption[];
}

export interface ValidationError {
  ok: false;
  error: "team_not_found" | "league_not_found" | "team_not_in_league" | "fpl_error";
  message: string;
}

export type ValidationResult = ValidatedTeam | ValidationError;

export async function validateTeam(
  teamId: number,
  leagueId: number | null,
): Promise<ValidationResult> {
  const [entryRes, standingsRes] = await Promise.allSettled([
    getEntry(teamId),
    leagueId ? getLeagueStandings(leagueId, 1) : Promise.resolve(null),
  ]);

  if (entryRes.status === "rejected") {
    const err = entryRes.reason;
    if (err instanceof FplError && err.status === 404) {
      return { ok: false, error: "team_not_found", message: `Team ID ${teamId} not found on FPL.` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "fpl_error", message: msg };
  }

  const entry = entryRes.value;

  let league: { id: number; name: string } | null = null;
  let leagueMembershipChecked = false;
  if (leagueId) {
    if (standingsRes.status === "rejected") {
      const err = standingsRes.reason;
      if (err instanceof FplError && err.status === 404) {
        return { ok: false, error: "league_not_found", message: `League ID ${leagueId} not found on FPL.` };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: "fpl_error", message: msg };
    }
    const standings = standingsRes.value!;
    const row = standings.standings.results.find((r) => r.entry === teamId);
    leagueMembershipChecked = Boolean(row);
    league = { id: standings.league.id, name: standings.league.name };
  }

  const miniLeagues: MiniLeagueOption[] = (entry.leagues?.classic ?? [])
    .filter((l) => l.league_type === "x")
    .map((l) => ({ id: l.id, name: l.name, rank: l.entry_rank, size: l.rank_count }))
    // Smaller leagues first — those are the leagues with stakes (mates, work).
    .sort((a, b) => a.size - b.size);

  const managerName = `${entry.player_first_name} ${entry.player_last_name}`.trim();
  const overallRank = entry.summary_overall_rank;
  // Fall back to overall rank when no specific league was provided.
  const displayRank = league
    ? (entry.leagues?.classic ?? []).find((l) => l.id === league!.id)?.entry_rank ?? overallRank
    : overallRank;

  return {
    ok: true,
    team: {
      id: entry.id,
      name: entry.name,
      managerName,
      totalPoints: entry.summary_overall_points ?? 0,
      rank: displayRank,
    },
    league,
    leagueMembershipChecked,
    miniLeagues,
  };
}
