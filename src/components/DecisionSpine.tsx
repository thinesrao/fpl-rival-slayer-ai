"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ModelTrustBadge } from "@/components/ModelTrustBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Action, Decision, GateStatus } from "@/lib/decision/types";

export function verdictTone(status: GateStatus): "amber" | "green" | "muted" {
  if (status === "recommend") return "green";
  if (status === "too-close") return "amber";
  return "muted";
}

export function formatDelta(action: Action): string {
  const pct = (v: number) => `${v >= 0 ? "+" : "-"}${Math.abs(v * 100).toFixed(1)}%`;
  const { mean, lower80, upper80 } = action.overtakeDelta;
  const hit = action.hitCost !== 0 ? ` after a ${Math.abs(action.hitCost)}-point hit` : "";
  return `${pct(mean)} overtake odds (80% range ${pct(lower80)} to ${pct(upper80)})${hit}`;
}

export type SpineState = "loading" | "error" | "ready";

export function spineState(args: { isLoading: boolean; isError: boolean; hasData: boolean }): SpineState {
  if (args.isLoading) return "loading";
  if (args.isError || !args.hasData) return "error";
  return "ready";
}

export function showsTrustBadge(status: GateStatus): boolean {
  return status === "recommend" || status === "too-close";
}

const TONE_CLASS: Record<ReturnType<typeof verdictTone>, string> = {
  green: "border-emerald-500/40 bg-emerald-500/5",
  amber: "border-amber-500/40 bg-amber-500/5",
  muted: "border-border bg-card/40",
};

async function fetchDecision(teamId: number, leagueId: number): Promise<Decision> {
  const res = await fetch(`/api/decision?teamId=${teamId}&leagueId=${leagueId}`);
  if (!res.ok) throw new Error(`decision ${res.status}`);
  return (await res.json()) as Decision;
}

export function DecisionSpine({
  teamId,
  leagueId,
  onNavigate,
}: {
  teamId: number;
  leagueId: number;
  onNavigate: (tab: string, params?: Record<string, string>) => void;
}) {
  const [showAlternatives, setShowAlternatives] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["decision", teamId, leagueId],
    queryFn: () => fetchDecision(teamId, leagueId),
  });

  const state = spineState({ isLoading, isError, hasData: !!data });

  if (state === "loading") {
    return (
      <Card className="border-border bg-card/40">
        <CardContent className="py-4 text-sm text-muted-foreground">Working out your week…</CardContent>
      </Card>
    );
  }

  if (state === "error" || !data) {
    return (
      <Card className="border-border bg-card/40">
        <CardContent className="py-4 text-sm text-muted-foreground">Could not compute the verdict.</CardContent>
      </Card>
    );
  }

  const tone = verdictTone(data.gateStatus);

  return (
    <Card className={TONE_CLASS[tone]}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{data.verdict.headline}</CardTitle>
          <span className="text-xs text-muted-foreground">
            GW{data.deadline.gw} · {Math.max(0, Math.round(data.deadline.hoursRemaining))}h left
          </span>
        </div>
        <CardDescription>{data.note ?? data.verdict.detail}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {data.verdict.kind !== "roll" && (
          <p className="text-sm font-medium">{formatDelta(data.verdict)}</p>
        )}

        {showsTrustBadge(data.gateStatus) && <ModelTrustBadge />}

        {data.verdict.evidence.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {data.verdict.evidence.map((e) => (
              <button
                key={`${e.tab}:${e.label}`}
                type="button"
                onClick={() => onNavigate(e.tab, e.params)}
                className="rounded-full border px-3 py-1 text-xs hover:bg-accent"
              >
                {e.label} →
              </button>
            ))}
          </div>
        )}

        {data.alternatives.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowAlternatives((v) => !v)}
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              {showAlternatives ? "Hide" : "What else was considered"} ({data.alternatives.length})
            </button>
            {showAlternatives && (
              <ul className="mt-2 space-y-1">
                {data.alternatives.map((a) => (
                  <li key={a.headline} className="flex justify-between gap-3 text-xs">
                    <span>{a.headline}</span>
                    <span className="text-muted-foreground">{formatDelta(a)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
