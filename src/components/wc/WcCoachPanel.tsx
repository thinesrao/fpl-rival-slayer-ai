"use client";

// Matchday coach panel: transfer cards (one-tap apply for legal ones), the
// kickoff-ordered captain-rotation timeline, booster advice, watchouts.

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Brain,
  Check,
  Crown,
  ExternalLink,
  RefreshCcw,
  Search,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WcSquadState } from "@/lib/wc/squad/types";
import type { BoosterId } from "@/lib/wc/rules/config";
import { getOrCreateUid } from "@/lib/wc/squad/storage";
import { arrangeLineup } from "./WcSquadBuilder";
import type { WcBootstrap, WcPickerPlayer } from "./useWcData";

interface CoachResponse {
  transfers: Array<{
    outId: number;
    inId: number;
    out: string;
    in: string;
    reason: string;
    hitCost: number;
    legal: boolean;
    whyIllegal?: string;
  }>;
  captainPlan: Array<{ playerId: number | null; player: string; kickoff: string; condition: string; rationale: string }>;
  benchOrder: number[];
  booster: { use: BoosterId | "none"; label: string; reasoning: string; allowed: boolean };
  watchouts: string[];
  newsCitations: Array<{ player: string; summary: string; source_url?: string }>;
  overall: string;
  confidence: string;
  searchQueries: string[];
  freeTransfers: number | "unlimited";
  cached?: boolean;
  error?: string;
}

// Survives page refreshes — the plan stays until a newer one replaces it.
const COACH_STORE_KEY = "wc26:coach:last";

function loadStoredCoach(roundId: number): { at: string; result: CoachResponse } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COACH_STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { at: string; roundId: number; result: CoachResponse };
    return s.roundId === roundId && s.result ? { at: s.at, result: s.result } : null;
  } catch {
    return null;
  }
}

