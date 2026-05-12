"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ManagerSquad, SquadProjection } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  user: ManagerSquad;
  userProjection: SquadProjection;
  rivals: ManagerSquad[];
  rivalProjections: SquadProjection[];
}

export function ProjectionsChart({ user, userProjection, rivals, rivalProjections }: Props) {
  const data = [
    { name: "You", points: userProjection.startingXIPoints, isUser: true },
    ...rivals.map((r, i) => ({
      name: r.entry.name.slice(0, 14),
      points: rivalProjections[i]?.startingXIPoints ?? 0,
      isUser: false,
    })),
  ];

  void user;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Projected GW points</CardTitle>
        <CardDescription>
          Starting-XI expected points using FPL form, fixture difficulty, xG/xA and injury status.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                cursor={{ fill: "hsl(var(--accent) / 0.3)" }}
                formatter={(v: number) => [`${v.toFixed(1)} pts`, "xP"]}
              />
              <Bar dataKey="points" radius={[6, 6, 0, 0]} fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
