"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

interface Props {
  userOnly: Array<{ name: string; xPts: number }>;
  rivalOnly: Array<{ name: string; rival: string; xPts: number }>;
}

export function DifferentialsCard({ userOnly, rivalOnly }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowUpRight className="h-4 w-4 text-success" /> Your differentials
          </CardTitle>
          <CardDescription>Players only you own among the compared rivals.</CardDescription>
        </CardHeader>
        <CardContent>
          {userOnly.length === 0 ? (
            <p className="text-sm text-muted-foreground">No unique players — every starter overlaps with a rival.</p>
          ) : (
            <ul className="space-y-1.5">
              {userOnly.map((d) => (
                <li key={d.name} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                  <span>{d.name}</span>
                  <Badge variant="success">xP {d.xPts.toFixed(1)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowDownRight className="h-4 w-4 text-destructive" /> Rivals own, you don&apos;t
          </CardTitle>
          <CardDescription>Threats — these are points the rivals can score that you can&apos;t mirror.</CardDescription>
        </CardHeader>
        <CardContent>
          {rivalOnly.length === 0 ? (
            <p className="text-sm text-muted-foreground">You match every rival player — pure captain duel this week.</p>
          ) : (
            <ul className="space-y-1.5">
              {rivalOnly.map((d) => (
                <li key={d.name} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                  <div className="flex flex-col">
                    <span>{d.name}</span>
                    <span className="text-xs text-muted-foreground">via {d.rival}</span>
                  </div>
                  <Badge variant="destructive">xP {d.xPts.toFixed(1)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
