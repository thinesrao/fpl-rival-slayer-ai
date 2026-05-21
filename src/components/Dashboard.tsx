"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, RefreshCcw } from "lucide-react";
import { LeagueSwitcher } from "@/components/LeagueSwitcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SquadCompareTable } from "@/components/SquadCompareTable";
import { DifferentialsCard } from "@/components/DifferentialsCard";
import { OvertakeMeter } from "@/components/OvertakeMeter";
import { RecommendationsPanel } from "@/components/RecommendationsPanel";
import { PlanPanel } from "@/components/PlanPanel";
import { WhatIfModal } from "@/components/WhatIfModal";
import { RivalChipsPanel } from "@/components/RivalChipsPanel";
import { LeagueHeatmap } from "@/components/LeagueHeatmap";
import { MatchesPanel } from "@/components/MatchesPanel";
import { MySquadLivePanel } from "@/components/MySquadLivePanel";
import { BottomNav, type TabId } from "@/components/BottomNav";
import { FloatingChat } from "@/components/FloatingChat";
import { FlipCard } from "@/components/FlipCard";
import { Odometer } from "@/components/Odometer";
import { DraftsPanel } from "@/components/DraftsPanel";
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
  // Cache the active teamId so cross-page features (e.g. /draft/<encoded>
  // import) can pre-fill it without making the user type it again.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("fpl-rival-slayer:teamId", String(teamId));
      window.localStorage.setItem("fpl-rival-slayer:leagueId", String(leagueId));
    } catch {}
  }, [teamId, leagueId]);
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
  const [activeTab, setActiveTab] = useState<TabId>("pitch");

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
    <div className="container mx-auto px-4 py-4 pb-24 md:py-6 md:pb-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 md:mb-6">
        <div>
          <Link href="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> New search
          </Link>
          <h1 className="mt-1 text-lg font-bold sm:text-2xl">{ctx.leagueName}</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            You: <span className="font-medium text-foreground">{ctx.user.entry.name}</span> · rank{" "}
            <span className="font-medium text-foreground">#{ctx.user.entry.rank}</span> ·{" "}
            <span className="inline-flex items-baseline align-baseline font-medium text-foreground">
              <Odometer value={ctx.user.entry.total} minDigits={4} height={18} />
            </span> pts
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <NotificationToggle teamId={teamId} />
          <div className="flex items-center gap-1 rounded-md border bg-card/70 px-2 py-1 font-mono text-xs leading-none">
            <span className="text-muted-foreground">GW{projections.gw}</span>
            <span aria-hidden className="text-muted-foreground/50">·</span>
            <span>{countdown ?? "—"}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            aria-label="Refresh all data"
            title="Refresh"
            onClick={refreshAll}
            disabled={refreshingAll}
            className="h-8 w-8 px-0 sm:h-9 sm:w-auto sm:px-3"
          >
            <RefreshCcw className={cn("h-4 w-4", refreshingAll && "animate-spin")} />
            <span className="ml-1.5 hidden sm:inline">{refreshingAll ? "Refreshing…" : "Refresh"}</span>
          </Button>
          <LeagueSwitcher teamId={teamId} leagueId={leagueId} />
        </div>
      </div>


      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
        <TabsList className="hidden w-full justify-start md:flex">
          <TabsTrigger value="pitch">Pitch</TabsTrigger>
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="rivals">Rivals</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="drafts">Drafts</TabsTrigger>
        </TabsList>

        <TabsContent value="pitch" className="mt-4 space-y-4">
          {closestRival && (
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <Stat
                label="Closest rival"
                value={closestRival.rivalName}
                sub={`${closestRival.pointsBehind} pts ahead`}
                back={
                  <>
                    <div className="font-semibold text-foreground">{closestRival.rivalName}</div>
                    <div>Rank #{closestRival.rivalRank}</div>
                    <div>Total {closestRival.rivalExpected.toFixed(0)} xP this GW</div>
                    <div>You trail by {closestRival.pointsBehind} pts season-to-date</div>
                  </>
                }
              />
              <Stat
                label="Projected XI"
                value={`${projections.user.startingXIPoints.toFixed(1)}`}
                sub={`σ ${projections.user.stdev.toFixed(1)}`}
                back={
                  <>
                    <div className="font-semibold text-foreground">Your starting XI xP</div>
                    <div>Sum of per-player xP including captain multiplier</div>
                    <div>σ = Monte-Carlo standard deviation</div>
                    <div>Higher σ = noisier swing potential</div>
                  </>
                }
              />
              <Stat
                label="Overtake odds"
                value={`${Math.round(closestRival.overtakeProbability * 100)}%`}
                sub={`xP Δ ${closestRival.expectedDelta > 0 ? "+" : ""}${closestRival.expectedDelta.toFixed(1)}`}
                back={
                  <>
                    <div className="font-semibold text-foreground">Single-GW overtake</div>
                    <div>P(your score &gt; {closestRival.rivalName}&apos;s) over one GW</div>
                    <div>Expected delta: {closestRival.expectedDelta >= 0 ? "+" : ""}{closestRival.expectedDelta.toFixed(1)} xP</div>
                    <div>50%+ = even-money territory</div>
                  </>
                }
              />
            </div>
          )}
          <MySquadLivePanel teamId={teamId} leagueId={leagueId} refreshSignal={refreshSignal} />

          <details className="rounded-lg border bg-card/40 group">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
              Past gameweeks <span className="ml-1 text-[10px] uppercase tracking-widest opacity-60">tap to expand</span>
            </summary>
            <div className="border-t p-3 md:p-4">
              <RetrospectivePanel teamId={teamId} leagueId={leagueId} />
            </div>
          </details>
        </TabsContent>

        <TabsContent value="plan" className="mt-4 space-y-6">
          <SectionNav
            sections={[
              { id: "outlook", label: "Outlook" },
              { id: "projections", label: "Projections" },
              { id: "suggested", label: "Suggested" },
              { id: "chips", label: "Chips" },
            ]}
          />

          <section id="outlook" className="space-y-2 scroll-mt-20">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Outlook</h2>
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
          </section>

          <section id="projections" className="space-y-2 scroll-mt-20">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Projections</h2>
            <OvertakeMeter odds={projections.overtake} />
          </section>

          <section id="suggested" className="space-y-2 scroll-mt-20">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Suggested moves</h2>
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
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Run AI analysis</CardTitle>
                  <CardDescription>Click refresh to query Gemini with the latest news.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={() => refetchAnalysis(false)}>Run analysis</Button>
                </CardContent>
              </Card>
            )}
          </section>

          <section id="chips" className="space-y-2 scroll-mt-20">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Chip timing</h2>
            <RivalChipsPanel teamId={teamId} leagueId={leagueId} />
          </section>
        </TabsContent>

        <TabsContent value="matches" className="mt-4">
          <MatchesPanel teamId={teamId} leagueId={leagueId} refreshSignal={refreshSignal} />
        </TabsContent>

        <TabsContent value="rivals" className="mt-4 space-y-6">
          <SectionNav
            sections={[
              { id: "live", label: "Live" },
              { id: "squad", label: "Squad" },
              { id: "diff", label: "Differentials" },
              { id: "heatmap", label: "Ownership" },
              { id: "intel", label: "Intel" },
            ]}
          />

          <section id="live" className="space-y-2 scroll-mt-20">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Live</h2>
            <LivePanel teamId={teamId} leagueId={leagueId} refreshSignal={refreshSignal} />
          </section>

          <section id="squad" className="space-y-2 scroll-mt-20">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Squad comparison</h2>
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
          </section>

          <section id="diff" className="space-y-2 scroll-mt-20">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Differentials</h2>
            {analysisQuery.isLoading && aiEnabled ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <DifferentialsCard userOnly={diff.userOnly} rivalOnly={diff.rivalOnly} />
            )}
          </section>

          <section id="heatmap" className="space-y-2 scroll-mt-20">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">League ownership</h2>
            <LeagueHeatmap leagueId={leagueId} topN={10} />
          </section>

          {eo && priceMoves && (
            <section id="intel" className="space-y-2 scroll-mt-20">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Intel</h2>
              <IntelPanel eo={eo} priceMoves={priceMoves} />
            </section>
          )}
        </TabsContent>

        <TabsContent value="drafts" className="mt-4 space-y-4">
          <DraftsPanel teamId={teamId} />
        </TabsContent>
      </Tabs>

      <WhatIfModal
        open={whatIfOutId !== null}
        onClose={() => setWhatIfOutId(null)}
        teamId={teamId}
        leagueId={leagueId}
        outPlayerId={whatIfOutId}
      />

      {/* Mobile-only bottom nav (5 primary tabs, no More overflow) */}
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Floating co-pilot chat available on every tab */}
      <FloatingChat teamId={teamId} leagueId={leagueId} />
    </div>
  );
}

function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  return (
    <nav
      aria-label="Section navigation"
      className="sticky top-0 z-10 -mx-4 flex gap-1.5 overflow-x-auto border-b bg-background/95 px-4 py-2 backdrop-blur"
    >
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="shrink-0 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

function Stat({
  label,
  value,
  sub,
  back,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Optional reverse-side content; renders as a tap-to-flip card. */
  back?: React.ReactNode;
}) {
  const face = (
    <div className="h-full rounded-lg border bg-card p-2.5 sm:p-4">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">{label}</span>
        {back && <span aria-hidden className="text-[9px] text-muted-foreground">↻</span>}
      </div>
      <div className="mt-1 truncate text-base font-semibold sm:text-lg">{value}</div>
      {sub && <div className="truncate text-[10px] text-muted-foreground sm:text-xs">{sub}</div>}
    </div>
  );
  if (!back) return face;
  const reverse = (
    <div className="h-full rounded-lg border border-primary/40 bg-card p-2.5 text-[11px] leading-snug text-muted-foreground sm:p-4 sm:text-xs">
      {back}
    </div>
  );
  return <FlipCard front={face} back={reverse} />;
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
