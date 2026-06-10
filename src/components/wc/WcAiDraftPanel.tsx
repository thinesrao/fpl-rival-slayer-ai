"use client";

// AI draft panel: one tap → optimizer + Gemini (web-grounded) squad with
// per-pick rationale and citations; "Use this squad" loads it into the builder.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Brain, Check, ExternalLink, RefreshCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WcSquadState } from "@/lib/wc/squad/types";
import { WcPitch } from "./WcPitch";
import type { WcBootstrap, WcPickerPlayer } from "./useWcData";

interface DraftResponse {
  squad: {
    picks: number[];
    startingXI: number[];
    bench: number[];
    captainId: number;
    viceId: number;
    totalCost: number;
  };
  baseLabel: string;
  appliedSwaps: Array<{ out: string; in: string; reason: string }>;
  revertedSwaps: Array<{ out: string; in: string; reason: string; whyReverted: string }>;
  perPickNotes: Array<{ playerId: number; note: string }>;
  risks: string[];
  newsCitations: Array<{ player: string; summary: string; source_url?: string }>;
  overallStrategy: string;
  confidence: string;
  searchQueries: string[];
  groundingChunks: Array<{ uri: string; title: string }>;
  aiUsed: boolean;
  cached?: boolean;
  error?: string;
}

export interface WcAiDraftPanelProps {
  data: WcBootstrap;
  update: (updater: (prev: WcSquadState) => WcSquadState) => void;
  onAdopted?: () => void;
}

export function WcAiDraftPanel({ data, update, onAdopted }: WcAiDraftPanelProps) {
  const [result, setResult] = useState<DraftResponse | null>(null);

  const mutation = useMutation({
    mutationFn: async (fresh: boolean) => {
      const res = await fetch("/api/wc/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fresh }),
      });
      const body = (await res.json()) as DraftResponse;
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body;
    },
    onSuccess: setResult,
    onError: (err) => toast.error(err instanceof Error ? err.message : "Draft failed"),
  });

  const byId = new Map(data.players.map((p) => [p.id, p]));
  const resolve = (ids: number[]) =>
    ids.map((id) => byId.get(id)).filter((p): p is WcPickerPlayer => Boolean(p));

  const adopt = () => {
    if (!result) return;
    update((prev) => ({
      ...prev,
      picks: result.squad.picks,
      startingXI: result.squad.startingXI,
      bench: result.squad.bench,
      captainId: result.squad.captainId,
      viceId: result.squad.viceId,
    }));
    toast.success("AI squad loaded into your builder — tweak away");
    onAdopted?.();
  };

  return (
    <div className="space-y-3">
      {!result && (
        <Card className="border-fut-gold/30">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <Brain className="h-10 w-10 text-fut-gold" />
            <div className="max-w-md text-sm text-muted-foreground">
              The optimizer builds three rule-perfect squads from official prices, fixtures, and
              ownership — then Gemini cross-checks every pick against this week&apos;s squad lists,
              injury news, and predicted lineups via live web search.
            </div>
            <Button onClick={() => mutation.mutate(false)} disabled={mutation.isPending} size="lg">
              {mutation.isPending ? (
                <>
                  <Search className="mr-2 h-4 w-4 animate-pulse" /> Searching the news… (~1 min)
                </>
              ) : (
                <>
                  <Brain className="mr-2 h-4 w-4" /> Draft my squad with AI
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono uppercase">
              {result.baseLabel} build
            </Badge>
            <Badge variant="outline" className="font-mono">
              ${result.squad.totalCost.toFixed(1)}m
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
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => mutation.mutate(true)} disabled={mutation.isPending}>
                <RefreshCcw className={`mr-1 h-3.5 w-3.5 ${mutation.isPending ? "animate-spin" : ""}`} /> Re-roll
              </Button>
              <Button size="sm" onClick={adopt}>
                <Check className="mr-1 h-3.5 w-3.5" /> Use this squad
              </Button>
            </div>
          </div>

          <p className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
            {result.overallStrategy}
          </p>

          <WcPitch
            startingXI={resolve(result.squad.startingXI)}
            bench={resolve(result.squad.bench)}
            captainId={result.squad.captainId}
            viceId={result.squad.viceId}
          />

          <div className="grid gap-3 md:grid-cols-2">
            {result.perPickNotes.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Why these picks</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 text-xs">
                  {result.perPickNotes.map((n, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 font-semibold">{byId.get(n.playerId)?.name ?? `#${n.playerId}`}:</span>
                      <span className="text-muted-foreground">{n.note}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <div className="space-y-3">
              {result.newsCitations.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Live news the AI verified</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5 text-xs">
                    {result.newsCitations.map((c, i) => (
                      <div key={i}>
                        <span className="font-semibold">{c.player}</span>{" "}
                        <span className="text-muted-foreground">{c.summary}</span>
                        {c.source_url && (
                          <a
                            href={c.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1 inline-flex items-center text-fut-gold hover:underline"
                          >
                            source <ExternalLink className="ml-0.5 h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {(result.risks.length > 0 || result.revertedSwaps.length > 0) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Risks & guard-rails</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-xs text-muted-foreground">
                    {result.risks.map((r, i) => (
                      <div key={i}>⚠ {r}</div>
                    ))}
                    {result.revertedSwaps.map((s, i) => (
                      <div key={`rev-${i}`}>
                        🛡 Rejected AI swap {s.out} → {s.in}: {s.whyReverted}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
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
