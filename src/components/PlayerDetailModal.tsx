"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FutCard } from "@/components/fut/FutCard";
import { playerTier } from "@/lib/fut/tier";

function seasonOvr(seasonTotal: number): number {
  return Math.max(50, Math.min(99, 50 + Math.round(seasonTotal / 3)));
}

interface PlayerDetail {
  player: {
    id: number;
    webName: string;
    fullName: string;
    teamShort: string;
    teamName: string;
    teamCode: number;
    position: "GKP" | "DEF" | "MID" | "FWD";
    elementType: 1 | 2 | 3 | 4;
  };
  gw: number;
  gwStats: {
    fixtureLabel: string | null;
    minutes: number;
    goals: number;
    assists: number;
    cleanSheets: number;
    defContributions: number;
    bonus: number;
    bps: number;
    totalPoints: number;
  };
  season: {
    startsLeaguePct: number;
    startsEffectivePct: number;
    ownedLeaguePct: number | null;
    ownedLeagueDenominator: number;
    ownedOverallPct: number;
    pricePoundsMillions: number;
    totalPoints: number;
  };
  history: Array<{ gw: number; opp: string; minutes: number; totalPoints: number }>;
  upcoming: Array<{ gw: number; opp: string; difficulty: number }>;
  ownersInLeague: Array<{ entryId: number; entryName: string; rank: number; isCaptain: boolean }>;
}

interface CaptainSwapPreview {
  currentCaptainName: string;
  currentCaptainPoints: number;
  candidatePoints: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  playerId: number | null;
  teamId: number;
  leagueId: number;
  captainSwap?: CaptainSwapPreview | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(body.message || body.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

function fdrTone(fdr: number): string {
  if (fdr <= 2) return "bg-emerald-500/80 text-emerald-50";
  if (fdr === 3) return "bg-slate-500/70 text-slate-50";
  if (fdr === 4) return "bg-rose-500/80 text-rose-50";
  return "bg-rose-700/90 text-rose-50";
}

type Tab = "summary" | "previous" | "upcoming";

export function PlayerDetailModal({ open, onClose, playerId, teamId, leagueId, captainSwap }: Props) {
  const [tab, setTab] = useState<Tab>("summary");

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    setTab("summary");
  }, [playerId]);

