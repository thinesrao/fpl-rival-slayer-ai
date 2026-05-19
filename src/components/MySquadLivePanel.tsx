"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip } from "recharts";
import { ArrowDown, ArrowUp, ArrowUpFromLine, Radio, RefreshCcw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { motion } from "framer-motion";
import { PlayerDetailModal } from "@/components/PlayerDetailModal";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { GoalCelebration } from "@/components/GoalCelebration";
import { StreakBadge } from "@/components/StreakBadge";
import { PitchTilt } from "@/components/PitchTilt";
import { PointBubble } from "@/components/PointBubble";
import { useCaptainConfetti } from "@/lib/use-captain-confetti";
import { cn } from "@/lib/utils";

interface LivePlayer {
  playerId: number;
  webName: string;
  teamShort: string;
  teamCode: number;
  elementType: 1 | 2 | 3 | 4;
  position: "GKP" | "DEF" | "MID" | "FWD";
  isStarter: boolean;
  isCaptain: boolean;
  isVice: boolean;
  multiplier: number;
  benchSlot: number | null;
  livePoints: number;
  pointsWithMultiplier: number;
  minutes: number;
  bonus: number;
  provisionalBonus: number;
  bps: number;
  fixtureStatus: "upcoming" | "live" | "finished";
  fixtureOpponent: string;
  fixtureKickoffIso: string | null;
  fixtureFdr: number;
  autosubbedIn: boolean;
  autosubbedOut: boolean;
}

interface LiveMetrics {
  gwGrossPoints: number;
  transferCost: number;
  gwNetPoints: number;
  transfersMade: number;
  freeTransfers: number;
  liveRank: number | null;
  gwRank: number | null;
  rankTrajectory: Array<{ gw: number; overallRank: number }>;
}

interface MySquadLive {
  gw: number;
  metrics: LiveMetrics;
  starters: LivePlayer[];
  bench: LivePlayer[];
}

interface Props {
  teamId: number;
  leagueId: number;
  refreshSignal?: number;
}

const KIT_BASE = "https://fantasy.premierleague.com/dist/img/shirts/standard";
function kitUrl(teamCode: number, isGk: boolean): string {
  return `${KIT_BASE}/shirt_${teamCode}${isGk ? "_1" : ""}-66.png`;
}

function formatKickoff(iso: string | null): string {
  if (!iso) return "TBC";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function fdrTone(fdr: number): string {
  if (fdr <= 2) return "bg-emerald-600/80 text-white";
  if (fdr === 3) return "bg-slate-600/70 text-white";
  if (fdr === 4) return "bg-rose-600/80 text-white";
  return "bg-rose-800/80 text-white";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(body.message || body.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function MySquadLivePanel({ teamId, leagueId, refreshSignal = 0 }: Props) {
  const bustNextRef = useRef(false);
  const [detailPlayerId, setDetailPlayerId] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ["my-squad-live", teamId],
    queryFn: () => {
      const refresh = bustNextRef.current ? "&refresh=1" : "";
      bustNextRef.current = false;
      return fetchJson<MySquadLive>(`/api/my-squad-live?teamId=${teamId}${refresh}`);
    },
    refetchInterval: (query) => {
      const data = (query.state.data ?? null) as MySquadLive | null;
      const anyLive = data?.starters.some((p) => p.fixtureStatus === "live") ?? false;
      return anyLive ? 60_000 : 5 * 60_000;
    },
    retry: 0,
  });

  useEffect(() => {
    if (refreshSignal > 0) {
      bustNextRef.current = true;
      q.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const captainFromData = q.data?.starters.find((p) => p.isCaptain) ?? null;
  useCaptainConfetti({
    captainPoints: captainFromData?.pointsWithMultiplier,
    enabled: captainFromData?.fixtureStatus === "live" || captainFromData?.fixtureStatus === "finished",
  });

  if (q.isLoading) return <Skeleton className="h-[40rem] w-full" />;
  if (q.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load live squad</AlertTitle>
        <AlertDescription>{(q.error as Error).message}</AlertDescription>
      </Alert>
    );
  }
  const data = q.data!;
  const gk = data.starters.filter((p) => p.elementType === 1);
  const def = data.starters.filter((p) => p.elementType === 2);
  const mid = data.starters.filter((p) => p.elementType === 3);
  const fwd = data.starters.filter((p) => p.elementType === 4);
  const captain = captainFromData;

  const onTileClick = (p: LivePlayer) => {
    if (p.playerId > 0) setDetailPlayerId(p.playerId);
  };

  const detailPlayer = detailPlayerId
    ? [...data.starters, ...data.bench].find((p) => p.playerId === detailPlayerId) ?? null
    : null;
  const captainSwapPreview =
    detailPlayer && detailPlayer.isStarter && !detailPlayer.isCaptain && captain
      ? {
          currentCaptainName: captain.webName,
          currentCaptainPoints: captain.livePoints,
          candidatePoints: detailPlayer.livePoints,
        }
      : null;

  return (
    <Card>
      <GoalCelebration
        triggerValue={captain?.pointsWithMultiplier}
        subtitle={captain ? `${captain.webName} · ×${captain.multiplier}` : undefined}
      />
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Radio className="h-4 w-4 text-primary" />
          Live pitch · GW {data.gw}
          <RefreshCcw className={cn("ml-1 h-3 w-3 text-muted-foreground", q.isFetching && "animate-spin")} />
          <span className="ml-auto"><StreakBadge teamId={teamId} /></span>
        </CardTitle>
        <CardDescription>
          Your squad with live points, captain ×{captain?.multiplier ?? 2}, fixture status, provisional bonus, and autosub preview. Tap any non-captain starter for a captain-swap what-if.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <MetricsHeader metrics={data.metrics} />

        <PitchTilt>
          <div
            className="relative overflow-hidden rounded-2xl border"
            style={{ background: "linear-gradient(to bottom, hsl(120 55% 32%), hsl(120 50% 27%))" }}
          >
            <PitchLines />
            <div className="relative flex flex-col gap-3 px-1 py-4 sm:gap-4 sm:px-2 sm:py-5">
              <Row players={gk} onClick={onTileClick} />
              <Row players={def} onClick={onTileClick} />
              <Row players={mid} onClick={onTileClick} />
              <Row players={fwd} onClick={onTileClick} />
            </div>
          </div>
        </PitchTilt>

        <BenchStrip bench={data.bench} onClick={onTileClick} />
      </CardContent>
      <PlayerDetailModal
        open={detailPlayerId !== null}
        onClose={() => setDetailPlayerId(null)}
        playerId={detailPlayerId}
        teamId={teamId}
        leagueId={leagueId}
        captainSwap={captainSwapPreview}
      />
    </Card>
  );
}

function MetricsHeader({ metrics }: { metrics: LiveMetrics }) {
  const traj = metrics.rankTrajectory;
  const lastTwo = traj.slice(-2);
  const rankDelta =
    lastTwo.length === 2 ? lastTwo[1].overallRank - lastTwo[0].overallRank : 0;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat
        label="GW Net"
        value={<AnimatedNumber value={metrics.gwNetPoints} duration={0.6} />}
        sub={metrics.transferCost > 0 ? `gross ${metrics.gwGrossPoints} (−${metrics.transferCost})` : undefined}
      />
      <Stat
        label="Transfers"
        value={`${metrics.transfersMade}${metrics.transferCost > 0 ? ` (−${metrics.transferCost})` : ""}`}
        sub={`${metrics.freeTransfers} free`}
      />
      <Stat
        label="Live Rank"
        value={metrics.liveRank ? metrics.liveRank.toLocaleString() : "—"}
        sub={
          rankDelta !== 0 ? (
            <span className={cn("inline-flex items-center gap-0.5", rankDelta < 0 ? "text-emerald-500" : "text-rose-500")}>
              {rankDelta < 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              {Math.abs(rankDelta).toLocaleString()}
            </span>
          ) : undefined
        }
      />
      <Stat
        label="GW Rank"
        value={metrics.gwRank ? metrics.gwRank.toLocaleString() : "—"}
        sub={traj.length > 1 ? <Sparkline points={traj.map((t) => t.overallRank)} /> : undefined}
      />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-card p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-base font-semibold">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const data = points.map((rank, i) => ({ idx: i, rank }));
  return (
    <div className="h-5 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          {/* Lower rank = better, so we invert the visual by negating. */}
          <Line type="monotone" dataKey="rank" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <ChartTooltip
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              fontSize: 11,
              padding: "2px 6px",
            }}
            formatter={(v: number) => v.toLocaleString()}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PitchLines() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-white/15" />
      <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
      <div className="absolute left-1/2 top-0 h-12 w-32 -translate-x-1/2 rounded-b-2xl border border-t-0 border-white/15" />
      <div className="absolute bottom-0 left-1/2 h-12 w-32 -translate-x-1/2 rounded-t-2xl border border-b-0 border-white/15" />
    </div>
  );
}

function Row({ players, onClick }: { players: LivePlayer[]; onClick: (p: LivePlayer) => void }) {
  if (players.length === 0) return null;
  return (
    <div className="flex w-full justify-around gap-0.5 sm:gap-1.5">
      {players.map((p) => (
        <Tile key={p.playerId} player={p} onClick={() => onClick(p)} />
      ))}
    </div>
  );
}

function Tile({ player, onClick, small = false }: { player: LivePlayer; onClick: () => void; small?: boolean }) {
  const isGk = player.elementType === 1;
  const [imgFailed, setImgFailed] = useState(false);
  const showLive = player.fixtureStatus === "live";
  const showFinished = player.fixtureStatus === "finished";
  const showUpcoming = player.fixtureStatus === "upcoming";
  // Bench players (not autosubbed in) have multiplier 0, so
  // pointsWithMultiplier is always 0. Show their raw livePoints instead
  // so users can see what the bench scored — toned down to make it
  // visually obvious those points aren't actually counting.
  const isInactiveBench = !player.isStarter && !player.autosubbedIn;
  const totalPoints = isInactiveBench ? player.livePoints : player.pointsWithMultiplier;
  const showProvisional = player.provisionalBonus > 0 && player.bonus === 0;
  const showFinalBonus = player.bonus > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      title={player.webName}
      className={cn(
        "relative flex min-w-0 flex-1 basis-0 flex-col items-center gap-0.5 transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white",
        small ? "max-w-[78px]" : "max-w-[88px]",
        player.autosubbedOut && "opacity-40",
        player.autosubbedIn && "ring-2 ring-emerald-400",
      )}
    >
      <div className="relative h-9 w-9 sm:h-11 sm:w-11">
        <PointBubble livePoints={player.livePoints} />
        {imgFailed || player.teamCode === 0 ? (
          <div className="flex h-full w-full items-center justify-center rounded-md bg-white/85 text-[10px] font-bold text-slate-900" aria-hidden>
            {player.teamShort}
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={kitUrl(player.teamCode, isGk)}
            alt={`${player.teamShort} kit`}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className={cn("h-full w-full object-contain drop-shadow", player.autosubbedOut && "grayscale")}
          />
        )}
        {player.isCaptain && (
          <motion.span
            animate={{ rotateY: 360 }}
            transition={{ duration: 3.5, ease: "linear", repeat: Infinity }}
            style={{
              transformStyle: "preserve-3d",
              background:
                "linear-gradient(120deg,#fde68a 0%,#f59e0b 35%,#fbbf24 60%,#f59e0b 100%)",
              boxShadow: "0 0 10px #f59e0b80, inset 0 0 4px #fff8",
            }}
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-amber-950"
          >
            C
          </motion.span>
        )}
        {!player.isCaptain && player.isVice && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-900 shadow">V</span>
        )}
        {player.autosubbedIn && (
          <span className="absolute -left-1 -top-1 flex items-center gap-0.5 rounded bg-emerald-500 px-1 py-0.5 text-[8px] font-bold text-white shadow">
            <ArrowUpFromLine className="h-2.5 w-2.5" />
            IN
          </span>
        )}
      </div>
      <div className="w-full overflow-hidden rounded-sm bg-white/95 px-1 py-0.5 text-center leading-tight shadow">
        <div className={cn("truncate font-semibold text-slate-900", small ? "text-[10px]" : "text-[11px]")}>
          {player.webName}
          {player.autosubbedOut && <span className="ml-1 text-rose-600">✗</span>}
        </div>
        <div
          className={cn(
            "font-mono font-semibold",
            isInactiveBench ? "text-slate-500" : "text-emerald-700",
            small ? "text-[11px]" : "text-[12px]",
          )}
          title={isInactiveBench ? "Bench points (not counting)" : undefined}
        >
          <AnimatedNumber value={totalPoints} duration={0.5} suffix=" pts" />
          {player.multiplier === 2 && <span className="ml-1 text-[9px] font-normal text-slate-500">×2</span>}
          {player.multiplier === 3 && <span className="ml-1 text-[9px] font-normal text-amber-600">×3</span>}
        </div>
        {(showFinalBonus || showProvisional) && (
          <div className={cn("inline-block rounded px-1 text-[9px] font-semibold", showFinalBonus ? "bg-amber-200 text-amber-900" : "bg-amber-100 text-amber-700")}>
            {showProvisional ? "~" : ""}+{player.bonus > 0 ? player.bonus : player.provisionalBonus} bps
          </div>
        )}
      </div>
      <div
        className={cn(
          "w-full truncate rounded px-1 py-0.5 text-center text-[9px] font-medium",
          showLive && "bg-emerald-500/90 text-white",
          showFinished && "bg-slate-600/70 text-white",
          showUpcoming && fdrTone(player.fixtureFdr),
        )}
      >
        {showLive && (
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            LIVE · {player.fixtureOpponent}
          </span>
        )}
        {showFinished && <>FT · {player.fixtureOpponent}</>}
        {showUpcoming && (
          <>
            {formatKickoff(player.fixtureKickoffIso)} · {player.fixtureOpponent}
          </>
        )}
      </div>
    </button>
  );
}

function BenchStrip({ bench, onClick }: { bench: LivePlayer[]; onClick: (p: LivePlayer) => void }) {
  if (!bench || bench.length === 0) return null;
  // Sum of points scored by bench players who didn't autosub in — the
  // "bench fail" total for this GW.
  const inactiveBenchTotal = bench
    .filter((p) => !p.autosubbedIn)
    .reduce((s, p) => s + p.livePoints, 0);
  return (
    <div className="overflow-hidden rounded-2xl border bg-muted/40 px-2 py-3">
      <div className="mb-2 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Bench (autosub order)</span>
        {inactiveBenchTotal > 0 && (
          <span title="Points scored by your bench that didn't count (no autosub).">
            on bench: <span className="font-mono text-slate-500">{inactiveBenchTotal}</span> pts
          </span>
        )}
      </div>
      <div className="flex w-full justify-around gap-0.5 sm:gap-1.5">
        {bench.map((p, i) => (
          <div key={p.playerId} className="flex min-w-0 flex-1 basis-0 max-w-[88px] flex-col items-center gap-1">
            <div className="text-[9px] font-semibold uppercase text-muted-foreground">
              {p.elementType === 1 ? "GKP" : `${i + 1}.${p.position}`}
            </div>
            <Tile player={p} onClick={() => onClick(p)} small />
          </div>
        ))}
      </div>
    </div>
  );
}

