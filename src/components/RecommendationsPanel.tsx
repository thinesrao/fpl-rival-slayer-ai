"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ChevronDown, ChevronUp, ExternalLink, Newspaper, Search, ShieldAlert, Sparkles, Trophy } from "lucide-react";
import type { AiResult } from "@/lib/ai/gemini";

const CONFIDENCE_TONE = {
  low: "destructive" as const,
  medium: "warning" as const,
  high: "success" as const,
};

export function RecommendationsPanel({ ai }: { ai: AiResult }) {
  const [expanded, setExpanded] = useState(false);
  const rec = ai.recommendation;

  return (
    <div className="space-y-4">
      <Alert variant="success">
        <Sparkles className="h-4 w-4" />
        <AlertTitle className="flex items-center gap-2">
          AI strategist verdict
          <Badge variant={CONFIDENCE_TONE[rec.confidence]}>{rec.confidence} confidence</Badge>
        </AlertTitle>
        <AlertDescription>{rec.overall_strategy || "No strategy returned."}</AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-primary" /> Captain
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex gap-2">
              <Badge variant="success">C {rec.captain.pick || "—"}</Badge>
              <Badge variant="secondary">V {rec.captain.vice || "—"}</Badge>
            </div>
            <p className="text-muted-foreground">{rec.captain.reasoning}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-primary" /> Chip strategy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Badge variant={rec.chip.use === "none" ? "outline" : "default"}>
              {rec.chip.use === "none" ? "Hold chips" : `Play ${rec.chip.use}`}
            </Badge>
            <p className="text-muted-foreground">{rec.chip.reasoning}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transfers</CardTitle>
          <CardDescription>Each one targets a specific rival above you.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rec.transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Hold transfers — no high-conviction move available.</p>
          ) : (
            rec.transfers.map((t, i) => (
              <div key={i} className="rounded-md border bg-muted/40 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <Badge variant="destructive">OUT {t.out}</Badge>
                  <span>→</span>
                  <Badge variant="success">IN {t.in}</Badge>
                  {t.hit_cost ? <Badge variant="warning">−{t.hit_cost} hit</Badge> : null}
                  {t.rival_targeted ? (
                    <Badge variant="outline" className="ml-auto">vs {t.rival_targeted}</Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t.reason}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Starting XI</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            {rec.starting_xi.map((name, i) => (
              <li key={i} className="truncate">
                <span className="text-muted-foreground">{i + 1}.</span> {name}
              </li>
            ))}
          </ul>
          {rec.differentials_to_exploit.length > 0 && (
            <>
              <Separator className="my-3" />
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Differentials to exploit</p>
              <div className="flex flex-wrap gap-1.5">
                {rec.differentials_to_exploit.map((d) => (
                  <Badge key={d} variant="outline">{d}</Badge>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Newspaper className="h-4 w-4 text-primary" /> News cited by the strategist
          </CardTitle>
          <CardDescription>Live sources Gemini pulled in via Google Search grounding.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rec.news_citations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No citations returned for this run.</p>
          ) : (
            rec.news_citations.map((c, i) => (
              <div key={i} className="flex flex-col gap-1 rounded-md border bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span>{c.player}</span>
                  {c.source_url && (
                    <a
                      href={c.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      source <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{c.summary}</p>
              </div>
            ))
          )}
          {ai.searchQueries.length > 0 && (
            <div className="pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded((v) => !v)}
                className="-mx-2 h-7 px-2 text-xs"
              >
                {expanded ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
                {ai.searchQueries.length} search queries
              </Button>
              {expanded && (
                <ul className="mt-2 space-y-1 rounded-md bg-muted/30 p-2 text-xs">
                  {ai.searchQueries.map((q, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-muted-foreground">
                      <Search className="h-3 w-3" /> {q}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
