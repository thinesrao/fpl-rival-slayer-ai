"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Crown, Goal, Hand, Radio, Shield, ShieldAlert, Star } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface MatchPlayerStat {
  playerId: number;
  webName: string;
  teamShort: string;
  count: number;
}

interface MatchCardEntry {
  playerId: number;
  webName: string;
  teamShort: string;
  yellow: boolean;
  red: boolean;
}

interface MatchBreakdown {
  goals: MatchPlayerStat[];
  assists: MatchPlayerStat[];
  bonusPts: MatchPlayerStat[];
  bps: MatchPlayerStat[];
  cards: MatchCardEntry[];
  defContrib: MatchPlayerStat[];
  saves: MatchPlayerStat[];
  penaltiesSaved: MatchPlayerStat[];
  penaltiesMissed: MatchPlayerStat[];
}

type MatchStatus = "live" | "upcoming" | "finished";

interface Match {
  fixtureId: number;
  gw: number;
  status: MatchStatus;
  kickoffIso: string | null;
  teamH: { id: number; short: string; name: string };
  teamA: { id: number; short: string; name: string };
  scoreH: number | null;
  scoreA: number | null;
  breakdown?: MatchBreakdown;
  dgwPlayers: number[];
}

interface MatchesResponse {
  gw: number;
  matches: Match[];
}

