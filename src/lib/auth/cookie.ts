import { cookies } from "next/headers";

export const ACTIVE_COOKIE = "rs:active";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface ActiveTeam {
  teamId: number;
  leagueId: number;
}

export async function readActiveTeamCookie(): Promise<ActiveTeam | null> {
  const store = await cookies();
  const raw = store.get(ACTIVE_COOKIE)?.value;
  if (!raw) return null;
  const [t, l] = raw.split(".");
  const teamId = Number(t);
  const leagueId = Number(l);
  if (!Number.isInteger(teamId) || teamId <= 0) return null;
  if (!Number.isInteger(leagueId) || leagueId <= 0) return null;
  return { teamId, leagueId };
}

export async function setActiveTeamCookie(teamId: number, leagueId: number): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_COOKIE, `${teamId}.${leagueId}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearActiveTeamCookie(): Promise<void> {
  const store = await cookies();
  store.delete(ACTIVE_COOKIE);
}
