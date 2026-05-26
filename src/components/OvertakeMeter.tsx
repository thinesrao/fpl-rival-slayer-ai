"use client";

import type { OvertakeOdds } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FutCardCompact } from "@/components/fut/FutCardCompact";
import { type Tier, tierGradientClass } from "@/lib/fut/tier";
import { cn } from "@/lib/utils";

/** Rival threat-tier: harder to overtake = higher tier. */
function rivalTier(overtakePct: number): Tier {
  if (overtakePct < 35) return "gold";
  if (overtakePct < 60) return "silver";
  return "bronze";
}

export function OvertakeMeter({ odds }: { odds: OvertakeOdds[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base uppercase tracking-tight">
          Overtake probability
        </CardTitle>
        <CardDescription>
          Monte-Carlo over 2000 sims · probability you close the GW gap on each rival.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {odds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rivals to compare against.</p>
        ) : (
          odds.map((o) => {
            const pct = Math.round(o.overtakeProbability * 100);
            const tier = rivalTier(pct);
            return (
              <div key={o.rivalEntryId} className="space-y-1.5">
                <FutCardCompact
                  tier={tier}
                  ovr={pct}
                  position="VS"
                  name={o.rivalName}
                  sub={`rank ${o.rivalRank} · +${o.pointsBehind} pts ahead`}
                  trailing={
                    <div className="text-right">
                      <div className="font-display text-base font-extrabold tabular-nums leading-none">
                        {pct}%
                      </div>
                      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                        overtake
                      </div>
                    </div>
                  }
                />
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full transition-all", tierGradientClass(tier))}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
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
