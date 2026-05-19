"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayerPhoto } from "@/components/PlayerPhoto";
import { cn } from "@/lib/utils";
import type { PickerPlayer, Position } from "@/lib/drafts/types";

interface Props {
  open: boolean;
  position: Position | null;
  /** Player IDs already drafted — disabled in the list. */
  excludeIds: number[];
  /** Remaining budget in £m. Picks costing more are visually flagged. */
  remainingBudget: number;
  onPick: (player: PickerPlayer) => void;
  onClose: () => void;
}

export function PlayerPicker({ open, position, excludeIds, remainingBudget, onPick, onClose }: Props) {
  const q = useQuery({
    queryKey: ["players"],
    queryFn: async () => {
      const res = await fetch("/api/players");
      if (!res.ok) throw new Error(`players ${res.status}`);
      return (await res.json()) as { players: PickerPlayer[] };
    },
    staleTime: 10 * 60 * 1000,
  });
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState<string>("");
  const [sort, setSort] = useState<"form" | "price" | "totalPoints" | "selectedByPct">("totalPoints");

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);

  const players = useMemo(() => {
    if (!q.data) return [];
    let rows = q.data.players;
    if (position) rows = rows.filter((p) => p.position === position);
    if (teamFilter) rows = rows.filter((p) => p.team === teamFilter);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((p) => p.webName.toLowerCase().includes(s));
    }
    rows = [...rows].sort((a, b) => {
      if (sort === "form") return b.form - a.form;
      if (sort === "price") return b.price - a.price;
      if (sort === "selectedByPct") return b.selectedByPct - a.selectedByPct;
      return b.totalPoints - a.totalPoints;
    });
    return rows;
  }, [q.data, position, teamFilter, search, sort]);

  const teamOptions = useMemo(() => {
    if (!q.data) return [];
    const teams = new Set(q.data.players.map((p) => p.team));
    return [...teams].sort();
  }, [q.data]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-background/80 backdrop-blur-sm md:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border bg-card shadow-2xl md:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">
              Pick {position ?? "player"}
            </h2>
            <p className="text-xs text-muted-foreground">
              £{remainingBudget.toFixed(1)}m remaining in budget.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="h-8 px-2">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2 border-b px-4 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="w-full rounded-md border bg-background py-1.5 pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">All teams</option>
              {teamOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="rounded-md border bg-background px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="totalPoints">Total points</option>
              <option value="form">Form</option>
              <option value="price">Price</option>
              <option value="selectedByPct">Ownership %</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {q.isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading player pool…</div>
          ) : q.error ? (
            <div className="p-6 text-center text-sm text-rose-400">Couldn&apos;t load player list.</div>
          ) : players.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No players match those filters.</div>
          ) : (
            <ul className="divide-y">
              {players.map((p) => {
                const taken = excludeSet.has(p.id);
                const overBudget = p.price > remainingBudget;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={taken}
                      onClick={() => onPick(p)}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors",
                        taken && "cursor-not-allowed opacity-40",
                        !taken && "hover:bg-muted/40",
                        overBudget && !taken && "bg-rose-500/5",
                      )}
                    >
                      <PlayerPhoto
                        code={p.code}
                        name={p.webName}
                        size="sm"
                        chanceOfPlaying={p.status === "a" ? 100 : p.status === "d" ? 50 : 0}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{p.webName}</span>
                          <Badge variant="outline" className="px-1 py-0 text-[9px] leading-none">{p.team}</Badge>
                          {taken && <Badge variant="secondary" className="px-1 py-0 text-[9px] leading-none">in squad</Badge>}
                        </div>
                        <div className="flex gap-3 text-[11px] text-muted-foreground">
                          <span className="font-mono">£{p.price.toFixed(1)}m</span>
                          <span>form {p.form.toFixed(1)}</span>
                          <span>{p.totalPoints} pts</span>
                          <span>{p.selectedByPct.toFixed(1)}% EO</span>
                        </div>
                      </div>
                      <span className={cn("font-mono text-xs font-semibold", overBudget ? "text-rose-400" : "text-emerald-400")}>
                        {overBudget ? "over" : "ok"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
