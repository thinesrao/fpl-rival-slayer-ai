"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShareRecapButton } from "@/components/ShareRecapButton";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpRight, Crown, Dice5, History, Target, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface PlayerRetro {
  playerId: number;
  webName: string;
  predicted: number;
  actual: number;
  delta: number;
  minutes: number;
  played: boolean;
  multiplier: number;
}

interface ManagerRetro {
  entryId: number;
  name: string;
  predictedXI: number;
  actualXI: number;
  delta: number;
  captain: { name: string; minutes: number; actual: number; predictedDelta: number };
  perPlayer: PlayerRetro[];
}

interface RivalRetro extends ManagerRetro {
  pointsGainedVsRival: number;
  predictedGain: number;
}

interface PlayerLuck {
  playerId: number;
  webName: string;
  position: "GKP" | "DEF" | "MID" | "FWD";
  minutes: number;
  goalsActual: number;
  assistsActual: number;
  xGExpected: number;
  xAExpected: number;
  luckPts: number;
  luckPtsGoals: number;
  luckPtsAssists: number;
  multiplier: number;
}

interface LuckSummary {
  luckIndex: number;
  perPlayer: PlayerLuck[];
  topLucky: PlayerLuck[];
  topUnlucky: PlayerLuck[];
}

interface CaptainRoi {
  captainName: string;
  captainPoints: number;
  captainMultiplier: number;
  bestName: string;
  bestPoints: number;
  pointsCost: number;
  hindsightVerdict: string;
}

