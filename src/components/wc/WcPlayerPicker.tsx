"use client";

// Player picker for the WC26 squad builder: position tabs, search, sort,
// group filter. Rows that would break a rule (budget / nation cap / position
// full) render disabled with the violated constraint inline.

import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, Search, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { flagEmoji } from "@/lib/wc/flags";
import type { WcPosition } from "@/lib/wc/fifa/types";
import type { WcPickerPlayer } from "./useWcData";

type SortKey = "price" | "ownership" | "points";

export interface WcPlayerPickerProps {
  players: WcPickerPlayer[];
  pickedIds: Set<number>;
  /** Returns null if the player can be added, else the violated-rule label. */
  blockedReason: (p: WcPickerPlayer) => string | null;
  onPick: (p: WcPickerPlayer) => void;
  /** Pre-select a position tab (e.g. the slot the user tapped). */
  initialPosition?: WcPosition;
}

const POSITIONS: WcPosition[] = ["GK", "DEF", "MID", "FWD"];

export function WcPlayerPicker({
  players,
  pickedIds,
  blockedReason,
  onPick,
  initialPosition,
}: WcPlayerPickerProps) {
  const [position, setPosition] = useState<WcPosition>(initialPosition ?? "FWD");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("price");
  const [group, setGroup] = useState<string>("");

  const groups = useMemo(
    () => [...new Set(players.map((p) => p.group))].sort(),
    [players],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players
      .filter((p) => p.position === position)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.teamName.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .filter((p) => !group || p.group === group)
      .sort((a, b) => {
        if (sort === "ownership") return b.percentSelected - a.percentSelected;
        if (sort === "points") return b.totalPoints - a.totalPoints || b.form - a.form;
        return b.price - a.price;
      })
      .slice(0, 120);
  }, [players, position, search, sort, group]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex gap-1">
        {POSITIONS.map((pos) => (
          <button
            key={pos}
            type="button"
            onClick={() => setPosition(pos)}
            className={cn(
              "flex-1 rounded-md border px-2 py-1.5 font-mono text-xs font-bold uppercase tracking-wider transition-colors",
              position === pos
                ? "border-fut-gold/60 bg-fut-gold/15 text-fut-gold"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {pos}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player or nation…"
            className="w-full rounded-md border bg-card py-1.5 pl-7 pr-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          />
        </div>
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          className="rounded-md border bg-card px-2 py-1.5 text-xs outline-none"
          aria-label="Filter by group"
        >
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              Group {g}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() =>
            setSort((s) => (s === "price" ? "ownership" : s === "ownership" ? "points" : "price"))
          }
          className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          title="Cycle sort"
        >
          <ArrowDownWideNarrow className="h-3.5 w-3.5" />
          {sort === "price" ? "$" : sort === "ownership" ? "own%" : "pts"}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {rows.map((p) => {
          const picked = pickedIds.has(p.id);
          const blocked = picked ? "In squad" : blockedReason(p);
          const disabled = picked || blocked != null;
          return (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => onPick(p)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border bg-card px-2 py-1.5 text-left transition-colors",
                disabled ? "opacity-45" : "hover:border-fut-gold/40 hover:bg-card/70",
              )}
            >
              <span className="text-lg leading-none">{flagEmoji(p.team)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{p.name}</span>
                  {p.oneToWatch && <Star className="h-3 w-3 shrink-0 fill-fut-gold text-fut-gold" />}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {p.team} · Grp {p.group} · {p.nextOpponent ?? "—"}
                  {blocked && !picked && <span className="ml-1 text-red-400">· {blocked}</span>}
                  {picked && <span className="ml-1 text-emerald-400">· in squad</span>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-sm font-bold tabular-nums">${p.price.toFixed(1)}</div>
                <Badge variant="outline" className="px-1 py-0 font-mono text-[9px]">
                  {sort === "points" ? `${p.totalPoints} pts` : `${p.percentSelected.toFixed(1)}%`}
                </Badge>
              </div>
            </button>
          );
        })}
        {rows.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">No players match.</div>
        )}
      </div>
    </div>
  );
}
