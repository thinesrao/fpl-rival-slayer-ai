"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, LayoutGrid, List, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayerPhoto } from "@/components/PlayerPhoto";
import { SuggestedSquadPitch } from "@/components/SuggestedSquadPitch";
import { validateDraft } from "@/lib/drafts/validate";
import { pickStartingXI, safeFormation, type Formation } from "@/lib/drafts/formation";
import type { PickerPlayer, Position, SquadDraft } from "@/lib/drafts/types";
import { cn } from "@/lib/utils";

interface Props {
  drafts: SquadDraft[];
  initialLeftId?: string;
  initialRightId?: string;
  onClose: () => void;
}

interface Stats {
  cost: number;
  points: number;
  form: number;
  ownership: number;
  filled: number;
  byClub: Map<string, number>;
}

function statsFor(draft: SquadDraft, byId: Map<number, PickerPlayer>): Stats {
  let cost = 0, points = 0, form = 0, ownership = 0, filled = 0;
  const byClub = new Map<string, number>();
  for (const id of draft.picks) {
    if (id == null) continue;
    const p = byId.get(id);
    if (!p) continue;
    cost += p.price;
    points += p.totalPoints;
    form += p.form;
    ownership += p.selectedByPct;
    filled++;
    byClub.set(p.team, (byClub.get(p.team) ?? 0) + 1);
  }
  return { cost, points, form, ownership, filled, byClub };
}

function DeltaPill({ delta, suffix = "", invert = false }: { delta: number; suffix?: string; invert?: boolean }) {
  if (delta === 0) {
    return <span className="font-mono text-[10px] text-muted-foreground">±0{suffix}</span>;
  }
  const positive = invert ? delta < 0 : delta > 0;
  return (
    <span
      className={cn(
        "font-mono text-[10px]",
        positive ? "text-emerald-400" : "text-rose-400",
      )}
    >
      {delta > 0 ? "+" : ""}
      {delta.toFixed(suffix === "%" || suffix === "" ? 1 : 1)}
      {suffix}
    </span>
  );
}

const POS_TO_ELEMENT: Record<Position, 1 | 2 | 3 | 4> = {
  GKP: 1,
  DEF: 2,
  MID: 3,
  FWD: 4,
};

/** Build the SuggestedSquadPitch payload from a draft + the player pool.
 *  Same adapter shape used in DraftEditor, kept inline to avoid a shared
 *  util when the body is this small. */
function toPitchPayload(draft: SquadDraft, byId: Map<number, PickerPlayer>) {
  const formation: Formation = safeFormation(draft, byId, draft.formation as Formation | undefined);
  const xi = new Set(byId.size ? pickStartingXI(draft, byId, formation) : []);

  const toResolved = (id: number) => {
    const p = byId.get(id);
    if (!p) return null;
    return {
      webName: p.webName,
      playerId: p.id,
      teamShort: p.team,
      teamCode: p.teamCode,
      elementType: POS_TO_ELEMENT[p.position],
      position: p.position,
      cost: Math.round(p.price * 10),
      xPoints: p.form,
      opponent: p.nextOpponent ?? null,
      isCaptain: draft.captainId === id,
      isVice: draft.viceId === id,
      isIn: false,
    };
  };

  const all = draft.picks
    .filter((id): id is number => id != null)
    .map(toResolved)
    .filter((p): p is NonNullable<ReturnType<typeof toResolved>> => p != null);

  const startingXi = all.filter((p) => xi.has(p.playerId));
  const bench = all
    .filter((p) => !xi.has(p.playerId))
    .sort((a, b) => a.elementType - b.elementType);

  const totalCost = all.reduce((s, p) => s + p.cost, 0);
  const liveBankTenths = Math.max(0, draft.budget - totalCost);

  return {
    suggested: {
      startingXi,
      bench,
      totalXp: 0,
      bank: liveBankTenths,
      freeTransfers: 0,
      formation,
    },
    cost: totalCost,
  };
}

type ViewMode = "pitch" | "list";

