"use client";

import type { OvertakeOdds } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function OvertakeMeter({ odds }: { odds: OvertakeOdds[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Overtake probability (1-GW Monte-Carlo, 2000 sims)</CardTitle>
        <CardDescription>
          Probability your projected GW total closes the standings gap with each rival.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {odds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rivals to compare against.</p>
        ) : (
          odds.map((o) => {
            const pct = Math.round(o.overtakeProbability * 100);
            const tone =
              pct >= 60 ? "success" : pct >= 35 ? "warning" : ("destructive" as const);
            return (
              <div key={o.rivalEntryId} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <div className="font-medium">
                    {o.rivalName}
                    <span className="ml-2 text-xs text-muted-foreground">rank {o.rivalRank} · {o.pointsBehind} pts ahead</span>
                  </div>
                  <Badge variant={tone as "success" | "warning" | "destructive"}>{pct}%</Badge>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      pct >= 60 ? "bg-success" : pct >= 35 ? "bg-amber-500" : "bg-destructive",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-[11px] text-muted-foreground">
                  xP delta vs rival: {o.expectedDelta > 0 ? "+" : ""}
                  {o.expectedDelta.toFixed(1)}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
