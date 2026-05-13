"use client";

import { useState } from "react";
import type { ManagerSquad, PlayerProjection, Position, SquadProjection, SquadSlot } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const POSITIONS: Position[] = ["GKP", "DEF", "MID", "FWD"];

interface Props {
  user: ManagerSquad;
  userProjection: SquadProjection;
  rivals: ManagerSquad[];
  rivalProjections: SquadProjection[];
}

function projByPlayer(proj: SquadProjection) {
  return new Map(proj.perPlayer.map((p) => [p.playerId, p]));
}

function bySlotOrder(a: SquadSlot, b: SquadSlot) {
  return a.pick.position - b.pick.position;
}

/** Per-position pairing: lay out shared players first (aligned rows), then
 *  user-only differentials, then rival-only differentials. This keeps the
 *  side-by-side mental model intact while making differentials obvious. */
function pairByPosition(userSlots: SquadSlot[], rivalSlots: SquadSlot[]) {
  const rivalById = new Map(rivalSlots.map((s) => [s.player.id, s]));
  const userById = new Map(userSlots.map((s) => [s.player.id, s]));

  const shared: Array<{ user: SquadSlot; rival: SquadSlot }> = [];
  const userOnly: SquadSlot[] = [];
  const rivalOnly: SquadSlot[] = [];

  for (const u of userSlots) {
    const match = rivalById.get(u.player.id);
    if (match) shared.push({ user: u, rival: match });
    else userOnly.push(u);
  }
  for (const r of rivalSlots) {
    if (!userById.has(r.player.id)) rivalOnly.push(r);
  }

  const rows: Array<{ user?: SquadSlot; rival?: SquadSlot; shared: boolean }> = [
    ...shared.map((p) => ({ user: p.user, rival: p.rival, shared: true })),
  ];
  const diffCount = Math.max(userOnly.length, rivalOnly.length);
  for (let i = 0; i < diffCount; i++) {
    rows.push({ user: userOnly[i], rival: rivalOnly[i], shared: false });
  }
  return rows;
}

function PlayerSide({
  slot,
  proj,
  highlight,
}: {
  slot: SquadSlot | undefined;
  proj: PlayerProjection | undefined;
  highlight: "advantage" | "threat" | "shared" | "none";
}) {
  if (!slot) {
    return <div className="min-h-[52px] p-2 text-xs text-muted-foreground/40">—</div>;
  }
  const benched = slot.pick.multiplier === 0;
  const bg = {
    advantage: "bg-success/10",
    threat: "bg-destructive/10",
    shared: "",
    none: "",
  }[highlight];
  return (
    <div className={cn("flex min-h-[52px] flex-col gap-0.5 p-2", benched && "opacity-60", bg)}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="truncate text-sm font-medium leading-tight">{slot.player.web_name}</span>
        {slot.pick.is_captain && (
          <Badge variant="success" className="px-1 py-0 text-[10px] leading-none">C</Badge>
        )}
        {slot.pick.is_vice_captain && (
          <Badge variant="secondary" className="px-1 py-0 text-[10px] leading-none">V</Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>{slot.team.short_name}</span>
        {proj && <span className="font-mono">xP {proj.xPoints.toFixed(1)}</span>}
        {benched && <span className="text-[10px] uppercase">bench</span>}
        {proj && proj.injuryRisk >= 0.4 && (
          <Badge variant="destructive" className="px-1 py-0 text-[9px] leading-none">
            {Math.round(proj.injuryRisk * 100)}% inj
          </Badge>
        )}
      </div>
    </div>
  );
}

export function SquadCompareTable({ user, userProjection, rivals, rivalProjections }: Props) {
  const [idx, setIdx] = useState(0);
  if (rivals.length === 0 || rivalProjections.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        No rivals to compare against.
      </div>
    );
  }
  const safeIdx = Math.min(idx, rivals.length - 1);
  const rival = rivals[safeIdx];
  const rivalProj = rivalProjections[safeIdx];

  const userMap = projByPlayer(userProjection);
  const rivalMap = projByPlayer(rivalProj);

  const xPDelta = userProjection.startingXIPoints - rivalProj.startingXIPoints;
  const pointsBehind = Math.max(0, rival.entry.total - user.entry.total);

  return (
    <div className="space-y-3">
      {/* Rival selector */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {rivals.map((r, i) => {
          const behind = Math.max(0, r.entry.total - user.entry.total);
          const selected = i === safeIdx;
          return (
            <button
              key={r.entry.id}
              type="button"
              onClick={() => setIdx(i)}
              className={cn(
                "flex shrink-0 flex-col items-start rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                selected ? "border-primary bg-primary/15" : "bg-card hover:bg-accent",
              )}
            >
              <span className={cn("font-semibold", selected && "text-primary")}>vs {r.entry.name}</span>
              <span className="text-muted-foreground">
                rank {r.entry.rank} · {behind > 0 ? `+${behind} pts ahead` : `${-behind} pts behind`}
              </span>
            </button>
          );
        })}
      </div>

      {/* Twin header — always visible, drives the 2-column grid below. */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">You</div>
          <div className="truncate text-sm font-semibold">{user.entry.name}</div>
          <div className="text-[11px] text-muted-foreground">
            rank {user.entry.rank} · {user.entry.total} pts
          </div>
          <div className="mt-1 text-sm">
            Projected XI: <span className="font-mono font-semibold">{userProjection.startingXIPoints.toFixed(1)}</span>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Rival #{safeIdx + 1}</span>
            {pointsBehind > 0 && (
              <Badge variant="outline" className="px-1.5 py-0 text-[9px] leading-none">
                +{pointsBehind} pts
              </Badge>
            )}
          </div>
          <div className="truncate text-sm font-semibold">{rival.entry.name}</div>
          <div className="text-[11px] text-muted-foreground">
            rank {rival.entry.rank} · {rival.entry.total} pts
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
            <span>
              Projected XI: <span className="font-mono font-semibold">{rivalProj.startingXIPoints.toFixed(1)}</span>
            </span>
            <Badge variant={xPDelta >= 0 ? "success" : "destructive"} className="px-1.5 py-0 text-[10px] leading-none">
              {xPDelta >= 0 ? "+" : ""}
              {xPDelta.toFixed(1)} xP
            </Badge>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-success/40" /> your differential
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-destructive/40" /> their threat
        </span>
      </div>

      {/* Per-position pair table */}
      <div className="space-y-2">
        {POSITIONS.map((pos) => {
          const userSlots = user.picks.filter((s) => s.position === pos).sort(bySlotOrder);
          const rivalSlots = rival.picks.filter((s) => s.position === pos).sort(bySlotOrder);
          const rows = pairByPosition(userSlots, rivalSlots);
          if (rows.length === 0) return null;
          return (
            <div key={pos} className="overflow-hidden rounded-lg border bg-card">
              <div className="bg-muted/50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {pos}
              </div>
              <div className="grid grid-cols-2 divide-x">
                <div className="divide-y">
                  {rows.map((row, i) => (
                    <PlayerSide
                      key={i}
                      slot={row.user}
                      proj={row.user && userMap.get(row.user.player.id)}
                      highlight={row.shared ? "shared" : row.user ? "advantage" : "none"}
                    />
                  ))}
                </div>
                <div className="divide-y">
                  {rows.map((row, i) => (
                    <PlayerSide
                      key={i}
                      slot={row.rival}
                      proj={row.rival && rivalMap.get(row.rival.player.id)}
                      highlight={row.shared ? "shared" : row.rival ? "threat" : "none"}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
