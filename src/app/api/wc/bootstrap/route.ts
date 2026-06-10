// Single client data dependency for the WC dashboard: slim player rows with
// resolved nations + next opponent, the 48 teams, round skeletons, and the
// rules for the round being planned. ~250KB instead of the raw 1.1MB feed.

import { NextResponse } from "next/server";
import { getWcContext, opponentInRound } from "@/lib/wc/context";
import { WcFeedError } from "@/lib/wc/fifa/client";
import { displayName } from "@/lib/wc/fifa/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getWcContext();
    const { teamIndex, target } = ctx;

    const players = ctx.players
      .filter((p) => p.status !== "transferred")
      .map((p) => {
        const team = teamIndex.byId.get(p.squadId);
        const opp = opponentInRound(target, p.squadId);
        return {
          id: p.id,
          name: displayName(p),
          position: p.position,
          price: p.price,
          status: p.status,
          percentSelected: p.percentSelected,
          totalPoints: p.stats.totalPoints,
          form: p.stats.form,
          lastRoundPoints: p.stats.lastRoundPoints,
          oneToWatch: p.oneToWatch,
          team: team?.abbr ?? "?",
          teamName: team?.name ?? "?",
          group: team?.group ?? "?",
          teamStrengthRank: team?.strengthRank ?? 48,
          nextOpponent: opp?.label ?? null,
          nextKickoff: opp?.match.date ?? null,
        };
      });

    const rounds = ctx.rounds.map((r) => ({
      id: r.id,
      status: r.status,
      stage: r.stage,
      startDate: r.startDate,
      endDate: r.endDate,
      matchCount: r.tournaments.length,
    }));

    return NextResponse.json({
      players,
      teams: teamIndex.teams,
      rounds,
      activeRoundId: ctx.active?.id ?? null,
      targetRoundId: target.id,
      targetLockIso: ctx.targetLockIso,
      rules: {
        ...ctx.targetRules,
        // Infinity doesn't survive JSON — encode unlimited as -1.
        freeTransfers: Number.isFinite(ctx.targetRules.freeTransfers)
          ? ctx.targetRules.freeTransfers
          : -1,
      },
    });
  } catch (err) {
    const status = err instanceof WcFeedError ? 502 : 500;
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status });
  }
}
