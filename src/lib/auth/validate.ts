import { FplError, getEntry, getLeagueStandings } from "@/lib/fpl/client";

export interface ValidatedTeam {
  ok: true;
  team: {
    id: number;
    name: string;
    managerName: string;
    totalPoints: number;
    rank: number | null;
  };
  league: { id: number; name: string };
  leagueMembershipChecked: boolean;
}

export interface ValidationError {
  ok: false;
  error: "team_not_found" | "league_not_found" | "team_not_in_league" | "fpl_error";
  message: string;
}

export type ValidationResult = ValidatedTeam | ValidationError;

export async function validateTeamAndLeague(
  teamId: number,
  leagueId: number,
): Promise<ValidationResult> {
  const [entryRes, standingsRes] = await Promise.allSettled([
    getEntry(teamId),
    getLeagueStandings(leagueId, 1),
  ]);

  if (entryRes.status === "rejected") {
    const err = entryRes.reason;
    if (err instanceof FplError && err.status === 404) {
      return { ok: false, error: "team_not_found", message: `Team ID ${teamId} not found on FPL.` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "fpl_error", message: msg };
  }

  if (standingsRes.status === "rejected") {
    const err = standingsRes.reason;
    if (err instanceof FplError && err.status === 404) {
      return { ok: false, error: "league_not_found", message: `League ID ${leagueId} not found on FPL.` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "fpl_error", message: msg };
  }

  const entry = entryRes.value;
  const standings = standingsRes.value;

  const membershipRow = standings.standings.results.find((r) => r.entry === teamId);
  // Page 1 covers the top 50. If the team is ranked deeper we can't cheaply
  // confirm membership without walking pages, so we soft-pass and let the
  // dashboard's own data fetches surface any real mismatch.
  const leagueMembershipChecked = Boolean(membershipRow);

  const managerName = `${entry.player_first_name} ${entry.player_last_name}`.trim();

  return {
    ok: true,
    team: {
      id: entry.id,
      name: entry.name,
      managerName,
      totalPoints: entry.summary_overall_points ?? 0,
      rank: membershipRow?.rank ?? null,
    },
    league: { id: standings.league.id, name: standings.league.name },
    leagueMembershipChecked,
  };
}
