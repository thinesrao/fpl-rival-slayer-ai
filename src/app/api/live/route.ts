import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import {
  FplError,
  bustBootstrap,
  currentEvent,
  getBootstrap,
  getFixtures,
  getLive,
  getPicks,
} from "@/lib/fpl/client";
import { buildRivalContext } from "@/lib/fpl/rivals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  teamId: z.coerce.number().int().positive(),
  leagueId: z.coerce.number().int().positive(),
  n: z.coerce.number().int().min(1).max(5).default(3),
  refresh: z.coerce.number().int().min(0).max(1).default(0),
});

interface ManagerLive {
  entryId: number;
  name: string;
  managerName: string;
  rank: number;
  liveScore: number;
  played: number;
  toPlay: number;
  playing: number;
  captain: { name: string | null; points: number; minutes: number; multiplier: number };
  benchPoints: number;
}

type LiveStatus = "pre" | "live" | "finished";

export async function GET(req: NextRequest) {
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.refresh) {
    bustBootstrap();
    revalidateTag("fpl-live-gw");
    revalidateTag("fpl-live");
    revalidateTag("fpl-fixtures");
  }

  try {
    const bs = await getBootstrap();
    const cur = currentEvent(bs);
    const deadlinePassed = Date.now() >= new Date(cur.deadline_time).getTime();

    // Pre-deadline: nothing to score yet.
    if (!deadlinePassed) {
      return NextResponse.json({
        gw: cur.id,
        status: "pre" as LiveStatus,
        inProgress: false,
        finished: false,
        deadlineIso: cur.deadline_time,
        leagueName: "",
        user: null,
        rivals: [],
      });
    }

    const [{ context }, live, fixtures] = await Promise.all([
      buildRivalContext(parsed.data.leagueId, parsed.data.teamId, parsed.data.n),
      getLive(cur.id),
      getFixtures(cur.id),
    ]);

    const liveById = new Map(live.elements.map((e) => [e.id, e.stats]));
    const teamFixtureStatus = new Map<number, "played" | "playing" | "to_play">();
    for (const fx of fixtures) {
      const status = fx.finished
        ? "played"
        : fx.kickoff_time && new Date(fx.kickoff_time).getTime() <= Date.now()
        ? "playing"
        : "to_play";
      teamFixtureStatus.set(fx.team_h, status);
      teamFixtureStatus.set(fx.team_a, status);
    }

    const buildManagerLive = async (
      squad: typeof context.user,
      role: "user" | "rival",
    ): Promise<ManagerLive> => {
      // Pull live picks so we use the post-deadline lineup if it changed.
      const livePicks = await getPicks(squad.entry.id, cur.id).catch(() => null);
      const picks = livePicks?.picks ?? squad.picks.map((s) => s.pick);

      let liveScore = 0;
      let benchPoints = 0;
      let played = 0;
      let toPlay = 0;
      let playing = 0;
      let captainName: string | null = null;
      let captainPoints = 0;
      let captainMinutes = 0;
      let captainMultiplier = 0;

      for (const pick of picks) {
        const stat = liveById.get(pick.element);
        const pts = stat?.total_points ?? 0;
        const minutes = stat?.minutes ?? 0;
        const slot = squad.picks.find((s) => s.player.id === pick.element);
        const teamId = slot?.team.id;
        const status = teamId ? teamFixtureStatus.get(teamId) : "to_play";

        if (pick.multiplier > 0) {
          liveScore += pts * pick.multiplier;
          if (status === "played") played++;
          else if (status === "playing") playing++;
          else toPlay++;
        } else {
          benchPoints += pts;
        }
        if (pick.multiplier >= 2) {
          captainName = slot?.player.web_name ?? null;
          captainPoints = pts * pick.multiplier;
          captainMinutes = minutes;
          captainMultiplier = pick.multiplier;
        }
      }

      void role;
      return {
        entryId: squad.entry.id,
        name: squad.entry.name,
        managerName: squad.entry.player_name,
        rank: squad.entry.rank,
        liveScore,
        played,
        toPlay,
        playing,
        captain: { name: captainName, points: captainPoints, minutes: captainMinutes, multiplier: captainMultiplier },
        benchPoints,
      };
    };

    const [userLive, ...rivalsLive] = await Promise.all([
      buildManagerLive(context.user, "user"),
      ...context.rivals.map((r) => buildManagerLive(r, "rival")),
    ]);

    const allFixturesDone = fixtures.length > 0 && fixtures.every((fx) => fx.finished);
    const status: LiveStatus = allFixturesDone || cur.finished ? "finished" : "live";

    return NextResponse.json({
      gw: cur.id,
      status,
      inProgress: status === "live",
      finished: status === "finished",
      bonusConfirmed: cur.finished,
      deadlineIso: cur.deadline_time,
      leagueName: context.leagueName,
      user: userLive,
      rivals: rivalsLive,
    });
  } catch (err) {
    if (err instanceof FplError) {
      return NextResponse.json({ error: "fpl_error", status: err.status, message: err.message }, {
        status: err.status === 404 ? 404 : 502,
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}