  const q = useQuery({
    queryKey: ["player-detail", playerId, teamId, leagueId],
    queryFn: () =>
      fetchJson<PlayerDetail>(
        `/api/player-detail?playerId=${playerId}&teamId=${teamId}&leagueId=${leagueId}`,
      ),
    enabled: open && playerId !== null && playerId > 0,
    staleTime: 60_000,
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border bg-card shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Header data={q.data ?? null} loading={q.isLoading} onClose={onClose} />

        <div className="flex-1 overflow-y-auto">
          {q.error ? (
            <div className="p-4">
              <Alert variant="destructive">
                <AlertTitle>Couldn&apos;t load player</AlertTitle>
                <AlertDescription>{(q.error as Error).message}</AlertDescription>
              </Alert>
            </div>
          ) : q.isLoading || !q.data ? (
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
              <Skeleton className="h-44 w-full" />
            </div>
          ) : (
            <Body data={q.data} tab={tab} setTab={setTab} captainSwap={captainSwap} />
          )}
        </div>

        {/* Footer */}
        <div className="border-t bg-muted/40 p-3">
          <Button className="h-11 w-full text-base font-semibold" onClick={onClose}>
            Ok
          </Button>
        </div>
      </div>
    </div>
  );
}

function Header({
  data,
  loading,
  onClose,
}: {
  data: PlayerDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  const ovr = data ? seasonOvr(data.season.totalPoints) : 50;
  const tier = playerTier(ovr);
  return (
    <div className="relative border-b bg-zinc-950 px-4 py-4">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Close"
        onClick={onClose}
        className="absolute right-3 top-3 z-10 h-8 w-8 rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X className="h-4 w-4" />
      </Button>
      <div className="flex items-center justify-center">
        {loading || !data ? (
          <Skeleton className="aspect-[5/7] w-44" />
        ) : (
          <FutCard
            tier={tier}
            ovr={ovr}
            position={data.player.position}
            name={data.player.webName}
            sub={`${data.player.teamShort} · ${positionLabel(data.player.position)}`}
            size="lg"
            stats={[
              { label: "PTS", value: data.season.totalPoints },
              { label: "£M", value: data.season.pricePoundsMillions.toFixed(1) },
              { label: "OWN", value: `${data.season.ownedOverallPct.toFixed(0)}%` },
              { label: "STR", value: `${data.season.startsLeaguePct.toFixed(0)}%` },
            ]}
          />
        )}
      </div>
    </div>
  );
}

function positionLabel(pos: PlayerDetail["player"]["position"]): string {
  return pos === "GKP" ? "Goalkeeper" : pos === "DEF" ? "Defender" : pos === "MID" ? "Midfielder" : "Forward";
}

function Body({ data, tab, setTab, captainSwap }: { data: PlayerDetail; tab: Tab; setTab: (t: Tab) => void; captainSwap?: CaptainSwapPreview | null }) {
  return (
    <div className="space-y-4 p-4">
      {/* Two stat cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <GwStatsCard data={data} />
        <SeasonStatsCard data={data} />
      </div>

      {/* Captain-swap preview (only for non-captain starters who passed it in) */}
      {captainSwap && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            <Crown className="h-3.5 w-3.5" />
            If you&apos;d captained {data.player.webName}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Cell label={`Current C: ${captainSwap.currentCaptainName}`} value={`${captainSwap.currentCaptainPoints} pts ×2`} />
            <Cell label={`If C: ${data.player.webName}`} value={`${captainSwap.candidatePoints} pts ×2`} />
            <Cell
              label="Delta"
              value={`${captainSwap.candidatePoints * 2 - captainSwap.currentCaptainPoints * 2 >= 0 ? "+" : ""}${captainSwap.candidatePoints * 2 - captainSwap.currentCaptainPoints * 2}`}
              valueClass={
                captainSwap.candidatePoints * 2 - captainSwap.currentCaptainPoints * 2 > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : captainSwap.candidatePoints * 2 - captainSwap.currentCaptainPoints * 2 < 0
                    ? "text-rose-600 dark:text-rose-400"
                    : ""
              }
            />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div>
        <div className="mb-2 flex gap-1 border-b">
          <TabBtn active={tab === "summary"} onClick={() => setTab("summary")} label="Summary" />
          <TabBtn active={tab === "previous"} onClick={() => setTab("previous")} label={`Previous (${data.history.length})`} />
          <TabBtn active={tab === "upcoming"} onClick={() => setTab("upcoming")} label={`Upcoming (${data.upcoming.length})`} />
        </div>
        {tab === "summary" && <SummaryTab data={data} />}
        {tab === "previous" && <PreviousTab data={data} />}
        {tab === "upcoming" && <UpcomingTab data={data} />}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-b-2 px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function GwStatsCard({ data }: { data: PlayerDetail }) {
  const rows: Array<[string, number | string]> = [
    ["Goals", data.gwStats.goals],
    ["Assists", data.gwStats.assists],
    ["Clean sheets", data.gwStats.cleanSheets],
    ["Def. contributions", data.gwStats.defContributions],
    ["Minutes", data.gwStats.minutes],
    [`Bonus (${data.gwStats.bps} bps)`, data.gwStats.bonus],
  ];
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-1 border-b pb-1 text-sm font-semibold">
        {data.gwStats.fixtureLabel ? `${data.gwStats.fixtureLabel}` : `GW ${data.gw}`}
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-muted/40 last:border-0">
              <td className="py-1 text-muted-foreground">{label}:</td>
              <td className="py-1 text-right font-mono">{value}</td>
            </tr>
          ))}
          <tr>
            <td className="pt-1.5 font-semibold">Total Points:</td>
            <td className="pt-1.5 text-right font-mono text-base font-semibold">{data.gwStats.totalPoints}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SeasonStatsCard({ data }: { data: PlayerDetail }) {
  const rows: Array<[string, string]> = [
    ["Starts league", `${data.season.startsLeaguePct.toFixed(1)}%`],
    ["Starts effective", `${data.season.startsEffectivePct.toFixed(1)}%`],
    [
      "Owned league",
      data.season.ownedLeaguePct === null
        ? "n/a"
        : `${data.season.ownedLeaguePct.toFixed(1)}% (top ${data.season.ownedLeagueDenominator})`,
    ],
    ["Owned overall", `${data.season.ownedOverallPct.toFixed(1)}%`],
    ["Price", `£${data.season.pricePoundsMillions.toFixed(1)}m`],
    ["Total points", String(data.season.totalPoints)],
  ];
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-muted/40 last:border-0">
              <td className="py-1 text-muted-foreground">{label}:</td>
              <td className="py-1 text-right font-mono">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryTab({ data }: { data: PlayerDetail }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded-md border bg-muted/20 p-3">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Started by team
        </div>
        {data.ownersInLeague.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No top-{data.season.ownedLeagueDenominator} manager in your league owns this player.
          </p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {data.ownersInLeague.map((o) => (
              <li key={o.entryId} className="flex items-center gap-2">
                <span className="w-6 text-right text-xs text-muted-foreground">{o.rank}</span>
                <span className="flex-1 truncate">{o.entryName}</span>
                {o.isCaptain && (
                  <Badge variant="default" className="px-1.5 py-0 text-[10px]">
                    <Crown className="mr-0.5 h-2.5 w-2.5" />C
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-md border bg-muted/20 p-3">
        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Recent form</span>
          <span className="text-[10px] font-mono text-muted-foreground">total</span>
        </div>
        {data.history.length === 0 ? (
          <p className="text-xs text-muted-foreground">No recent gameweek history.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase text-muted-foreground">
                <th className="text-left font-medium">GW</th>
                <th className="text-left font-medium">Opp</th>
                <th className="text-right font-medium">Min</th>
                <th className="text-right font-medium">Pts</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((h) => (
                <tr key={h.gw} className="border-t border-muted/40">
                  <td className="py-0.5">{h.gw}</td>
                  <td className="py-0.5">{h.opp}</td>
                  <td className="py-0.5 text-right font-mono">{h.minutes}</td>
                  <td className="py-0.5 text-right font-mono font-semibold">{h.totalPoints}</td>
                </tr>
              ))}
              <tr className="border-t font-semibold">
                <td className="py-0.5" colSpan={2}>Total</td>
                <td className="py-0.5 text-right font-mono">{data.history.reduce((a, b) => a + b.minutes, 0)}</td>
                <td className="py-0.5 text-right font-mono">{data.history.reduce((a, b) => a + b.totalPoints, 0)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PreviousTab({ data }: { data: PlayerDetail }) {
  if (data.history.length === 0) {
    return <p className="text-sm text-muted-foreground">No previous fixtures with stats.</p>;
  }
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase text-muted-foreground">
            <th className="text-left font-medium py-1">GW</th>
            <th className="text-left font-medium py-1">Opp</th>
            <th className="text-right font-medium py-1">Min</th>
            <th className="text-right font-medium py-1">Pts</th>
          </tr>
        </thead>
        <tbody>
          {data.history.map((h) => (
            <tr key={h.gw} className="border-t border-muted/40">
              <td className="py-1">{h.gw}</td>
              <td className="py-1">{h.opp}</td>
              <td className="py-1 text-right font-mono">{h.minutes}</td>
              <td className="py-1 text-right font-mono font-semibold">{h.totalPoints}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UpcomingTab({ data }: { data: PlayerDetail }) {
  if (data.upcoming.length === 0) {
    return <p className="text-sm text-muted-foreground">No upcoming fixtures scheduled.</p>;
  }
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase text-muted-foreground">
            <th className="text-left font-medium py-1">GW</th>
            <th className="text-left font-medium py-1">Opp</th>
            <th className="text-right font-medium py-1">Diff</th>
          </tr>
        </thead>
        <tbody>
          {data.upcoming.map((f) => (
            <tr key={f.gw} className="border-t border-muted/40">
              <td className="py-1">{f.gw}</td>
              <td className="py-1">{f.opp}</td>
              <td className="py-1 text-right">
                <span className={cn("inline-block min-w-[1.75rem] rounded px-1.5 py-0.5 text-center text-xs font-semibold", fdrTone(f.difficulty))}>
                  {f.difficulty}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded bg-card p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-sm font-semibold", valueClass)}>{value}</div>
    </div>
  );
}
