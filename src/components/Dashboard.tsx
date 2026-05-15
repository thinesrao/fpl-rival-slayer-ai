"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SquadCompareTable } from "@/components/SquadCompareTable";
import { DifferentialsCard } from "@/components/DifferentialsCard";
import { ProjectionsChart } from "@/components/ProjectionsChart";
import { OvertakeMeter } from "@/components/OvertakeMeter";
import { RecommendationsPanel } from "@/components/RecommendationsPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { PlanPanel } from "@/components/PlanPanel";
import { WhatIfModal } from "@/components/WhatIfModal";
import { RivalChipsPanel } from "@/components/RivalChipsPanel";
import { LeagueHeatmap } from "@/components/LeagueHeatmap";
import { IntelPanel } from "@/components/IntelPanel";
import { RetrospectivePanel } from "@/components/RetrospectivePanel";
import { LivePanel } from "@/components/LivePanel";
import { NotificationToggle } from "@/components/NotificationToggle";
import type { FplBootstrap, FplFixture, OvertakeOdds, RivalContext, SquadProjection } from "@/lib/types";
import type { AiResult } from "@/lib/ai/gemini";
import type { TransferSuggestion } from "@/lib/optimizer/transfers";
import type { PlayerEo } from "@/lib/intel/effective-ownership";
import type { PriceMoveReport } from "@/lib/intel/price-changes";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AnalysisResponse {
  context: RivalContext;
  targetGw: number;
  deadline: string;
  projections: { gw: number; user: SquadProjection; rivals: SquadProjection[]; overtake: OvertakeOdds[] };
  differentials: {
    userOnly: Array<{ name: string; xPts: number }>;
    rivalOnly: Array<{ name: string; rival: string; xPts: number }>;
  };
  shortlist: TransferSuggestion[];
  freeTransfers: number;
  bank: number;
  ai: AiResult;
  cachedAt?: string;
  cacheStatus?: "hit" | "miss" | "refreshed";
  eo?: Record<number, PlayerEo>;
  priceMoves?: PriceMoveReport;
  userChips?: { used: Array<{ chip: string; gw: number }>; remaining: string[] };
  suggestedSquad?: {
    startingXi: Array<{
      webName: string;
      playerId: number;
      teamShort: string;
      teamCode: number;
      elementType: 1 | 2 | 3 | 4;
      position: "GKP" | "DEF" | "MID" | "FWD";
      cost: number;
      xPoints: number;
      opponent: string | null;
      isCaptain: boolean;
      isVice: boolean;
      isIn: boolean;
    }>;
    bench: Array<{
      webName: string;
      playerId: number;
      teamShort: string;
      teamCode: number;
      elementType: 1 | 2 | 3 | 4;
      position: "GKP" | "DEF" | "MID" | "FWD";
      cost: number;
      xPoints: number;
      opponent: string | null;
      isCaptain: boolean;
      isVice: boolean;
      isIn: boolean;
    }>;
    totalXp: number;
    bank: number;
    freeTransfers: number;
    formation: string;
  };
}

interface HorizonGwResponse {
  gw: number;
  fixtures: FplFixture[];
  user: SquadProjection;
  rivals: SquadProjection[];
  overtake: OvertakeOdds[];
}

interface CumulativeOvertakeResponse {
  rivalEntryId: number;
  rivalName: string;
  pointsBehind: number;
  userExpectedTotal: number;
  rivalExpectedTotal: number;
  expectedDelta: number;
  overtakeProbability: number;
}

interface ProjectionsResponse {
  context: RivalContext;
  targetGw: number;
  projections: { gw: number; user: SquadProjection; rivals: SquadProjection[]; overtake: OvertakeOdds[] };
  horizon?: { horizon: HorizonGwResponse[]; cumulative: CumulativeOvertakeResponse[] };
  teams?: FplBootstrap["teams"];
  eo?: Record<number, PlayerEo>;
  priceMoves?: PriceMoveReport;
}

interface DifferentialsExt {
  userOnly: Array<{ name: string; xPts: number }>;
  rivalOnly: Array<{ name: string; rival: string; xPts: number }>;
}

interface Props {
  teamId: number;
  leagueId: number;
  aiEnabled: boolean;
}

