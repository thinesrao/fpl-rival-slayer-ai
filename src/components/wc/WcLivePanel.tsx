"use client";

// Live matchday cockpit: official round points for the user's XV, match
// states, confirmed-XI badges, action prompts, and feed deltas. Polls every
// 60s while the round is live.

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, BellRing, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { flagEmoji } from "@/lib/wc/flags";
import { getOrCreateUid } from "@/lib/wc/squad/storage";
import type { WcSquadState } from "@/lib/wc/squad/types";
import type { WcBootstrap } from "./useWcData";

interface LiveResponse {
  roundId: number;
  roundStage: string;
  roundStatus: string;
  lockIso: string;
  matches: Array<{
    id: number;
    date: string;
    period: string;
    minutes: number;
    status: string;
    home: { abbr: string | null; name: string | null; score: number | null };
    away: { abbr: string | null; name: string | null; score: number | null };
    venueCity: string | null;
    hasLineups: boolean;
  }>;
  players: Array<{
    id: number;
    name: string;
    team: string;
    position: string;
    isXI: boolean;
    isCaptain: boolean;
    isVice: boolean;
    roundPoints: number | null;
    played: boolean;
    finished: boolean;
    kickoff: string | null;
    lineupStatus: "starts" | "benched" | "out" | "unknown";
    status: string;
  }>;
  liveTotal: number;
  prompts: string[];
  deltas: Array<{ at: string; player: string; detail: string; kind: string }>;
  hasSquad: boolean;
  error?: string;
}

export function WcLivePanel({ squad }: { data?: WcBootstrap; squad: WcSquadState }) {
  const { data: live, isLoading } = useQuery<LiveResponse>({
    queryKey: ["wc-live"],
    queryFn: async () => {
      const res = await fetch(`/api/wc/live?uid=${encodeURIComponent(getOrCreateUid())}`);
      if (!res.ok) throw new Error("live fetch failed");
      return res.json();
    },
    refetchInterval: (q) => {
      const s = q.state.data?.roundStatus;
      return s && s !== "scheduled" && s !== "complete" ? 60_000 : 5 * 60_000;
    },
    staleTime: 30_000,
  });

  if (isLoading || !live) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  const isLive = live.roundStatus !== "scheduled" && live.roundStatus !== "complete";
  const xi = live.players.filter((p) => p.isXI);
  const bench = live.players.filter((p) => !p.isXI);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
        <Radio className={cn("h-5 w-5", isLive ? "animate-pulse text-emerald-400" : "text-muted-foreground")} />
        <div>
          <div className="font-display text-sm font-bold uppercase">
            Round {live.roundId} · {live.roundStage}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {isLive ? "LIVE" : live.roundStatus}
          </div>
        </div>
        {live.hasSquad && (
          <div className="ml-auto text-right">
            <div className="font-display text-3xl font-extrabold tabular-nums text-fut-gold">{live.liveTotal}</div>
            <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">round pts (C×2)</div>
          </div>
        )}
      </div>

      {/* Action prompts */}
      {live.prompts.length > 0 && (
        <div className="space-y-1.5">
          {live.prompts.map((p, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {p}
            </div>
          ))}
        </div>
      )}

      {!live.hasSquad && (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5" /> Build your squad to track live points here. (Squad in this
          browser: {squad.picks.length}/15 — it syncs once saved.)
        </div>
      )}

      {/* Squad live points */}
      {live.players.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Your XV — round {live.roundId}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {[...xi, ...bench].map((p, i) => (
              <div key={p.id}>
                {i === xi.length && (
                  <div className="mb-1 mt-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Bench</div>
                )}
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-md border bg-card px-2 py-1.5",
                    !p.isXI && "opacity-70",
                  )}
                >
                  <span>{flagEmoji(p.team)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {p.name}
                    {p.isCaptain && <span className="ml-1 rounded bg-fut-gold/90 px-1 font-mono text-[9px] font-bold text-zinc-900">C</span>}
                    {p.isVice && <span className="ml-1 rounded bg-zinc-300 px-1 font-mono text-[9px] font-bold text-zinc-900">V</span>}
                  </span>
                  {p.lineupStatus === "starts" && !p.played && (
                    <Badge variant="outline" className="border-emerald-500/50 px-1 py-0 text-[9px] text-emerald-300">XI confirmed</Badge>
                  )}
                  {p.lineupStatus === "benched" && !p.played && (
                    <Badge variant="outline" className="border-amber-500/50 px-1 py-0 text-[9px] text-amber-300">on bench IRL</Badge>
                  )}
                  {p.lineupStatus === "out" && (
                    <Badge variant="outline" className="border-red-500/50 px-1 py-0 text-[9px] text-red-300">not in squad</Badge>
                  )}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {p.finished ? "FT" : p.played ? "LIVE" : p.kickoff ? new Date(p.kickoff).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—"}
                  </span>
                  <span
                    className={cn(
                      "w-9 text-right font-mono text-sm font-bold tabular-nums",
                      (p.roundPoints ?? 0) > 0 ? "text-emerald-300" : "text-muted-foreground",
                    )}
                  >
                    {p.roundPoints != null ? p.roundPoints * (p.isCaptain ? 2 : 1) : "·"}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Matches */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Round {live.roundId} matches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {live.matches.map((m) => {
            const inPlay = m.period !== "pre_match" && m.status !== "complete";
            return (
              <div key={m.id} className={cn("flex items-center gap-2 rounded-md border px-2 py-1.5", inPlay && "border-emerald-500/50")}>
                <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-right">
                  <span className="truncate text-sm">{m.home.name ?? "TBD"}</span>
                  <span>{m.home.abbr ? flagEmoji(m.home.abbr) : "❓"}</span>
                </div>
                <div className="w-16 shrink-0 text-center">
                  {m.home.score != null ? (
                    <span className="font-mono text-sm font-bold tabular-nums">
                      {m.home.score}–{m.away.score}
                    </span>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(m.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                  {inPlay && (
                    <div className="font-mono text-[9px] font-bold uppercase text-emerald-400">
                      {m.period.replace("_", " ")} {m.minutes > 0 ? `${m.minutes}'` : ""}
                    </div>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span>{m.away.abbr ? flagEmoji(m.away.abbr) : "❓"}</span>
                  <span className="truncate text-sm">{m.away.name ?? "TBD"}</span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Feed deltas */}
      {live.deltas.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Official feed changes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {live.deltas.map((d, i) => (
              <div key={i}>
                <span className="font-mono text-[10px]">{d.at.slice(5, 16).replace("T", " ")}</span>{" "}
                <span className="font-semibold text-foreground">{d.player}</span> {d.detail}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Official points from the FIFA fantasy feed · refreshes every {isLive ? "60s" : "5min"}
        {" · "}data is informational — confirm moves on play.fifa.com
      </p>
    </div>
  );
}
