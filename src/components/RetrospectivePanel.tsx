"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpRight, Crown, History, TrendingDown, TrendingUp } from "lucide-react";

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

interface RetrospectiveResponse {
  gw: number;
  leagueName: string;
  user: ManagerRetro;
  rivals: RivalRetro[];
  aiVerdict?: { captainPick: string; captainActual: number; transfersRecommended: number; note: string };
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
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <History className="h-3.5 w-3.5" />
        <span>Looking back at GW {data.gw}. Snapshot taken {new Date(data.snapshotTakenAt).toLocaleString()}.</span>
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
