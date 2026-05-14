"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, Sparkles, TrendingDown, TrendingUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import type { Position } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Candidate {
  playerId: number;
  webName: string;
  teamShort: string;
  cost: number; // tenths
  xPoints: number;
  selectedByPct: number;
  injuryRisk: number;
  notes: string[];
  status: "a" | "d" | "i" | "n" | "s" | "u";
}

interface OutPlayer {
  id: number;
  webName: string;
  teamShort: string;
  cost: number;
  position: Position;
}

interface CandidatesResponse {
  outPlayer: OutPlayer;
  bank: number;
  candidates: Candidate[];
}

interface SimResponse {
  result: {
    legality: { ok: boolean; reason?: string };
    budgetAfter: number;
    xPDeltaXi: number;
    overtakeDelta?: Array<{ rivalEntryId: number; rivalName: string; before: number; after: number; delta: number }>;
    out: { webName: string; xPoints: number };
    in: { webName: string; xPoints: number };
  };
  baseline: { startingXi: number };
}

interface Props {
  open: boolean;
  onClose: () => void;
  teamId: number;
  leagueId: number;
  outPlayerId: number | null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(body.message || body.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function WhatIfModal({ open, onClose, teamId, leagueId, outPlayerId }: Props) {
  const [selectedInId, setSelectedInId] = useState<number | null>(null);

  // Reset selection whenever the out-player changes or modal reopens.
  useEffect(() => {
    setSelectedInId(null);
  }, [outPlayerId, open]);

  // Lock scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const candidatesQuery = useQuery({
    queryKey: ["whatif-candidates", teamId, leagueId, outPlayerId],
    queryFn: () =>
      fetchJson<CandidatesResponse>(
        `/api/whatif?teamId=${teamId}&leagueId=${leagueId}&outId=${outPlayerId}&limit=12`,
      ),
    enabled: open && !!outPlayerId,
    staleTime: 60_000,
  });