export function CompareDrafts({ drafts, initialLeftId, initialRightId, onClose }: Props) {
  const [leftId, setLeftId] = useState(initialLeftId ?? drafts[0]?.id ?? "");
  const [rightId, setRightId] = useState(initialRightId ?? drafts[1]?.id ?? drafts[0]?.id ?? "");
  const [view, setView] = useState<ViewMode>("pitch");

  const playersQ = useQuery({
    queryKey: ["players"],
    queryFn: async () => {
      const res = await fetch("/api/players");
      if (!res.ok) throw new Error(`players ${res.status}`);
      return (await res.json()) as { players: PickerPlayer[] };
    },
    staleTime: 10 * 60 * 1000,
  });
  const byId = useMemo(() => {
    const m = new Map<number, PickerPlayer>();
    playersQ.data?.players.forEach((p) => m.set(p.id, p));
    return m;
  }, [playersQ.data]);

  const left = drafts.find((d) => d.id === leftId);
  const right = drafts.find((d) => d.id === rightId);

  const leftStats = left ? statsFor(left, byId) : null;
  const rightStats = right ? statsFor(right, byId) : null;
  const leftValid = left ? validateDraft(left, byId) : null;
  const rightValid = right ? validateDraft(right, byId) : null;

  const leftIds = new Set(left?.picks.filter((id): id is number => id != null) ?? []);
  const rightIds = new Set(right?.picks.filter((id): id is number => id != null) ?? []);
  const onlyLeft = [...leftIds].filter((id) => !rightIds.has(id));
  const onlyRight = [...rightIds].filter((id) => !leftIds.has(id));
  const shared = [...leftIds].filter((id) => rightIds.has(id));

  const leftPitch = left && byId.size ? toPitchPayload(left, byId) : null;
  const rightPitch = right && byId.size ? toPitchPayload(right, byId) : null;

  const columns = [
    {
      side: "L" as const,
      draft: left,
      stats: leftStats,
      valid: leftValid,
      value: leftId,
      setValue: setLeftId,
      onlyHere: onlyLeft,
      pitch: leftPitch,
    },
    {
      side: "R" as const,
      draft: right,
      stats: rightStats,
      valid: rightValid,
      value: rightId,
      setValue: setRightId,
      onlyHere: onlyRight,
      pitch: rightPitch,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[55] flex items-stretch justify-center bg-background/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden bg-background shadow-2xl md:my-4 md:h-auto md:max-h-[95vh] md:rounded-2xl md:border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">Compare drafts</h2>
          </div>
          <div className="flex items-center gap-2">
            {/* Pitch / List toggle */}
            <div className="inline-flex rounded-md border bg-card p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setView("pitch")}
                className={cn(
                  "flex items-center gap-1 rounded-sm px-2 py-1 transition-colors",
                  view === "pitch" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <LayoutGrid className="h-3 w-3" /> Pitch
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                className={cn(
                  "flex items-center gap-1 rounded-sm px-2 py-1 transition-colors",
                  view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <List className="h-3 w-3" /> List
              </button>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="h-8 px-2">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-1 overflow-y-auto md:grid-cols-2">
          {columns.map((col) => (
            <div
              key={col.side}
              className={cn(
                "flex flex-col gap-2 p-3",
                col.side === "L" ? "border-b md:border-b-0 md:border-r" : "",
              )}
            >
              <select
                value={col.value}
                onChange={(e) => col.setValue(e.target.value)}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {drafts.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>

              {col.draft && col.stats && col.valid ? (
                <>
                  {/* Stat strip — visible in both views */}
                  <div className="grid grid-cols-4 gap-1 text-center text-[10px]">
                    {[
                      { label: "Cost", value: `£${col.stats.cost.toFixed(1)}m`, ok: col.valid.inBudget },
                      { label: "Pts so far", value: col.stats.points.toString() },
                      { label: "Form sum", value: col.stats.form.toFixed(1) },
                      { label: "Avg EO", value: `${(col.stats.ownership / Math.max(1, col.stats.filled)).toFixed(1)}%` },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className={cn(
                          "rounded-md border bg-card px-1 py-1.5",
                          s.ok === false && "border-rose-500/50 bg-rose-500/10",
                        )}
                      >
                        <div className="font-mono text-xs font-semibold">{s.value}</div>
                        <div className="uppercase tracking-widest text-muted-foreground">{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {view === "pitch" && col.pitch ? (
                    <SuggestedSquadPitch
                      suggested={col.pitch.suggested}
                      hideHeader
                      bottomMode="price"
                    />
                  ) : (
                    /* List view — players unique to this side */
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
                        Only here ({col.onlyHere.length})
                      </div>
                      {col.onlyHere.length === 0 ? (
                        <div className="text-[11px] text-muted-foreground">— identical to the other side</div>
                      ) : (
                        <ul className="space-y-1">
                          {col.onlyHere.map((id) => {
                            const p = byId.get(id);
                            if (!p) return null;
                            return (
                              <li key={id} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-[11px]">
                                <PlayerPhoto code={p.code} name={p.webName} size="sm" />
                                <span className="flex-1 truncate font-medium">{p.webName}</span>
                                <Badge variant="outline" className="px-1 py-0 text-[9px] leading-none">{p.team}</Badge>
                                <span className="font-mono text-muted-foreground">£{p.price.toFixed(1)}</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-muted-foreground">Pick a draft.</div>
              )}
            </div>
          ))}
        </div>

        {/* Delta strip — always visible */}
        {leftStats && rightStats && (
          <div className="border-t bg-card/60 px-4 py-2 text-[11px]">
            <div className="mb-1 font-semibold text-muted-foreground">Right vs Left</div>
            <div className="flex flex-wrap gap-3">
              <span>
                Cost <DeltaPill delta={rightStats.cost - leftStats.cost} suffix="m" invert />
              </span>
              <span>
                Pts so far <DeltaPill delta={rightStats.points - leftStats.points} />
              </span>
              <span>
                Form sum <DeltaPill delta={rightStats.form - leftStats.form} />
              </span>
              <span>
                Avg EO <DeltaPill
                  delta={
                    rightStats.ownership / Math.max(1, rightStats.filled)
                    - leftStats.ownership / Math.max(1, leftStats.filled)
                  }
                  suffix="%"
                />
              </span>
              <span className="text-muted-foreground">
                Shared players: {shared.length}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
