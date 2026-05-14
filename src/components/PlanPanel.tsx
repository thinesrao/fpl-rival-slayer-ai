"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Calendar, Target, TrendingUp, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { FplFixture, FplTeam, RivalContext, SquadProjection, OvertakeOdds } from "@/lib/types";
import { cn } from "@/lib/utils";

interface HorizonGw {
  gw: number;
  fixtures: FplFixture[];
  user: SquadProjection;
  rivals: SquadProjection[];
  overtake: OvertakeOdds[];
}

interface CumulativeOvertake {
  rivalEntryId: number;
  rivalName: string;
  pointsBehind: number;
  userExpectedTotal: number;
  rivalExpectedTotal: number;
  expectedDelta: number;
  overtakeProbability: number;
}

interface Props {
  horizon: HorizonGw[];
  cumulative: CumulativeOvertake[];
  context: RivalContext;
  teams: FplTeam[];
}

function fdrTone(fdr: number) {
  if (fdr <= 2) return "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300";
  if (fdr <= 3) return "bg-slate-500/20 text-slate-700 dark:text-slate-300";
  if (fdr <= 4) return "bg-amber-500/20 text-amber-700 dark:text-amber-300";
  return "bg-rose-500/20 text-rose-700 dark:text-rose-300";
}

export function PlanPanel({ horizon, cumulative, context, teams }: Props) {
  if (horizon.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan</CardTitle>
          <CardDescription>No upcoming gameweeks available.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const userTeams = new Set(context.user.picks.map((s) => s.team.id));

  const chartData = horizon.map((h) => {
    const row: Record<string, number | string> = { gw: `GW ${h.gw}`, You: h.user.startingXIPoints };
    for (let i = 0; i < context.rivals.length; i++) {
      const name = context.rivals[i].entry.name.slice(0, 12);
      row[name] = h.rivals[i]?.startingXIPoints ?? 0;
    }
    return row;
  });

  const rivalSeries = context.rivals.map((r, idx) => ({
    name: r.entry.name.slice(0, 12),
    color: `hsl(${(idx * 47 + 200) % 360} 70% 55%)`,
  }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4 text-primary" /> {horizon.length}-GW plan horizon
          </CardTitle>
          <CardDescription>
            Per-gameweek projections + cumulative overtake odds. Sims = 5 000 over {horizon.length} GWs ·
            current squad rolled forward (no transfers modelled here).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="gw" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => `${v.toFixed(1)} pts`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="You" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                {rivalSeries.map((r) => (
                  <Bar key={r.name} dataKey={r.name} fill={r.color} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {horizon.map((h) => {
          const blank = h.fixtures.length === 0;
          const teamFixtureCount = new Map<number, number>();
          for (const f of h.fixtures) {
            teamFixtureCount.set(f.team_h, (teamFixtureCount.get(f.team_h) ?? 0) + 1);
            teamFixtureCount.set(f.team_a, (teamFixtureCount.get(f.team_a) ?? 0) + 1);
          }
          const userDoubles = [...userTeams].filter((tid) => (teamFixtureCount.get(tid) ?? 0) > 1);
          const userBlanks = [...userTeams].filter((tid) => (teamFixtureCount.get(tid) ?? 0) === 0);

          return (
            <Card key={h.gw}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">GW {h.gw}</CardTitle>
                  <Badge variant="outline">σ {h.user.stdev.toFixed(1)}</Badge>
                </div>
                <CardDescription className="text-xs">
                  {blank ? "Blank gameweek" : `${h.fixtures.length} matches`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">You</span>
                  <span className="font-semibold">{h.user.startingXIPoints.toFixed(1)} pts</span>
                </div>
                {h.rivals.map((r, i) => {
                  const odds = h.overtake.find((o) => o.rivalEntryId === context.rivals[i].entry.id);
                  return (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate text-muted-foreground">{context.rivals[i].entry.name}</span>
                      <span className="font-mono">
                        {r?.startingXIPoints.toFixed(1) ?? "—"}{" "}
                        <Badge variant={odds && odds.overtakeProbability >= 0.5 ? "success" : "outline"} className="ml-1 px-1 py-0 text-[10px]">
                          {odds ? Math.round(odds.overtakeProbability * 100) : "?"}%
                        </Badge>
                      </span>
                    </div>
                  );
                })}
                {(userDoubles.length > 0 || userBlanks.length > 0) && (
                  <>
                    <Separator className="my-1" />
                    <div className="flex flex-wrap gap-1 text-[10px]">
                      {userDoubles.map((tid) => (
                        <Badge key={`d-${tid}`} variant="success" className="px-1 py-0">
                          <Zap className="mr-0.5 h-2.5 w-2.5" />
                          {teamsById.get(tid)?.short_name} DGW
                        </Badge>
                      ))}
                      {userBlanks.map((tid) => (
                        <Badge key={`b-${tid}`} variant="warning" className="px-1 py-0">
                          {teamsById.get(tid)?.short_name} blank
                        </Badge>
                      ))}
                    </div>
                  </>
                )}
                <div className="pt-1">
                  <div className="flex flex-wrap gap-1">
                    {h.fixtures
                      .filter((f) => userTeams.has(f.team_h) || userTeams.has(f.team_a))
                      .slice(0, 6)
                      .map((f, i) => {
                        const userIsHome = userTeams.has(f.team_h);
                        const oppId = userIsHome ? f.team_a : f.team_h;
                        const myId = userIsHome ? f.team_h : f.team_a;
                        const fdr = userIsHome ? f.team_h_difficulty : f.team_a_difficulty;
                        return (
                          <span
                            key={i}
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-medium",
                              fdrTone(fdr),
                            )}
                          >
                            {teamsById.get(myId)?.short_name}
                            <span className="opacity-60"> {userIsHome ? "v" : "@"} </span>
                            {teamsById.get(oppId)?.short_name}
                          </span>
                        );
                      })}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-primary" /> Cumulative overtake odds
          </CardTitle>
          <CardDescription>
            P(you leap each rival in the standings after {horizon.length} GWs).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {cumulative.map((c) => (
            <div key={c.rivalEntryId} className="rounded-md border bg-muted/30 p-3">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{c.rivalName}</div>
                <Badge variant={c.overtakeProbability >= 0.5 ? "success" : "outline"}>
                  {Math.round(c.overtakeProbability * 100)}%
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground sm:grid-cols-4">
                <div>
                  <span className="block text-[10px] uppercase tracking-wide">Gap</span>
                  <span className="font-mono text-foreground">{c.pointsBehind} pts</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase tracking-wide">You (Σ)</span>
                  <span className="font-mono text-foreground">{c.userExpectedTotal.toFixed(1)}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase tracking-wide">Rival (Σ)</span>
                  <span className="font-mono text-foreground">{c.rivalExpectedTotal.toFixed(1)}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase tracking-wide">xP delta</span>
                  <span className={cn("font-mono", c.expectedDelta >= 0 ? "text-emerald-500" : "text-rose-500")}>
                    <TrendingUp className="mr-0.5 inline h-3 w-3" />
                    {c.expectedDelta >= 0 ? "+" : ""}
                    {c.expectedDelta.toFixed(1)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
