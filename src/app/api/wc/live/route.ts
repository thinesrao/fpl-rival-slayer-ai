// Live matchday cockpit data: per-player round points for the user's XV,
// match states, confirmed lineups (when available), recent feed deltas, and
// computed action prompts (captain-rotation / bench-sub opportunities).

import { NextRequest, NextResponse } from "next/server";
import { getWcContext } from "@/lib/wc/context";
import {
  displayName,
  roundInProgress,
  roundLockTime,
  roundPointsFor,
  WcFeedError,
} from "@/lib/wc/fifa/client";
import type { WcMatch, WcPlayer } from "@/lib/wc/fifa/types";
import { ensureSnapshot, recentDeltas } from "@/lib/wc/snapshot";
import { kvGet } from "@/lib/store/redis";
import { isWcSquadState, type WcSquadState } from "@/lib/wc/squad/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function matchFinished(m: WcMatch): boolean {
  return m.status === "complete" || m.period === "full_time";
}

function matchStartedOrLive(m: WcMatch): boolean {
  return m.period !== "pre_match";
}

export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get("uid") ?? "";

  try {
    await ensureSnapshot().catch(() => {});
    const ctx = await getWcContext();
    const round = ctx.active ?? ctx.target;

    let squad: WcSquadState | null = null;
    if (uid) squad = await kvGet<WcSquadState>(`wc:squad:${uid}`).then((s) => (isWcSquadState(s) ? s : null));

    const matches = [...round.tournaments].sort((a, b) => a.date.localeCompare(b.date));

    // Confirmed lineups come straight from the official feed: matchStatus is
    // set to start/sub/not_in_squad per player the moment XIs are announced.
    const lineupKnownSquads = new Set(
      ctx.players.filter((p) => p.matchStatus != null).map((p) => p.squadId),
    );

    const playerRows = (squad?.picks ?? [])
      .map((id) => ctx.playerById.get(id))
      .filter((p): p is WcPlayer => Boolean(p))
      .map((p) => {
        const team = ctx.teamIndex.byId.get(p.squadId);
        const match = matches.find((m) => m.homeSquadId === p.squadId || m.awaySquadId === p.squadId) ?? null;
        const roundPts = roundPointsFor(p, round.id);
        const lineupStatus: "starts" | "benched" | "out" | "unknown" =
          p.matchStatus === "start"
            ? "starts"
            : p.matchStatus === "sub"
              ? "benched"
              : p.matchStatus === "not_in_squad"
                ? "out"
                : "unknown";
        return {
          id: p.id,
          name: displayName(p),
          team: team?.abbr ?? "?",
          position: p.position,
          isXI: squad?.startingXI.includes(p.id) ?? false,
          isCaptain: squad?.captainId === p.id,
          isVice: squad?.viceId === p.id,
          roundPoints: roundPts,
          played: match ? matchStartedOrLive(match) : false,
          finished: match ? matchFinished(match) : false,
          matchId: match?.id ?? null,
          kickoff: match?.date ?? null,
          lineupStatus,
          status: p.status,
        };
      });

    // Action prompts — the live edges this game uniquely allows.
    const prompts: string[] = [];
    if (squad && roundInProgress(round)) {
      // Post-match digest: after each finished match involving owned players,
      // summarise their hauls and nudge the next move.
      const finishedWithMine = matches.filter(
        (m) => matchFinished(m) && playerRows.some((r) => r.matchId === m.id),
      );
      for (const m of finishedWithMine) {
        const mine = playerRows.filter((r) => r.matchId === m.id);
        const summary = mine
          .map((r) => `${r.name} ${r.roundPoints ?? 0}pts${r.isCaptain ? " (C, doubled)" : ""}`)
          .join(", ");
        prompts.push(
          `FT ${m.homeSquadAbbr} ${m.homeScore}-${m.awayScore} ${m.awaySquadAbbr}: ${summary}. ` +
            `Re-run the Coach for your next move based on these returns.`,
        );
      }
      const cap = playerRows.find((r) => r.isCaptain);
      const upcoming = playerRows.filter((r) => r.isXI && !r.played && !r.isCaptain);
      if (cap?.finished && (cap.roundPoints ?? 0) <= 4 && upcoming.length > 0) {
        prompts.push(
          `Your captain ${cap.name} finished on ${cap.roundPoints} pts — you can still move the armband to ` +
            upcoming.slice(0, 3).map((r) => `${r.name} (${new Date(r.kickoff ?? "").toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })})`).join(", ") +
            `.`,
        );
      }
      for (const r of playerRows) {
        if (r.isXI && (r.lineupStatus === "benched" || r.lineupStatus === "out") && !r.played) {
          prompts.push(
            `${r.name} is ${r.lineupStatus === "out" ? "NOT in the matchday squad" : "on the real-life bench"} — consider a manual bench swap before kickoff.`,
          );
        }
      }
      for (const r of playerRows) {
        if (!r.isXI && r.lineupStatus === "starts" && !r.played) {
          prompts.push(`Bench player ${r.name} IS in the confirmed XI — swap him in if a starter is benched.`);
        }
      }
    }

    const liveTotal = playerRows
      .filter((r) => r.isXI)
      .reduce((s, r) => s + (r.roundPoints ?? 0) * (r.isCaptain ? 2 : 1), 0);

    return NextResponse.json({
      roundId: round.id,
      roundStage: round.stage,
      roundStatus: round.status,
      lockIso: roundLockTime(round).toISOString(),
      matches: matches.map((m) => ({
        id: m.id,
        date: m.date,
        period: m.period,
        minutes: m.minutes,
        status: m.status,
        home: { abbr: m.homeSquadAbbr, name: m.homeSquadName, score: m.homeScore },
        away: { abbr: m.awaySquadAbbr, name: m.awaySquadName, score: m.awayScore },
        venueCity: m.venueCity,
        hasLineups:
          (m.homeSquadId != null && lineupKnownSquads.has(m.homeSquadId)) ||
          (m.awaySquadId != null && lineupKnownSquads.has(m.awaySquadId)),
      })),
      players: playerRows,
      liveTotal,
      prompts,
      deltas: await recentDeltas(12),
      hasSquad: Boolean(squad && squad.picks.length === 15),
    });
  } catch (err) {
    const status = err instanceof WcFeedError ? 502 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status },
    );
  }
}
