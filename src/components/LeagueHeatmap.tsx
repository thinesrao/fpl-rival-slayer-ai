"use client";

import { useQuery } from "@tanstack/react-query";
import { Crown, Grid2x2, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface Owner {
  entryId: number;
  rank: number;
  entryName: string;
  playerName: string;
  total: number;
}

interface OwnedPlayer {
  playerId: number;
  webName: string;
  teamShort: string;
  positionShort: string;
  cost: number;
  selectedByPct: number;
  occurrences: Array<{
    entryId: number;
    rank: number;
    multiplier: number;
    isCaptain: boolean;
    isVice: boolean;
  }>;
  ownersCount: number;
  startersCount: number;
  captainsCount: number;
  eoPct: number;
  captainEoPct: number;
}

interface OwnershipResponse {
  leagueName: string;
  gw: number;
  topN: number;
  owners: Owner[];
  players: OwnedPlayer[];
}

interface Props {
  leagueId: number;
  topN?: number;
  /** Max player rows to render (sorted by captainEO desc). */
  maxRows?: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(body.message || body.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

function cellTone(occ: OwnedPlayer["occurrences"][number] | undefined) {
  if (!occ) return "bg-muted/30";
  if (occ.isCaptain) return "bg-amber-500/40 ring-1 ring-amber-500";
  if (occ.multiplier === 3) return "bg-amber-500/50 ring-1 ring-amber-500"; // TC
  if (occ.multiplier > 0) return "bg-emerald-500/35";
  return "bg-slate-400/30"; // bench
}

export function LeagueHeatmap({ leagueId, topN = 10, maxRows = 24 }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["league-ownership", leagueId, topN],
    queryFn: () => fetchJson<OwnershipResponse>(`/api/league-ownership?leagueId=${leagueId}&top=${topN}`),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load league ownership</AlertTitle>
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    );
  if (!data) return null;

  const players = data.players.slice(0, maxRows);
  const owners = data.owners;
  const differentials = data.players
    .filter((p) => p.eoPct <= 20 && p.startersCount > 0)
    .slice(0, 6);
  const template = data.players.filter((p) => p.eoPct >= 70).slice(0, 6);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Grid2x2 className="h-4 w-4 text-primary" /> Top {data.topN} league ownership · GW {data.gw}
        </CardTitle>
        <CardDescription>
          Who owns what among the top {data.topN} of {data.leagueName}. Gold = captain, green = starter, grey = bench.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Mobile-first: condensed list. */}
        <div className="lg:hidden space-y-1.5">
          {players.map((p) => (
            <div key={p.playerId} className="rounded border bg-muted/30 p-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <div className="truncate font-medium">
                  {p.webName}{" "}
                  <span className="text-[11px] font-normal text-muted-foreground">
                    {p.teamShort} · {p.positionShort}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  <Badge variant={p.eoPct >= 70 ? "warning" : p.eoPct <= 20 ? "success" : "outline"} className="px-1 py-0">
                    EO {p.eoPct.toFixed(0)}%
                  </Badge>
                  {p.captainsCount > 0 && (
                    <Badge variant="default" className="px-1 py-0">
                      <Crown className="mr-0.5 h-2.5 w-2.5" /> {p.captainsCount}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="mt-1 flex gap-0.5">
                {owners.map((o) => {
                  const occ = p.occurrences.find((x) => x.entryId === o.entryId);
                  return (
                    <div
                      key={o.entryId}
                      title={`${o.entryName} (${o.playerName}) — ${occ ? (occ.isCaptain ? "captain" : occ.multiplier > 0 ? "starter" : "bench") : "not owned"}`}
                      className={cn("h-3 flex-1 rounded-sm", cellTone(occ))}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Desktop: grid with sticky owner header. */}
        <div className="hidden lg:block">
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border-b bg-card px-2 py-1 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    Player
                  </th>
                  <th className="border-b bg-card px-1 py-1 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                    EO
                  </th>
                  <th className="border-b bg-card px-1 py-1 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                    C-EO
                  </th>
                  {owners.map((o) => (
                    <th
                      key={o.entryId}
                      title={`${o.entryName} (${o.playerName}) — rank ${o.rank}, ${o.total} pts`}
                      className="border-b bg-card px-1 py-1 text-center text-[10px] font-medium text-muted-foreground"
                    >
                      #{o.rank}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.playerId} className="hover:bg-muted/30">
                    <td className="sticky left-0 z-10 border-b bg-card px-2 py-1 font-medium">
                      <div className="truncate">{p.webName}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.teamShort} · {p.positionShort}
                      </div>
                    </td>
                    <td className="border-b px-1 py-1 text-right font-mono">{p.eoPct.toFixed(0)}%</td>
                    <td className="border-b px-1 py-1 text-right font-mono">{p.captainEoPct.toFixed(0)}%</td>
                    {owners.map((o) => {
                      const occ = p.occurrences.find((x) => x.entryId === o.entryId);
                      return (
                        <td
                          key={o.entryId}
                          className={cn("border-b p-0", cellTone(occ))}
                          title={`${o.entryName}: ${occ ? (occ.isCaptain ? "Captain" : occ.multiplier === 3 ? "Triple Captain" : occ.multiplier > 0 ? "Starter" : "Bench") : "Does not own"}`}
                        >
                          <div className="h-6 w-full" />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="h-3 w-3" /> Template (≥70%)
            </div>
            {template.length === 0 ? (
              <p className="text-xs text-muted-foreground">No player breaches the template threshold.</p>
            ) : (
              <ul className="space-y-0.5 text-xs">
                {template.map((t) => (
                  <li key={t.playerId} className="flex justify-between">
                    <span>{t.webName} <span className="text-muted-foreground">({t.teamShort})</span></span>
                    <span className="font-mono">{t.eoPct.toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Crown className="h-3 w-3" /> Top-10 differentials (≤20%)
            </div>
            {differentials.length === 0 ? (
              <p className="text-xs text-muted-foreground">No genuine differentials — everyone&apos;s converging.</p>
            ) : (
              <ul className="space-y-0.5 text-xs">
                {differentials.map((d) => (
                  <li key={d.playerId} className="flex justify-between">
                    <span>{d.webName} <span className="text-muted-foreground">({d.teamShort})</span></span>
                    <span className="font-mono">{d.eoPct.toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
