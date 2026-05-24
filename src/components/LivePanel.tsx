"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Activity, ChevronDown, ChevronUp, Crown, Radio, Target } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { PlayerPhoto } from "@/components/PlayerPhoto";
import { cn } from "@/lib/utils";

interface ManagerLive {
  entryId: number;
  name: string;
  managerName: string;
  rank: number;
  /** Season total points before the current GW. */
  total: number;
  liveScore: number;
  played: number;
  toPlay: number;
  playing: number;
  captain: {
    name: string | null;
    code: number | null;
    elementType: number | null;
    teamShort: string | null;
    points: number;
    minutes: number;
    multiplier: number;
  };
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
  headlineRivalIds: number[];
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

type SortMode = "gw" | "season";

export function LivePanel({ teamId, leagueId, refreshSignal = 0 }: Props) {
  const bustNextRef = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("gw");

  const q = useQuery({
    queryKey: ["live-full", teamId, leagueId],
    queryFn: () => {
      const refresh = bustNextRef.current ? "&refresh=1" : "";
      bustNextRef.current = false;
      return fetchJson<LiveResponse>(
        `/api/live?teamId=${teamId}&leagueId=${leagueId}&mode=full${refresh}`,
      );
    },
    refetchInterval: 60_000,
    retry: 0,
  });

  useEffect(() => {
    if (refreshSignal > 0) {
      bustNextRef.current = true;
      q.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const rows = useMemo(() => {
    if (!q.data?.user) return [];
    const everyone = [q.data.user, ...q.data.rivals];
    if (sortMode === "season") {
      // Mirror the official FPL standings exactly — use the rank field returned
      // by /leagues-classic/{id}/standings/. Don't add liveScore: `total` from
      // FPL already includes the latest finished GW once standings update, so
      // adding it again would double-count and shift positions vs the FPL app.
      return everyone.slice().sort((a, b) => a.rank - b.rank);
    }
    return everyone.sort((a, b) => b.liveScore - a.liveScore);
  }, [q.data, sortMode]);

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load live data</AlertTitle>
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
          GW {data.gw} hasn&apos;t kicked off yet. The live tracker shows scores once the deadline passes.
        </AlertDescription>
      </Alert>
    );
  }

  const user = data.user;
  const headlineIds = new Set(data.headlineRivalIds);
  const isFinished = data.status === "finished";

  // Collapsed view shows you + 3 headline rivals + 2 above/below; expanded shows all.
  const visibleRows = collapsed
    ? rows.filter((m) => m.entryId === user.entryId || headlineIds.has(m.entryId))
    : rows;

  const userPositionInRows = rows.findIndex((r) => r.entryId === user.entryId);
  const leader = rows[0];

  return (
    <div className="space-y-4">
      {/* Status strip */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs",
          isFinished ? "bg-muted/40" : "bg-emerald-500/10 border-emerald-500/30",
        )}
      >
        <span className="relative flex h-2 w-2">
          <motion.span
            animate={!isFinished ? { scale: [1, 2, 1], opacity: [0.6, 0, 0.6] } : {}}
            transition={{ duration: 2, repeat: Infinity }}
            className={cn(
              "absolute inset-0 rounded-full",
              isFinished ? "bg-muted-foreground/40" : "bg-emerald-400",
            )}
          />
          <span className={cn(
            "relative h-2 w-2 rounded-full",
            isFinished ? "bg-muted-foreground" : "bg-emerald-400",
          )} />
        </span>
        <Activity className="h-3.5 w-3.5" />
        <span className="font-medium">{isFinished ? "FINAL" : "LIVE"}</span>
        <span className="text-muted-foreground">
          GW {data.gw} · {data.leagueName} ·{" "}
          {isFinished
            ? data.bonusConfirmed
              ? "all matches done, bonus confirmed"
              : "all matches done, bonus pending"
            : "auto-refreshes every 60s"}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {rows.length} managers
        </span>
      </motion.div>

      {/* Headline summary */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <SummaryStat
          label={sortMode === "season" ? "Your league rank" : "Your live rank"}
          value={`${userPositionInRows + 1}`}
          accent={userPositionInRows === 0 ? "emerald" : userPositionInRows <= 2 ? "amber" : "default"}
          delay={0}
        />
        <SummaryStat
          label="Leader has"
          value={`${sortMode === "season" ? leader.total : leader.liveScore}`}
          subtitle={leader.entryId === user.entryId ? "(you)" : leader.managerName}
          delay={0.05}
        />
        <SummaryStat
          label="Pts behind leader"
          value={
            sortMode === "season"
              ? leader.total - user.total
              : leader.liveScore - user.liveScore
          }
          accent={
            leader.entryId === user.entryId
              ? "emerald"
              : (sortMode === "season"
                  ? leader.total - user.total
                  : leader.liveScore - user.liveScore) <= 5
              ? "amber"
              : "rose"
          }
          delay={0.1}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col items-start gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base">
              {sortMode === "season"
                ? "Season leaderboard"
                : isFinished
                ? "Final scoreboard"
                : "Live scoreboard"}
            </CardTitle>
            <CardDescription>
              {sortMode === "season" ? (
                <>Ranked by total points through GW {data.gw}. <Target className="inline h-3 w-3 text-amber-400" /> marks your three nearest rivals.</>
              ) : (
                <>Full mini-league live. <Target className="inline h-3 w-3 text-amber-400" /> marks your three nearest rivals — pip them to climb a spot.</>
              )}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* GW / Season toggle */}
            <div className="inline-flex rounded-md border bg-card p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setSortMode("gw")}
                className={cn(
                  "rounded-sm px-2 py-1 transition-colors",
                  sortMode === "gw" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                GW {data.gw}
              </button>
              <button
                type="button"
                onClick={() => setSortMode("season")}
                className={cn(
                  "rounded-sm px-2 py-1 transition-colors",
                  sortMode === "season" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Season
              </button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed((v) => !v)}
              className="h-7 px-2 text-xs"
            >
              {collapsed ? (
                <>
                  Show all <ChevronDown className="ml-1 h-3 w-3" />
                </>
              ) : (
                <>
                  Collapse <ChevronUp className="ml-1 h-3 w-3" />
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <motion.ul
            className="divide-y overflow-hidden rounded-md border"
            initial={false}
          >
            <AnimatePresence initial={false}>
              {visibleRows.map((m, i) => {
                const isUser = m.entryId === user.entryId;
                const isHeadline = headlineIds.has(m.entryId);
                const pos = rows.findIndex((r) => r.entryId === m.entryId) + 1;
                return (
                  <motion.li
                    key={m.entryId}
                    layout
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{
                      type: "spring",
                      stiffness: 280,
                      damping: 30,
                      delay: Math.min(i * 0.02, 0.3),
                    }}
                    className={cn(
                      "relative flex flex-wrap items-center gap-3 px-3 py-3 text-sm transition-colors",
                      isUser && "bg-primary/10",
                      isHeadline && !isUser && "bg-amber-500/5",
                    )}
                  >
                    {/* Left rank gutter */}
                    <div className="flex w-8 flex-col items-center">
                      <span className="text-xs font-mono font-semibold text-muted-foreground">
                        #{pos}
                      </span>
                      {isHeadline && !isUser && (
                        <Target className="mt-0.5 h-3 w-3 text-amber-400" aria-label="Main rival" />
                      )}
                    </div>

                    {/* Captain photo */}
                    <div className="relative shrink-0">
                      {m.captain.code != null ? (
                        <PlayerPhoto
                          code={m.captain.code}
                          name={m.captain.name ?? "Captain"}
                          size="sm"
                          chanceOfPlaying={
                            m.captain.minutes >= 60 ? 100 : m.captain.minutes > 0 ? 75 : 50
                          }
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
                          —
                        </div>
                      )}
                      {/* Captaincy marker */}
                      <motion.span
                        animate={{
                          rotateY: m.captain.minutes > 0 && !isFinished ? [0, 360] : 0,
                        }}
                        transition={{
                          duration: 4,
                          repeat: m.captain.minutes > 0 && !isFinished ? Infinity : 0,
                          ease: "linear",
                        }}
                        style={{
                          background: m.captain.multiplier === 3
                            ? "linear-gradient(120deg,#a78bfa,#7c3aed)"
                            : "linear-gradient(120deg,#fde68a 0%,#f59e0b 60%,#fbbf24 100%)",
                          boxShadow: "0 0 6px rgba(245,158,11,0.5)",
                        }}
                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-amber-950"
                      >
                        {m.captain.multiplier === 3 ? "TC" : "C"}
                      </motion.span>
                    </div>

                    {/* Manager + captain text */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "truncate font-semibold",
                            isUser && "text-primary",
                          )}
                        >
                          {m.name}
                        </span>
                        {isUser && (
                          <Badge variant="default" className="px-1.5 py-0 text-[10px] leading-none">
                            YOU
                          </Badge>
                        )}
                        {isHeadline && !isUser && (
                          <Badge variant="outline" className="border-amber-500/40 px-1.5 py-0 text-[10px] leading-none text-amber-300">
                            Rival
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        <span>{m.managerName} · rank {m.rank.toLocaleString()}</span>
                        {m.captain.name && (
                          <span className="inline-flex items-center gap-1">
                            <Crown className="h-3 w-3 text-amber-400" />
                            {m.captain.name}
                            {m.captain.teamShort && (
                              <span className="rounded bg-white/5 px-1 text-[9px] font-mono uppercase">
                                {m.captain.teamShort}
                              </span>
                            )}
                            <span className="font-mono">
                              {m.captain.points} pt{m.captain.points === 1 ? "" : "s"}
                              {m.captain.multiplier === 3 ? " (×3)" : ""}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Score */}
                    <div className="text-right">
                      <div
                        className={cn(
                          "text-2xl font-bold tabular-nums leading-none",
                          isUser && "text-primary",
                        )}
                      >
                        <AnimatedNumber
                          value={sortMode === "season" ? m.total : m.liveScore}
                          duration={0.6}
                        />
                      </div>
                      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {sortMode === "season"
                          ? `GW ${m.liveScore}pt · season`
                          : `${m.played}p · ${m.playing}l · ${m.toPlay}t`}
                      </div>
                    </div>

                    {/* Subtle right edge accent for the user */}
                    {isUser && (
                      <motion.span
                        layoutId="user-row-accent"
                        className="absolute inset-y-0 right-0 w-1 bg-primary"
                      />
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </motion.ul>
          {collapsed && rows.length > visibleRows.length && (
            <div className="mt-2 text-center text-[11px] text-muted-foreground">
              {rows.length - visibleRows.length} more managers hidden — tap{" "}
              <span className="font-semibold">Show all</span> above.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface SummaryStatProps {
  label: string;
  value: string | number;
  subtitle?: string;
  accent?: "default" | "emerald" | "amber" | "rose";
  delay?: number;
}

function SummaryStat({ label, value, subtitle, accent = "default", delay = 0 }: SummaryStatProps) {
  const colorClasses: Record<NonNullable<SummaryStatProps["accent"]>, string> = {
    default: "border-border bg-card",
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    rose: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: "spring", stiffness: 280, damping: 26 }}
      className={cn("rounded-lg border px-3 py-2", colorClasses[accent])}
    >
      <div className="text-lg font-bold leading-none tabular-nums">
        {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      {subtitle && (
        <div className="truncate text-[10px] text-muted-foreground">{subtitle}</div>
      )}
    </motion.div>
  );
}