function useDeadlineCountdown(iso: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "Deadline passed";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms / 3600000) % 24);
  const mins = Math.floor((ms / 60000) % 60);
  const secs = Math.floor((ms / 1000) % 60);
  return `${days > 0 ? days + "d " : ""}${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(body.message || body.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function Dashboard({ teamId, leagueId, aiEnabled }: Props) {
  const queryClient = useQueryClient();
  const projectionsForceRef = useRef(false);
  const projectionsQuery = useQuery({
    queryKey: ["projections", teamId, leagueId],
    queryFn: () => {
      const refresh = projectionsForceRef.current ? "&refresh=1" : "";
      return fetchJson<ProjectionsResponse>(
        `/api/projections?teamId=${teamId}&leagueId=${leagueId}${refresh}`,
      );
    },
  });

  const forceRefreshRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const analysisQuery = useQuery({
    queryKey: ["analysis", teamId, leagueId],
    queryFn: () => {
      const refresh = forceRefreshRef.current ? "&refresh=1" : "";
      return fetchJson<AnalysisResponse>(`/api/analysis?teamId=${teamId}&leagueId=${leagueId}${refresh}`);
    },
    enabled: aiEnabled && !!projectionsQuery.data,
    retry: 0,
    staleTime: 5 * 60 * 1000,
  });

  const refetchAnalysis = (force: boolean) => {
    forceRefreshRef.current = force;
    setRefreshing(force);
    analysisQuery.refetch().finally(() => {
      forceRefreshRef.current = false;
      setRefreshing(false);
    });
  };

  const [refreshSignal, setRefreshSignal] = useState(0);
  const [whatIfOutId, setWhatIfOutId] = useState<number | null>(null);

  const refreshAll = async () => {
    setRefreshingAll(true);
    projectionsForceRef.current = true;
    setRefreshSignal((n) => n + 1);
    try {
      await Promise.all([
        projectionsQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["retrospective", teamId, leagueId] }),
      ]);
      refetchAnalysis(false);
    } finally {
      projectionsForceRef.current = false;
      setRefreshingAll(false);
    }
  };

  useEffect(() => {
    if (analysisQuery.error) toast.error((analysisQuery.error as Error).message);
  }, [analysisQuery.error]);

  const deadline = analysisQuery.data?.deadline ?? null;
  const countdown = useDeadlineCountdown(deadline ?? undefined);

  if (projectionsQuery.isLoading) return <LoadingShell />;

  if (projectionsQuery.error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load your team</AlertTitle>
          <AlertDescription>
            {(projectionsQuery.error as Error).message}. Double-check your Team ID and League ID.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const data = projectionsQuery.data!;
  const ctx = data.context;
  const projections = data.projections;
  const ai = analysisQuery.data?.ai;
  const diff: DifferentialsExt =
    analysisQuery.data?.differentials ??
    ({ userOnly: [], rivalOnly: [] } as DifferentialsExt);
  const eo = analysisQuery.data?.eo ?? data.eo;
  const priceMoves = analysisQuery.data?.priceMoves ?? data.priceMoves;

  const closestRival = projections.overtake[0];

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> New search
          </Link>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{ctx.leagueName}</h1>
          <p className="text-sm text-muted-foreground">
            You: <span className="font-medium text-foreground">{ctx.user.entry.name}</span> · rank{" "}
            <span className="font-medium text-foreground">#{ctx.user.entry.rank}</span> ·{" "}
            <span className="font-medium text-foreground">{ctx.user.entry.total}</span> pts
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <NotificationToggle teamId={teamId} />
          <div className="flex items-center gap-3 rounded-lg border bg-card/70 px-4 py-2 text-sm">
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">GW {projections.gw} deadline</div>
              <div className="font-mono text-base">{countdown ?? "—"}</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              aria-label="Refresh all data"
              onClick={refreshAll}
              disabled={refreshingAll}
            >
              <RefreshCcw className={cn("h-4 w-4", refreshingAll && "animate-spin")} />
              <span className="ml-1.5 hidden sm:inline">{refreshingAll ? "Refreshing…" : "Refresh"}</span>
            </Button>
          </div>
        </div>
      </div>

      {closestRival && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Stat label="Closest rival" value={closestRival.rivalName} sub={`${closestRival.pointsBehind} pts ahead`} />
          <Stat
            label="Projected XI"
            value={`${projections.user.startingXIPoints.toFixed(1)} pts`}
            sub={`σ ${projections.user.stdev.toFixed(1)}`}
          />
          <Stat
            label="Overtake odds (closest)"
            value={`${Math.round(closestRival.overtakeProbability * 100)}%`}
            sub={`xP delta ${closestRival.expectedDelta > 0 ? "+" : ""}${closestRival.expectedDelta.toFixed(1)}`}
          />
        </div>
      )}

      <Tabs defaultValue="squads">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="squads">Squads</TabsTrigger>
          <TabsTrigger value="differentials">Differentials</TabsTrigger>
          <TabsTrigger value="projections">Projections</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="ai">AI Coach</TabsTrigger>
          <TabsTrigger value="live">Live</TabsTrigger>
          <TabsTrigger value="retrospective">Retrospective</TabsTrigger>
        </TabsList>

        <TabsContent value="squads" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Tap any of your players to run a what-if swap simulation.
          </p>
          <SquadCompareTable
            user={ctx.user}
            userProjection={projections.user}
            rivals={ctx.rivals}
            rivalProjections={projections.rivals}
            eo={eo}
            onUserPlayerClick={(id) => setWhatIfOutId(id)}
          />
        </TabsContent>

        <TabsContent value="differentials" className="mt-4 space-y-4">
          {analysisQuery.isLoading && aiEnabled ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <DifferentialsCard userOnly={diff.userOnly} rivalOnly={diff.rivalOnly} />
          )}
          <LeagueHeatmap leagueId={leagueId} topN={10} />
          {eo && priceMoves && <IntelPanel eo={eo} priceMoves={priceMoves} />}
        </TabsContent>

        <TabsContent value="projections" className="mt-4 grid gap-4 lg:grid-cols-2">
          <ProjectionsChart
            user={ctx.user}
            userProjection={projections.user}
            rivals={ctx.rivals}
            rivalProjections={projections.rivals}
          />
          <OvertakeMeter odds={projections.overtake} />
        </TabsContent>

        <TabsContent value="plan" className="mt-4 space-y-4">
          {data.horizon && data.teams ? (
            <PlanPanel
              horizon={data.horizon.horizon}
              cumulative={data.horizon.cumulative}
              context={ctx}
              teams={data.teams}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Plan horizon unavailable</CardTitle>
                <CardDescription>Refresh to compute the next 3 gameweeks.</CardDescription>
              </CardHeader>
            </Card>
          )}
          <RivalChipsPanel teamId={teamId} leagueId={leagueId} />
        </TabsContent>

        <TabsContent value="live" className="mt-4">
          <LivePanel teamId={teamId} leagueId={leagueId} refreshSignal={refreshSignal} />
        </TabsContent>

        <TabsContent value="retrospective" className="mt-4">
          <RetrospectivePanel teamId={teamId} leagueId={leagueId} />
        </TabsContent>

        <TabsContent value="ai" className="mt-4">{/* AI Coach tab content below */}
          {!aiEnabled ? (
            <Alert variant="warning">
              <AlertTitle>AI Coach disabled</AlertTitle>
              <AlertDescription>
                Set <code className="rounded bg-muted px-1">GEMINI_API_KEY</code> in your environment to enable
                live news-grounded recommendations.
              </AlertDescription>
            </Alert>
          ) : analysisQuery.isLoading ? (
            <AiLoadingShell />
          ) : analysisQuery.error ? (
            <Alert variant="destructive">
              <AlertTitle>AI request failed</AlertTitle>
              <AlertDescription>{(analysisQuery.error as Error).message}</AlertDescription>
            </Alert>
          ) : ai ? (
            <div className="space-y-6">
              <RecommendationsPanel
                ai={ai}
                freeTransfers={analysisQuery.data?.freeTransfers}
                bank={analysisQuery.data?.bank}
                cachedAt={analysisQuery.data?.cachedAt}
                cacheStatus={analysisQuery.data?.cacheStatus}
                refreshing={refreshing}
                onRefresh={() => refetchAnalysis(true)}
                userChips={analysisQuery.data?.userChips}
                suggestedSquad={analysisQuery.data?.suggestedSquad}
                targetGw={projections.gw}
                onPlayerClick={(playerId) => {
                  if (playerId > 0) setWhatIfOutId(playerId);
                }}
              />
              <ChatPanel teamId={teamId} leagueId={leagueId} />
            </div>
          ) : (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Run AI analysis</CardTitle>
                  <CardDescription>Click refresh to query Gemini with the latest news.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={() => refetchAnalysis(false)}>Run analysis</Button>
                </CardContent>
              </Card>
              <ChatPanel teamId={teamId} leagueId={leagueId} />
            </div>
          )}
        </TabsContent>
      </Tabs>

      <WhatIfModal
        open={whatIfOutId !== null}
        onClose={() => setWhatIfOutId(null)}
        teamId={teamId}
        leagueId={leagueId}
        outPlayerId={whatIfOutId}
      />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="container mx-auto space-y-4 px-4 py-8">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-5 w-96" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function AiLoadingShell() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-20 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
      <Skeleton className="h-48 w-full" />
      <p className="text-xs text-muted-foreground">
        Gemini is searching the web for the latest injury news and lineup updates — this usually takes 15-30s.
      </p>
    </div>
  );
}