interface Props {
  teamId: number;
  leagueId: number;
  refreshSignal?: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(body.message || body.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

function formatKickoff(iso: string | null): string {
  if (!iso) return "TBC";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MatchesPanel({ teamId, leagueId, refreshSignal = 0 }: Props) {
  void teamId;
  void leagueId; // kept for consistent prop shape with other panels
  const bustNextRef = useRef(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const q = useQuery({
    queryKey: ["matches"],
    queryFn: () => {
      const refresh = bustNextRef.current ? "?refresh=1" : "";
      bustNextRef.current = false;
      return fetchJson<MatchesResponse>(`/api/matches${refresh}`);
    },
    // Poll while a live match is present; otherwise back off to 5 min.
    refetchInterval: (query) => {
      const data = (query.state.data ?? null) as MatchesResponse | null;
      const hasLive = data?.matches.some((m) => m.status === "live") ?? false;
      return hasLive ? 60_000 : 5 * 60_000;
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

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load matches</AlertTitle>
        <AlertDescription>{(q.error as Error).message}</AlertDescription>
      </Alert>
    );
  }
  const data = q.data!;
  const live = data.matches.filter((m) => m.status === "live");
  const upcoming = data.matches.filter((m) => m.status === "upcoming");
  const finished = data.matches.filter((m) => m.status === "finished");

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="h-4 w-4 text-primary" />
          GW {data.gw} matches
          {live.length > 0 && (
            <Badge variant="success" className="ml-1 px-1.5 py-0 text-[10px]">
              {live.length} LIVE
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Tap a match for the per-game breakdown — goals, assists, bonus, BPS, cards, def. contributions, saves, penalties.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {live.length > 0 && (
          <Section label="Live" tone="live">
            {live.map((m) => (
              <MatchRow key={m.fixtureId} match={m} isOpen={expanded.has(m.fixtureId)} onToggle={() => toggle(m.fixtureId)} />
            ))}
          </Section>
        )}
        {upcoming.length > 0 && (
          <Section label="Upcoming" tone="upcoming">
            {upcoming.map((m) => (
              <MatchRow key={m.fixtureId} match={m} isOpen={expanded.has(m.fixtureId)} onToggle={() => toggle(m.fixtureId)} />
            ))}
          </Section>
        )}
        {finished.length > 0 && (
          <Section label="Finished" tone="finished">
            {finished.map((m) => (
              <MatchRow key={m.fixtureId} match={m} isOpen={expanded.has(m.fixtureId)} onToggle={() => toggle(m.fixtureId)} />
            ))}
          </Section>
        )}
        {data.matches.length === 0 && (
          <p className="text-sm text-muted-foreground">No fixtures scheduled for this gameweek.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Section({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "live" | "upcoming" | "finished";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={cn(
          "mb-1.5 inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
          tone === "live" && "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
          tone === "upcoming" && "bg-muted text-muted-foreground",
          tone === "finished" && "bg-muted/60 text-muted-foreground",
        )}
      >
        {tone === "live" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}
        {label}
      </div>
      <div className="divide-y rounded-md border bg-card">{children}</div>
    </div>
  );
}

function MatchRow({ match, isOpen, onToggle }: { match: Match; isOpen: boolean; onToggle: () => void }) {
  const showScore = match.status !== "upcoming" && match.scoreH !== null && match.scoreA !== null;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
      >
        <div className="flex flex-1 items-center justify-center gap-3 text-sm">
          <span className="flex-1 truncate text-right font-medium">{match.teamH.name}</span>
          <span
            className={cn(
              "min-w-[3rem] rounded px-2 py-0.5 text-center font-mono text-sm font-semibold",
              showScore ? "bg-muted" : "text-muted-foreground",
            )}
          >
            {showScore ? `${match.scoreH} - ${match.scoreA}` : "? - ?"}
          </span>
          <span className="flex-1 truncate text-left font-medium">{match.teamA.name}</span>
        </div>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {formatKickoff(match.kickoffIso)}
        </span>
        {match.breakdown ? (
          isOpen ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
      </button>
      <div className="px-3 pb-1 text-[10px] text-muted-foreground sm:hidden">
        {formatKickoff(match.kickoffIso)}
      </div>
      {isOpen && match.breakdown && (
        <Breakdown breakdown={match.breakdown} dgwPlayers={match.dgwPlayers} />
      )}
    </div>
  );
}

function Breakdown({ breakdown, dgwPlayers }: { breakdown: MatchBreakdown; dgwPlayers: number[] }) {
  const dgwSet = new Set(dgwPlayers);
  return (
    <div className="grid grid-cols-1 gap-3 border-t bg-muted/20 p-3 sm:grid-cols-2">
      <StatList
        icon={<Goal className="h-3.5 w-3.5 text-emerald-500" />}
        label="Goals"
        items={breakdown.goals}
        dgw={dgwSet}
      />
      <StatList
        icon={<Star className="h-3.5 w-3.5 text-amber-400" />}
        label="Assists"
        items={breakdown.assists}
        dgw={dgwSet}
      />
      <StatList
        icon={<Crown className="h-3.5 w-3.5 text-amber-500" />}
        label="Bonus points"
        items={breakdown.bonusPts}
        dgw={dgwSet}
      />
      <CardsList items={breakdown.cards} dgw={dgwSet} />
      <StatList
        icon={<Star className="h-3.5 w-3.5 text-primary" />}
        label="BPS"
        items={breakdown.bps}
        dgw={dgwSet}
      />
      <StatList
        icon={<Shield className="h-3.5 w-3.5 text-sky-500" />}
        label="Def. Contributions"
        items={breakdown.defContrib}
        dgw={dgwSet}
      />
      <StatList
        icon={<Hand className="h-3.5 w-3.5 text-cyan-500" />}
        label="Saves"
        items={breakdown.saves}
        dgw={dgwSet}
      />
      <PenaltiesList saved={breakdown.penaltiesSaved} missed={breakdown.penaltiesMissed} dgw={dgwSet} />
    </div>
  );
}

function StatList({
  icon,
  label,
  items,
  dgw,
}: {
  icon: React.ReactNode;
  label: string;
  items: MatchPlayerStat[];
  dgw: Set<number>;
}) {
  return (
    <div className="rounded-md border bg-card p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">—</p>
      ) : (
        <ul className="space-y-0.5 text-xs">
          {items.map((i) => (
            <li key={i.playerId} className="flex items-baseline justify-between gap-2">
              <span className="truncate">
                {i.webName} <span className="text-muted-foreground">({i.teamShort})</span>
                {dgw.has(i.playerId) && (
                  <Badge variant="outline" className="ml-1 px-1 py-0 text-[9px]">DGW</Badge>
                )}
              </span>
              <span className="font-mono text-muted-foreground">({i.count})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CardsList({ items, dgw }: { items: MatchCardEntry[]; dgw: Set<number> }) {
  return (
    <div className="rounded-md border bg-card p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
        Cards
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">—</p>
      ) : (
        <ul className="space-y-0.5 text-xs">
          {items.map((c) => (
            <li key={c.playerId} className="flex items-center gap-1.5">
              {c.red ? (
                <span className="inline-block h-3 w-2 rounded-sm bg-rose-500" aria-label="red card" />
              ) : (
                <span className="inline-block h-3 w-2 rounded-sm bg-amber-400" aria-label="yellow card" />
              )}
              <span className="truncate">
                {c.webName} <span className="text-muted-foreground">({c.teamShort})</span>
                {dgw.has(c.playerId) && (
                  <Badge variant="outline" className="ml-1 px-1 py-0 text-[9px]">DGW</Badge>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PenaltiesList({
  saved,
  missed,
  dgw,
}: {
  saved: MatchPlayerStat[];
  missed: MatchPlayerStat[];
  dgw: Set<number>;
}) {
  const isEmpty = saved.length === 0 && missed.length === 0;
  return (
    <div className="rounded-md border bg-card p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Goal className="h-3.5 w-3.5 text-rose-500" />
        Penalties
      </div>
      {isEmpty ? (
        <p className="text-xs text-muted-foreground/60">—</p>
      ) : (
        <ul className="space-y-0.5 text-xs">
          {saved.map((s) => (
            <li key={`s-${s.playerId}`} className="flex items-baseline justify-between gap-2">
              <span className="truncate">
                {s.webName} <span className="text-muted-foreground">({s.teamShort})</span>
                {dgw.has(s.playerId) && (
                  <Badge variant="outline" className="ml-1 px-1 py-0 text-[9px]">DGW</Badge>
                )}
              </span>
              <Badge variant="success" className="px-1 py-0 text-[9px]">saved</Badge>
            </li>
          ))}
          {missed.map((m) => (
            <li key={`m-${m.playerId}`} className="flex items-baseline justify-between gap-2">
              <span className="truncate">
                {m.webName} <span className="text-muted-foreground">({m.teamShort})</span>
                {dgw.has(m.playerId) && (
                  <Badge variant="outline" className="ml-1 px-1 py-0 text-[9px]">DGW</Badge>
                )}
              </span>
              <Badge variant="destructive" className="px-1 py-0 text-[9px]">missed</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
