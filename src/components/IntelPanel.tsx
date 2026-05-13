"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowDownRight, ArrowUpRight, Crown, TrendingDown, TrendingUp } from "lucide-react";
import type { PlayerEo } from "@/lib/intel/effective-ownership";
import type { PriceMove } from "@/lib/intel/price-changes";

interface Props {
  eo: Record<number, PlayerEo>;
  priceMoves: { rising: PriceMove[]; falling: PriceMove[] };
}

const CONFIDENCE_TONE: Record<PriceMove["confidence"], "destructive" | "warning" | "outline"> = {
  high: "destructive",
  medium: "warning",
  low: "outline",
};

export function IntelPanel({ eo, priceMoves }: Props) {
  const eoList = Object.values(eo);
  const threats = eoList
    .filter((p) => !p.ownedByUser && p.captainEoPct > 0)
    .sort((a, b) => b.captainEoPct - a.captainEoPct)
    .slice(0, 5);
  const differentials = eoList
    .filter((p) => p.ownedByUser && p.ownedByRivalCount === 0)
    .sort((a, b) => b.userMultiplier - a.userMultiplier)
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Crown className="h-4 w-4 text-warning" /> Rival captain threats
            </CardTitle>
            <CardDescription>
              Players rivals own/captain that you don&apos;t — if they haul, you lose ground.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {threats.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every rival threat is already in your squad. Pure captain duel this week.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {threats.map((p) => (
                  <li key={p.playerId} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                    <div className="flex flex-col">
                      <span>{p.webName}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.ownedByRivalCount}/{p.rivalMultipliers.length} rivals own
                      </span>
                    </div>
                    <Badge variant="destructive">cEO {p.captainEoPct.toFixed(0)}%</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowUpRight className="h-4 w-4 text-success" /> Your true differentials
            </CardTitle>
            <CardDescription>
              No rival owns them — every point they score is a point you gain on rivals.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {differentials.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No unique players — every starter overlaps with at least one rival.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {differentials.map((p) => (
                  <li key={p.playerId} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                    <div className="flex flex-col">
                      <span>{p.webName}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.userMultiplier === 2 ? "your captain" : p.userMultiplier === 3 ? "triple-captain" : p.userMultiplier === 1 ? "starting" : "bench"}
                        · global {p.globalPct.toFixed(1)}%
                      </span>
                    </div>
                    <Badge variant="success">unique</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-success" /> Likely to rise tonight
            </CardTitle>
            <CardDescription>
              Net transfers in suggest a £0.1m price rise on the next FPL price-change run.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {priceMoves.rising.length === 0 ? (
              <p className="text-sm text-muted-foreground">No high-confidence rises projected.</p>
            ) : (
              <ul className="space-y-1.5">
                {priceMoves.rising.slice(0, 8).map((m) => (
                  <li key={m.playerId} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                    <div className="flex flex-col">
                      <span>{m.webName}</span>
                      <span className="text-xs text-muted-foreground">
                        +{m.netTransfers.toLocaleString()} net ({m.pctOfPool.toFixed(2)}% of pool)
                      </span>
                    </div>
                    <Badge variant={CONFIDENCE_TONE[m.confidence]}>{m.confidence}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="h-4 w-4 text-destructive" /> Likely to drop tonight
            </CardTitle>
            <CardDescription>
              Bleeding owners — risk of losing £0.1m of team value if you hold past tonight.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {priceMoves.falling.length === 0 ? (
              <p className="text-sm text-muted-foreground">No high-confidence drops projected.</p>
            ) : (
              <ul className="space-y-1.5">
                {priceMoves.falling.slice(0, 8).map((m) => (
                  <li key={m.playerId} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                    <div className="flex flex-col">
                      <span>{m.webName}</span>
                      <span className="text-xs text-muted-foreground">
                        {m.netTransfers.toLocaleString()} net ({m.pctOfPool.toFixed(2)}% of pool)
                      </span>
                    </div>
                    <Badge variant={CONFIDENCE_TONE[m.confidence]}>{m.confidence}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowDownRight className="h-4 w-4 text-muted-foreground" /> How EO is computed
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          <p>
            EO% = managers owning a player ÷ (you + your rivals). captainEO% adds the
            captain multiplier (×2) or triple-captain (×3). Anyone with a captainEO above
            100% is a likely rival captain — losing them in a haul costs you ground in the
            league even if you also captain well.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