  const simMutation = useMutation({
    mutationFn: (inId: number) =>
      fetchJson<SimResponse>(`/api/whatif`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId, leagueId, outId: outPlayerId, inId }),
      }),
  });

  // When user picks a candidate, fire the sim.
  useEffect(() => {
    if (selectedInId && outPlayerId) simMutation.mutate(selectedInId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInId, outPlayerId]);

  if (!open) return null;

  const out = candidatesQuery.data?.outPlayer;
  const candidates = candidatesQuery.data?.candidates ?? [];
  const bank = candidatesQuery.data?.bank ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-lg border bg-card shadow-2xl sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" />
              What-if simulator
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {out ? (
                <>
                  Replacing <strong className="text-foreground">{out.webName}</strong> ({out.teamShort},{" "}
                  £{(out.cost / 10).toFixed(1)}m, {out.position}). Bank £{(bank / 10).toFixed(1)}m → max spend £
                  {((out.cost + bank) / 10).toFixed(1)}m.
                </>
              ) : (
                "Loading candidates…"
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Top {candidates.length} replacements
            </div>
            {candidatesQuery.isLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : candidatesQuery.error ? (
              <Alert variant="destructive">
                <AlertTitle>Couldn&apos;t load candidates</AlertTitle>
                <AlertDescription>{(candidatesQuery.error as Error).message}</AlertDescription>
              </Alert>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No legal replacements within budget. Free up some cash or pick a cheaper OUT.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {candidates.map((c) => {
                  const isSelected = selectedInId === c.playerId;
                  const delta = out ? c.xPoints - 0 : 0; // placeholder; real delta shown in pane.
                  void delta;
                  return (
                    <li key={c.playerId}>
                      <button
                        type="button"
                        onClick={() => setSelectedInId(c.playerId)}
                        className={cn(
                          "w-full rounded-md border p-2 text-left transition-colors",
                          isSelected ? "border-primary bg-primary/10" : "bg-card hover:bg-muted",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold">
                              {c.webName} <span className="text-xs font-normal text-muted-foreground">{c.teamShort}</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 pt-0.5 text-[11px] text-muted-foreground">
                              <span>£{(c.cost / 10).toFixed(1)}m</span>
                              <span>· EO {c.selectedByPct.toFixed(1)}% global</span>
                              {c.status === "d" && <Badge variant="warning" className="px-1 py-0 text-[10px]">doubt</Badge>}
                              {c.injuryRisk >= 0.3 && (
                                <Badge variant="destructive" className="px-1 py-0 text-[10px]">
                                  {Math.round(c.injuryRisk * 100)}% inj
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-mono text-sm font-semibold">{c.xPoints.toFixed(1)}</div>
                            <div className="text-[10px] uppercase text-muted-foreground">xP</div>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Swap preview
            </div>
            {!selectedInId ? (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  Pick a replacement on the left to see how it changes your projection and overtake odds.
                </CardContent>
              </Card>
            ) : simMutation.isPending ? (
              <div className="flex items-center justify-center gap-2 rounded-md border p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Simulating…
              </div>
            ) : simMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Sim failed</AlertTitle>
                <AlertDescription>{(simMutation.error as Error).message}</AlertDescription>
              </Alert>
            ) : simMutation.data ? (
              <SwapDelta sim={simMutation.data} />
            ) : null}
          </div>
        </div>

        <div className="border-t p-3 text-[11px] text-muted-foreground">
          Exploratory only — nothing is saved to FPL. Numbers use the same xP + Monte-Carlo model as the dashboard.
        </div>
      </div>
    </div>
  );
}

function SwapDelta({ sim }: { sim: SimResponse }) {
  const r = sim.result;
  if (!r.legality.ok) {
    return (
      <Alert variant="warning">
        <AlertTitle>Illegal swap</AlertTitle>
        <AlertDescription>{r.legality.reason ?? "This swap can't be applied."}</AlertDescription>
      </Alert>
    );
  }
  const positive = r.xPDeltaXi >= 0;
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <Badge variant="destructive">OUT {r.out.webName}</Badge>
            <ArrowRight className="h-4 w-4" />
            <Badge variant="success">IN {r.in.webName}</Badge>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded bg-muted/50 p-2">
              <div className="text-[10px] uppercase text-muted-foreground">XI xP delta</div>
              <div className={cn("font-mono text-base font-semibold", positive ? "text-emerald-500" : "text-rose-500")}>
                {positive ? <TrendingUp className="mr-0.5 inline h-3.5 w-3.5" /> : <TrendingDown className="mr-0.5 inline h-3.5 w-3.5" />}
                {positive ? "+" : ""}{r.xPDeltaXi.toFixed(1)}
              </div>
            </div>
            <div className="rounded bg-muted/50 p-2">
              <div className="text-[10px] uppercase text-muted-foreground">Out xP</div>
              <div className="font-mono text-base">{r.out.xPoints.toFixed(1)}</div>
            </div>
            <div className="rounded bg-muted/50 p-2">
              <div className="text-[10px] uppercase text-muted-foreground">In xP</div>
              <div className="font-mono text-base">{r.in.xPoints.toFixed(1)}</div>
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Bank after swap: £{(r.budgetAfter / 10).toFixed(1)}m
          </div>
        </CardContent>
      </Card>

      {r.overtakeDelta && r.overtakeDelta.length > 0 && (
        <Card>
          <CardContent className="space-y-1.5 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Overtake odds change
            </div>
            {r.overtakeDelta.map((o) => {
              const delta = o.delta;
              const tone = delta > 0.005 ? "success" : delta < -0.005 ? "destructive" : "outline";
              return (
                <div key={o.rivalEntryId} className="flex items-center justify-between text-xs">
                  <span className="truncate">{o.rivalName}</span>
                  <span className="flex items-center gap-1 font-mono">
                    {Math.round(o.before * 100)}% → {Math.round(o.after * 100)}%
                    <Badge variant={tone} className="px-1 py-0 text-[10px]">
                      {delta > 0 ? "+" : ""}
                      {(delta * 100).toFixed(1)}pp
                    </Badge>
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