export function WcCoachPanel({
  data,
  squad,
  update,
}: {
  data: WcBootstrap;
  squad: WcSquadState;
  update: (updater: (prev: WcSquadState) => WcSquadState) => void;
}) {
  const [result, setResult] = useState<CoachResponse | null>(null);
  const [resultAt, setResultAt] = useState<string | null>(null);
  const byId = new Map(data.players.map((p) => [p.id, p]));

  // Restore the last plan for this round after a refresh.
  useEffect(() => {
    const stored = loadStoredCoach(data.targetRoundId);
    if (stored) {
      setResult(stored.result);
      setResultAt(stored.at);
    }
  }, [data.targetRoundId]);

  const mutation = useMutation({
    mutationFn: async (fresh: boolean) => {
      const res = await fetch("/api/wc/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: getOrCreateUid(), fresh, squad }),
      });
      const body = (await res.json()) as CoachResponse;
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body;
    },
    onSuccess: (r) => {
      setResult(r);
      const at = new Date().toISOString();
      setResultAt(at);
      try {
        window.localStorage.setItem(
          COACH_STORE_KEY,
          JSON.stringify({ at, roundId: data.targetRoundId, result: r }),
        );
      } catch {
        // storage full/disabled — plan still shows for this session
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Coach failed"),
  });

  const applyTransfer = (t: CoachResponse["transfers"][number]) => {
    const inPlayer = byId.get(t.inId);
    if (!inPlayer) return;
    update((prev) => {
      const picks = prev.picks.map((id) => (id === t.outId ? t.inId : id));
      const players = picks.map((id) => byId.get(id)).filter((p): p is WcPickerPlayer => Boolean(p));
      const { xi, bench } = arrangeLineup(players);
      const roundTransfers = prev.transfersByRound[data.targetRoundId] ?? [];
      return {
        ...prev,
        picks,
        startingXI: xi,
        bench,
        captainId: prev.captainId === t.outId ? xi[0] : prev.captainId,
        viceId: prev.viceId === t.outId ? xi.find((id) => id !== prev.captainId) ?? xi[1] : prev.viceId,
        transfersByRound: {
          ...prev.transfersByRound,
          [data.targetRoundId]: [...roundTransfers, { out: t.outId, in: t.inId, at: new Date().toISOString() }],
        },
      };
    });
    toast.success(`Transfer applied: ${t.out} → ${t.in}. Mirror it on play.fifa.com!`);
  };

  const setCaptainFromPlan = (playerId: number | null) => {
    if (playerId == null || !squad.startingXI.includes(playerId)) {
      toast.error("That player isn't in your starting XI");
      return;
    }
    update((prev) => ({ ...prev, captainId: playerId }));
    toast.success("Captain updated — mirror it on play.fifa.com");
  };

  return (
    <div className="space-y-3">
      {!result && (
        <Card className="border-fut-gold/30">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <Brain className="h-10 w-10 text-fut-gold" />
            <div className="max-w-md text-sm text-muted-foreground">
              The coach reads the live official feed (your squad, fixtures, kickoff order, status
              changes), searches today&apos;s news, and returns a {data.rules.label} plan: transfers
              within your allowance, a captain-rotation timeline, and booster strategy.
            </div>
            <Button onClick={() => mutation.mutate(false)} disabled={mutation.isPending} size="lg">
              {mutation.isPending ? (
                <>
                  <Search className="mr-2 h-4 w-4 animate-pulse" /> Building your plan… (~1 min)
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-4 w-4" /> Get my {data.rules.label} plan
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              {typeof result.freeTransfers === "number" ? `${result.freeTransfers} FT left` : "Unlimited FT"}
            </Badge>
            <Badge
              variant="outline"
              className={
                result.confidence === "high"
                  ? "border-emerald-500/50 text-emerald-300"
                  : result.confidence === "low"
                    ? "border-red-500/50 text-red-300"
                    : "border-amber-500/50 text-amber-300"
              }
            >
              {result.confidence} confidence
            </Badge>
            {result.cached && <Badge variant="outline">cached</Badge>}
            {resultAt && (
              <Badge variant="outline" className="font-mono text-[9px]">
                {new Date(resultAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </Badge>
            )}
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => mutation.mutate(true)} disabled={mutation.isPending}>
              <RefreshCcw className={cn("mr-1 h-3.5 w-3.5", mutation.isPending && "animate-spin")} /> Refresh
            </Button>
          </div>

          <p className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">{result.overall}</p>

          {/* Captain rotation timeline */}
          {result.captainPlan.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Crown className="h-4 w-4 text-fut-gold" /> Captain rotation plan
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.captainPlan.map((c, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-fut-gold/20 font-mono text-[10px] font-bold text-fut-gold">
                        {i + 1}
                      </span>
                      {i < result.captainPlan.length - 1 && <span className="h-6 w-px bg-border" />}
                    </div>
                    <div className="min-w-0 flex-1 pb-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{c.player}</span>
                        {c.kickoff && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {new Date(c.kickoff).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                        {i === 0 && squad.captainId !== c.playerId && (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setCaptainFromPlan(c.playerId)}>
                            Set captain
                          </Button>
                        )}
                      </div>
                      <div className="text-xs text-amber-300/90">{c.condition}</div>
                      <div className="text-xs text-muted-foreground">{c.rationale}</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Transfers */}
          {result.transfers.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ArrowLeftRight className="h-4 w-4 text-fut-gold" /> Transfers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.transfers.map((t, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border p-2.5",
                      t.legal ? "border-border" : "border-red-500/40 bg-red-500/5",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">
                        <span className="text-red-300 line-through decoration-red-400/60">{t.out}</span>
                        {" → "}
                        <span className="font-semibold text-emerald-300">{t.in}</span>
                      </span>
                      {t.hitCost ? (
                        <Badge variant="outline" className="border-red-500/50 px-1 py-0 text-[9px] text-red-300">
                          −{Math.abs(t.hitCost)} hit
                        </Badge>
                      ) : null}
                      {t.legal ? (
                        <Button size="sm" className="ml-auto h-6 px-2 text-[10px]" onClick={() => applyTransfer(t)}>
                          <Check className="mr-0.5 h-3 w-3" /> Apply
                        </Button>
                      ) : (
                        <Badge variant="outline" className="ml-auto border-red-500/50 px-1 py-0 text-[9px] text-red-300">
                          rejected: {t.whyIllegal}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{t.reason}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {/* Booster */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Zap className="h-4 w-4 text-fut-gold" /> Booster call
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Badge variant={result.booster.use === "none" ? "outline" : "secondary"} className="font-mono uppercase">
                    {result.booster.label}
                  </Badge>
                  {!result.booster.allowed && result.booster.use !== "none" && (
                    <Badge variant="outline" className="border-red-500/50 text-[9px] text-red-300">
                      not available this round
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{result.booster.reasoning}</p>
              </CardContent>
            </Card>

            {/* Watchouts + citations */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldAlert className="h-4 w-4 text-amber-300" /> Watchouts & news
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-xs">
                {result.watchouts.map((w, i) => (
                  <div key={i} className="text-muted-foreground">
                    ⚠ {w}
                  </div>
                ))}
                {result.newsCitations.map((c, i) => (
                  <div key={`c-${i}`}>
                    <span className="font-semibold">{c.player}</span>{" "}
                    <span className="text-muted-foreground">{c.summary}</span>
                    {c.source_url && (
                      <a href={c.source_url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center text-fut-gold hover:underline">
                        source <ExternalLink className="ml-0.5 h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {result.searchQueries.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Web searches the AI ran ({result.searchQueries.length})</summary>
              <ul className="mt-1 list-inside list-disc">
                {result.searchQueries.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