interface RetrospectiveResponse {
  gw: number;
  leagueName: string;
  user: ManagerRetro;
  rivals: RivalRetro[];
  aiVerdict?: { captainPick: string; captainActual: number; transfersRecommended: number; note: string };
  luck?: LuckSummary;
  captainRoi?: CaptainRoi;
  snapshotTakenAt: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    const err = new Error(body.message || body.error || `Request failed (${res.status})`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

interface Props {
  teamId: number;
  leagueId: number;
}

export function RetrospectivePanel({ teamId, leagueId }: Props) {
  const q = useQuery({
    queryKey: ["retrospective", teamId, leagueId],
    queryFn: () => fetchJson<RetrospectiveResponse>(`/api/retrospective?teamId=${teamId}&leagueId=${leagueId}`),
    retry: 0,
  });

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.error) {
    const status = (q.error as Error & { status?: number }).status;
    return (
      <Alert variant={status === 404 ? "default" : "destructive"}>
        <History className="h-4 w-4" />
        <AlertTitle>
          {status === 404 ? "Retrospective not available yet" : "Couldn’t load retrospective"}
        </AlertTitle>
        <AlertDescription>
          {(q.error as Error).message}
          {status === 404 && (
            <span className="mt-2 block text-xs">
              Snapshots are taken when you run the AI Coach. Once the next GW finishes, this tab will light up
              automatically.
            </span>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  const data = q.data!;
  const user = data.user;
  const captainBeat = user.captain.actual >= user.captain.predictedDelta * 2; // crude
  const positiveRivals = data.rivals.filter((r) => r.pointsGainedVsRival > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <History className="h-3.5 w-3.5" />
          Looking back at GW {data.gw}. Snapshot taken {new Date(data.snapshotTakenAt).toLocaleString()}.
        </span>
        <ShareRecapButton teamId={teamId} gw={data.gw} teamName={user.name} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat
          icon={<Crown className="h-4 w-4 text-warning" />}
          label="Captain"
          value={`${user.captain.name} — ${user.captain.actual} pts`}
          sub={user.captain.minutes === 0 ? "blanked (0 mins)" : user.captain.minutes < 60 ? "cameo" : captainBeat ? "beat projection" : "below projection"}
          tone={user.captain.minutes === 0 ? "bad" : captainBeat ? "good" : "neutral"}
        />
        <Stat
          icon={user.delta >= 0 ? <TrendingUp className="h-4 w-4 text-success" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
          label="Starting XI vs projection"
          value={`${user.actualXI} actual vs ${user.predictedXI.toFixed(1)} xP`}
          sub={`${user.delta >= 0 ? "+" : ""}${user.delta.toFixed(1)} pts`}
          tone={user.delta >= 0 ? "good" : "bad"}
        />
        <Stat
          icon={<ArrowUpRight className="h-4 w-4 text-success" />}
          label="Rivals overtaken (this GW)"
          value={`${positiveRivals.length} / ${data.rivals.length}`}
          sub={positiveRivals.length === data.rivals.length ? "swept the row above" : positiveRivals.length === 0 ? "lost ground everywhere" : "mixed result"}
          tone={positiveRivals.length === data.rivals.length ? "good" : positiveRivals.length === 0 ? "bad" : "neutral"}
        />
      </div>

      {data.aiVerdict && (
        <Alert variant="success">
          <Crown className="h-4 w-4" />
          <AlertTitle>AI Coach verdict</AlertTitle>
          <AlertDescription>{data.aiVerdict.note}</AlertDescription>
        </Alert>
      )}

      {data.captainRoi && <CaptainRoiCard roi={data.captainRoi} />}
      {data.luck && <LuckCard luck={data.luck} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Predicted vs actual (starters)</CardTitle>
          <CardDescription>Each bar pair shows where the model was right and where it missed.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartPredictedVsActual perPlayer={user.perPlayer.filter((p) => p.multiplier > 0)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Points gained on each rival</CardTitle>
          <CardDescription>Positive = you out-scored them this week.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.rivals.map((r) => {
              const gain = r.pointsGainedVsRival;
              return (
                <li key={r.entryId} className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.actualXI} pts (predicted {r.predictedXI.toFixed(1)})
                    </span>
                  </div>
                  <Badge variant={gain > 0 ? "success" : gain < 0 ? "destructive" : "outline"}>
                    {gain > 0 ? "+" : ""}
                    {gain} pts
                  </Badge>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "good" | "bad" | "neutral";
}) {
  const toneClass = tone === "good" ? "border-success/40" : tone === "bad" ? "border-destructive/40" : "";
  return (
    <div className={`rounded-lg border bg-card p-4 ${toneClass}`}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate text-base font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function ChartPredictedVsActual({ perPlayer }: { perPlayer: PlayerRetro[] }) {
  const data = perPlayer
    .slice()
    .sort((a, b) => b.delta - a.delta)
    .map((p) => ({
      name: p.webName,
      delta: p.delta,
      actual: p.actual * p.multiplier,
      predicted: p.predicted * p.multiplier,
    }));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
          <YAxis dataKey="name" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} width={80} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            cursor={{ fill: "hsl(var(--accent) / 0.3)" }}
            formatter={(v: number, name) => [`${v.toFixed(1)}`, name]}
          />
          <Bar dataKey="delta" radius={[0, 4, 4, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.delta >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CaptainRoiCard({ roi }: { roi: CaptainRoi }) {
  const wasOptimal = roi.pointsCost <= 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" /> Captain ROI
        </CardTitle>
        <CardDescription>How your captain pick compared to the best in-XI alternative.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded border bg-muted/40 p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Your captain</div>
            <div className="text-base font-semibold">{roi.captainName}</div>
            <div className="font-mono text-muted-foreground">{roi.captainPoints} pts ({roi.captainMultiplier ?? 2}×)</div>
          </div>
          <div className={cn("rounded border p-3", wasOptimal ? "bg-emerald-500/10 border-emerald-500/40" : "bg-amber-500/10 border-amber-500/40")}>
            <div className="text-[10px] uppercase text-muted-foreground">Best alternative (XI only)</div>
            <div className="text-base font-semibold">{roi.bestName}</div>
            <div className="font-mono text-muted-foreground">{roi.bestPoints} pts in this slot</div>
          </div>
        </div>
        <div className="flex items-center justify-between rounded border bg-muted/40 px-3 py-2 text-sm">
          <span>{roi.hindsightVerdict}</span>
          <Badge variant={roi.pointsCost > 4 ? "destructive" : roi.pointsCost > 0 ? "warning" : "success"}>
            {roi.pointsCost > 0 ? `-${roi.pointsCost}` : "optimal"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function LuckCard({ luck }: { luck: LuckSummary }) {
  const lucky = luck.luckIndex > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Dice5 className="h-4 w-4 text-primary" /> Luck audit
        </CardTitle>
        <CardDescription>
          Approximation using season xG90/xA90 × minutes — positive = you out-performed expectation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div
          className={cn(
            "flex items-center justify-between rounded border p-3",
            lucky ? "border-emerald-500/40 bg-emerald-500/10" : "border-rose-500/40 bg-rose-500/10",
          )}
        >
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Luck index (starting XI)</div>
            <div className="text-lg font-semibold font-mono">
              {lucky ? "+" : ""}
              {luck.luckIndex.toFixed(1)} pts
            </div>
          </div>
          <Badge variant={lucky ? "success" : "destructive"}>{lucky ? "Lucky" : "Unlucky"}</Badge>
        </div>
        {(luck.topLucky.length > 0 || luck.topUnlucky.length > 0) && (
          <div className="grid gap-2 sm:grid-cols-2">
            {luck.topLucky.length > 0 && (
              <div className="rounded border bg-emerald-500/5 p-3">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-emerald-500">
                  Over-performed
                </div>
                <ul className="space-y-0.5 text-xs">
                  {luck.topLucky.map((p) => (
                    <li key={p.playerId} className="flex justify-between gap-2">
                      <span>
                        {p.webName}{" "}
                        <span className="text-muted-foreground">
                          ({p.goalsActual}G+{p.assistsActual}A vs {p.xGExpected.toFixed(1)}xG+{p.xAExpected.toFixed(1)}xA)
                        </span>
                      </span>
                      <span className="font-mono text-emerald-500">+{p.luckPts.toFixed(1)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {luck.topUnlucky.length > 0 && (
              <div className="rounded border bg-rose-500/5 p-3">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-rose-500">
                  Under-performed
                </div>
                <ul className="space-y-0.5 text-xs">
                  {luck.topUnlucky.map((p) => (
                    <li key={p.playerId} className="flex justify-between gap-2">
                      <span>
                        {p.webName}{" "}
                        <span className="text-muted-foreground">
                          ({p.goalsActual}G+{p.assistsActual}A vs {p.xGExpected.toFixed(1)}xG+{p.xAExpected.toFixed(1)}xA)
                        </span>
                      </span>
                      <span className="font-mono text-rose-500">{p.luckPts.toFixed(1)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
