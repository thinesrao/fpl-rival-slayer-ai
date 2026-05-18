"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Crown, Radio } from "lucide-react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { cn } from "@/lib/utils";

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

interface LiveResponse {
  gw: number;
  status: LiveStatus;
  inProgress: boolean;
  finished: boolean;
  bonusConfirmed?: boolean;
  deadlineIso: string;
  leagueName: string;
  user: ManagerLive | null;
  rivals: ManagerLive[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(body.message || body.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

interface Props {
  teamId: number;
  leagueId: number;
  refreshSignal?: number;
}

export function LivePanel({ teamId, leagueId, refreshSignal = 0 }: Props) {
  const bustNextRef = useRef(false);
  const q = useQuery({
    queryKey: ["live", teamId, leagueId],
    queryFn: () => {
      const refresh = bustNextRef.current ? "&refresh=1" : "";
      bustNextRef.current = false;
      return fetchJson<LiveResponse>(`/api/live?teamId=${teamId}&leagueId=${leagueId}${refresh}`);
    },
    refetchInterval: 60_000,
    retry: 0,
  });

  // External "Refresh" click bumps refreshSignal — refetch with cache-bust.
  useEffect(() => {
    if (refreshSignal > 0) {
      bustNextRef.current = true;
      q.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn’t load live data</AlertTitle>
        <AlertDescription>{(q.error as Error).message}</AlertDescription>
      </Alert>
    );
  }
  const data = q.data!;

  if (data.status === "pre" || !data.user) {
    return (
      <Alert>
        <Radio className="h-4 w-4" />
        <AlertTitle>No live gameweek</AlertTitle>
        <AlertDescription>
          GW {data.gw} hasn’t kicked off yet. The live tracker shows scores once the deadline passes.
        </AlertDescription>
      </Alert>
    );
  }

  const user = data.user;
  const rows = [user, ...data.rivals].sort((a, b) => b.liveScore - a.liveScore);
  const isFinished = data.status === "finished";

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs",
          isFinished ? "bg-muted/40" : "bg-success/10",
        )}
      >
        <Activity
          className={cn(
            "h-3.5 w-3.5",
            isFinished ? "text-muted-foreground" : "text-success animate-pulse",
          )}
        />
        <span className="font-medium">{isFinished ? "FINAL" : "LIVE"}</span>
        <span className="text-muted-foreground">
          GW {data.gw} ·{" "}
          {isFinished
            ? data.bonusConfirmed
              ? "all matches done, bonus confirmed"
              : "all matches done, bonus pending"
            : "auto-refreshes every 60s"}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isFinished ? "Final scoreboard" : "Live scoreboard"}</CardTitle>
          <CardDescription>
            {isFinished
              ? "Final GW points for you and the rivals immediately above."
              : "Your position right now vs the rivals immediately above."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-md border">
            {rows.map((m, i) => {
              const isUser = m.entryId === user.entryId;
              return (
                <li
                  key={m.entryId}
                  className={cn(
                    "flex flex-wrap items-center gap-3 px-3 py-3 text-sm",
                    isUser && "bg-primary/10",
                  )}
                >
                  <span className="w-6 text-center text-xs font-mono text-muted-foreground">#{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("truncate font-medium", isUser && "text-primary")}>
                        {m.name}
                      </span>
                      {isUser && <Badge variant="default" className="px-1.5 py-0 text-[10px] leading-none">YOU</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {m.managerName} · rank {m.rank}
                      {m.captain.name && (
                        <>
                          {" · "}
                          <Crown className="inline h-3 w-3" /> {m.captain.name}{" "}
                          ({m.captain.points} pts{m.captain.multiplier === 3 ? " ×3" : ""})
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold tabular-nums">
                      <AnimatedNumber value={m.liveScore} duration={0.6} />
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {m.played} played · {m.playing} live · {m.toPlay} to play
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Captain status</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {[user, ...data.rivals].map((m) => {
              const status =
                m.captain.minutes === 0
                  ? "yet to play"
                  : m.captain.minutes < 60
                  ? `${m.captain.minutes}'`
                  : "complete";
              return (
                <li key={m.entryId} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">
                      <Crown className="mr-1 inline h-3 w-3 text-warning" />
                      {m.captain.name ?? "—"}{" "}
                      <span className="text-xs text-muted-foreground">({m.name})</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{status}</span>
                  </div>
                  <Badge variant={m.captain.points > 0 ? "success" : "outline"}>{m.captain.points} pts</Badge>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
