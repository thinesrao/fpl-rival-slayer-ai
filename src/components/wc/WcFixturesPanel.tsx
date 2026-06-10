"use client";

// Fixtures & groups: match schedule grouped by day with live status, plus the
// 12 group tables. Pure read of /api/wc/fixtures.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, MapPin, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { flagEmoji } from "@/lib/wc/flags";

interface FixturesResponse {
  matches: Array<{
    id: number;
    roundId: number;
    stage: string;
    date: string;
    venueName: string | null;
    venueCity: string | null;
    status: string;
    period: string;
    minutes: number;
    home: { name: string | null; abbr: string | null; score: number | null; penScore: number | null };
    away: { name: string | null; abbr: string | null; score: number | null; penScore: number | null };
  }>;
  groups: Record<
    string,
    Array<{ name: string; abbr: string; played: number; won: number; drawn: number; lost: number; gd: number; points: number }>
  >;
  activeRoundId: number | null;
  targetRoundId: number;
}

const STAGE_LABELS: Record<string, string> = {
  GROUP: "Group stage",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-finals",
  SF: "Semi-finals",
  F: "Final",
};

export function WcFixturesPanel() {
  const [view, setView] = useState<"schedule" | "groups">("schedule");
  const { data, isLoading, error } = useQuery<FixturesResponse>({
    queryKey: ["wc-fixtures"],
    queryFn: async () => {
      const res = await fetch("/api/wc/fixtures");
      if (!res.ok) throw new Error("Failed to load fixtures");
      return res.json();
    },
    staleTime: 120_000,
  });

  const byDay = useMemo(() => {
    if (!data) return new Map<string, FixturesResponse["matches"]>();
    const map = new Map<string, FixturesResponse["matches"]>();
    const sorted = [...data.matches].sort((a, b) => a.date.localeCompare(b.date));
    for (const m of sorted) {
      const day = new Date(m.date).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(m);
    }
    return map;
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return <div className="py-8 text-center text-sm text-red-400">Couldn&apos;t load fixtures.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {(
          [
            ["schedule", "Schedule", CalendarDays],
            ["groups", "Groups", Table2],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider",
              view === id
                ? "border-fut-gold/60 bg-fut-gold/15 text-fut-gold"
                : "border-border text-muted-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {view === "schedule" && (
        <div className="space-y-4">
          {[...byDay.entries()].map(([day, matches]) => (
            <div key={day}>
              <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {day}
                <Badge variant="outline" className="px-1 py-0 text-[9px]">
                  {STAGE_LABELS[matches[0].stage] ?? matches[0].stage}
                </Badge>
              </div>
              <div className="space-y-1">
                {matches.map((m) => {
                  const live = m.status === "active" || (m.period !== "pre_match" && m.status !== "complete");
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border bg-card px-3 py-2",
                        live && "border-emerald-500/50",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-right">
                        <span className="truncate text-sm font-semibold">{m.home.name ?? "TBD"}</span>
                        <span>{m.home.abbr ? flagEmoji(m.home.abbr) : "❓"}</span>
                      </div>
                      <div className="shrink-0 px-1 text-center">
                        {m.home.score != null && m.away.score != null ? (
                          <div className="font-mono text-sm font-bold tabular-nums">
                            {m.home.score}–{m.away.score}
                            {m.home.penScore != null && (
                              <span className="text-[10px] text-muted-foreground"> ({m.home.penScore}–{m.away.penScore}p)</span>
                            )}
                          </div>
                        ) : (
                          <div className="font-mono text-xs text-muted-foreground">
                            {new Date(m.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        )}
                        {live && (
                          <div className="font-mono text-[9px] font-bold uppercase text-emerald-400">
                            {m.period.replace("_", " ")} {m.minutes > 0 ? `${m.minutes}'` : ""}
                          </div>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span>{m.away.abbr ? flagEmoji(m.away.abbr) : "❓"}</span>
                        <span className="truncate text-sm font-semibold">{m.away.name ?? "TBD"}</span>
                      </div>
                      {m.venueCity && (
                        <span className="hidden shrink-0 items-center gap-0.5 font-mono text-[9px] uppercase text-muted-foreground sm:inline-flex">
                          <MapPin className="h-2.5 w-2.5" />
                          {m.venueCity}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === "groups" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(data.groups).map(([label, rows]) => (
            <div key={label} className="rounded-lg border bg-card p-3">
              <div className="mb-2 font-display text-sm font-bold">Group {label}</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left font-mono text-[9px] uppercase text-muted-foreground">
                    <th className="pb-1">Team</th>
                    <th className="pb-1 text-center">P</th>
                    <th className="pb-1 text-center">GD</th>
                    <th className="pb-1 text-right">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.abbr} className={cn(i < 2 && "text-foreground", i >= 2 && "text-muted-foreground")}>
                      <td className="py-0.5">
                        <span className="mr-1">{flagEmoji(r.abbr)}</span>
                        {r.name}
                      </td>
                      <td className="text-center font-mono tabular-nums">{r.played}</td>
                      <td className="text-center font-mono tabular-nums">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                      <td className="text-right font-mono font-bold tabular-nums">{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
