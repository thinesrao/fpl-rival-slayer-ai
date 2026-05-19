"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus, Share2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayerPhoto } from "@/components/PlayerPhoto";
import { PlayerPicker } from "@/components/PlayerPicker";
import { MagneticCaptainBadge } from "@/components/MagneticCaptainBadge";
import { SLOT_LABELS, SLOTS, type PickerPlayer, type Position, type SquadDraft } from "@/lib/drafts/types";
import { validateDraft } from "@/lib/drafts/validate";
import { upsertDraft } from "@/lib/drafts/storage";
import { encodeDraft } from "@/lib/drafts/encode";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  teamId: number;
  initial: SquadDraft;
  onClose: () => void;
  onSaved: (d: SquadDraft) => void;
}

export function DraftEditor({ teamId, initial, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<SquadDraft>(initial);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ id: number | null; label: string }>({ id: null, label: "" });

  // DOM anchors keyed by player id — populated by the slot tiles.
  const anchorRefs = useRef<Map<number, HTMLElement>>(new Map());
  const getAnchors = () =>
    [...anchorRefs.current.entries()].map(([id, el]) => ({ id, el }));

  // Listen for the magnetic-hover broadcast so we can highlight the
  // currently-hovered slot tile (only one badge can broadcast at a time).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => setHoverInfo((e as CustomEvent).detail);
    window.addEventListener("magnetic-hover", handler);
    return () => window.removeEventListener("magnetic-hover", handler);
  }, []);

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

  const validation = useMemo(() => validateDraft(draft, byId), [draft, byId]);
  const remaining = draft.budget / 10 - validation.totalCost;

  const setPlayerAtSlot = (slot: number, playerId: number | null) => {
    setDraft((d) => {
      const picks = [...d.picks];
      picks[slot] = playerId;
      // If captain or vice was removed, clear them.
      const captainId = playerId === null && d.captainId === d.picks[slot] ? null : d.captainId;
      const viceId = playerId === null && d.viceId === d.picks[slot] ? null : d.viceId;
      return { ...d, picks, captainId, viceId };
    });
  };

  const save = () => {
    upsertDraft(teamId, draft);
    onSaved(draft);
  };

  const share = async () => {
    const url = `${window.location.origin}/draft/${encodeDraft(draft)}`;
    const title = `${draft.name} — FPL draft`;
    if (navigator.share) {
      try {
        await navigator.share({ title, text: title, url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied — paste into your group chat.");
      window.open(url, "_blank", "noopener");
    } catch {
      window.open(url, "_blank", "noopener");
    }
  };

  const setCaptain = (playerId: number) => {
    setDraft((d) => ({
      ...d,
      captainId: playerId,
      viceId: d.viceId === playerId ? null : d.viceId,
    }));
  };
  const setVice = (playerId: number) => {
    setDraft((d) => ({
      ...d,
      viceId: playerId,
      captainId: d.captainId === playerId ? null : d.captainId,
    }));
  };

  // Group filled slots by position for visual layout.
  const slotsByPosition: Record<Position, number[]> = { GKP: [], DEF: [], MID: [], FWD: [] };
  SLOTS.forEach((p, i) => slotsByPosition[p].push(i));

  const excludeIds = draft.picks.filter((id): id is number => id != null);
  const pickerPosition = pickerSlot !== null ? SLOTS[pickerSlot] : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-background/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-background shadow-2xl md:my-4 md:h-auto md:max-h-[95vh] md:rounded-2xl md:border">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="flex-1 rounded-md border bg-background px-2 py-1 text-sm font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Draft name"
          />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Budget £
            <input
              type="number"
              step="0.1"
              min="50"
              max="120"
              value={(draft.budget / 10).toFixed(1)}
              onChange={(e) => setDraft((d) => ({ ...d, budget: Math.round(Number(e.target.value) * 10) }))}
              className="w-16 rounded-md border bg-background px-2 py-1 text-right text-xs font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            m
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="h-8 px-2">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Magnetic captain/vice dock — drag onto a player tile to assign. */}
        <div className="flex items-center justify-between gap-3 border-b bg-card/40 px-4 py-2 text-[11px] text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">Drag</span> the badges onto a player to assign{" "}
            <span className="text-amber-400">captain</span> /{" "}
            <span className="text-slate-200">vice</span>.
          </span>
          <div className="flex items-center gap-3">
            <MagneticCaptainBadge
              getAnchors={getAnchors}
              label="C"
              variant="captain"
              onAssign={(id) => setCaptain(id)}
            />
            <MagneticCaptainBadge
              getAnchors={getAnchors}
              label="V"
              variant="vice"
              onAssign={(id) => setVice(id)}
            />
          </div>
        </div>

        {/* Budget meter */}
        <div className="border-b bg-card/60 px-4 py-2 text-xs">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium">
              £{validation.totalCost.toFixed(1)}m used · £{remaining.toFixed(1)}m left
            </span>
            <span className={cn("font-mono", validation.filled === 15 ? "text-emerald-400" : "text-muted-foreground")}>
              {validation.filled} / 15 picks
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/5">
            <div
              className={cn(
                "h-full transition-all",
                !validation.inBudget ? "bg-rose-500" : validation.filled === 15 ? "bg-emerald-500" : "bg-primary",
              )}
              style={{ width: `${Math.min(100, (validation.totalCost / (draft.budget / 10)) * 100)}%` }}
            />
          </div>
        </div>

        {/* Squad slots */}
        <div className="flex-1 overflow-y-auto p-3">
          {(Object.keys(slotsByPosition) as Position[]).map((pos) => (
            <div key={pos} className="mb-3">
              <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                <span>{pos}</span>
                <span className="font-mono">{slotsByPosition[pos].filter((i) => draft.picks[i] != null).length}/{slotsByPosition[pos].length}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                {slotsByPosition[pos].map((slotIdx) => {
                  const id = draft.picks[slotIdx];
                  const p = id != null ? byId.get(id) : null;
                  const isCaptain = id != null && draft.captainId === id;
                  const isVice = id != null && draft.viceId === id;
                  const isHovered = hoverInfo.id === id && id != null;
                  return (
                    <div
                      key={slotIdx}
                      className={cn(
                        "relative flex flex-col items-center gap-1 rounded-lg border bg-card p-2 transition-all",
                        isCaptain && "ring-2 ring-amber-400",
                        isVice && !isCaptain && "ring-1 ring-slate-300",
                        isHovered && hoverInfo.label === "C" && "scale-105 ring-2 ring-amber-300",
                        isHovered && hoverInfo.label === "V" && "scale-105 ring-2 ring-slate-200",
                      )}
                    >
                      {p ? (
                        <>
                          <div
                            ref={(el) => {
                              if (id == null) return;
                              if (el) anchorRefs.current.set(id, el);
                              else anchorRefs.current.delete(id);
                            }}
                            className="relative"
                          >
                            <PlayerPhoto code={p.code} name={p.webName} size="md" />
                            {isCaptain && (
                              <span
                                aria-label="Captain"
                                style={{
                                  background:
                                    "linear-gradient(120deg,#fde68a 0%,#f59e0b 35%,#fbbf24 60%,#f59e0b 100%)",
                                  boxShadow: "0 0 8px #f59e0b88",
                                }}
                                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-amber-950"
                              >
                                C
                              </span>
                            )}
                            {isVice && !isCaptain && (
                              <span
                                aria-label="Vice captain"
                                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-900 shadow"
                              >
                                V
                              </span>
                            )}
                          </div>
                          <div className="w-full truncate text-center text-[11px] font-medium">{p.webName}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {p.team} · £{p.price.toFixed(1)}
                          </div>
                          <div className="mt-1 flex gap-1">
                            <button
                              type="button"
                              title="Remove"
                              onClick={() => setPlayerAtSlot(slotIdx, null)}
                              className="rounded-full bg-white/5 p-1 text-muted-foreground hover:bg-rose-500/20 hover:text-rose-300"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPickerSlot(slotIdx)}
                          className="flex h-full w-full flex-col items-center justify-center gap-1 py-2 text-muted-foreground hover:text-foreground"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed">
                            <Plus className="h-4 w-4" />
                          </div>
                          <span className="text-[10px] uppercase tracking-widest">{SLOT_LABELS[slotIdx]}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Validation strip + actions */}
        <div className="border-t bg-card/60 p-3">
          {validation.errors.length > 0 && (
            <ul className="mb-2 space-y-0.5 text-[11px] text-rose-300">
              {validation.errors.map((e, i) => (
                <li key={i}>• {e}</li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2">
            {validation.ok ? (
              <Badge variant="success" className="gap-1">
                <Check className="h-3 w-3" /> Valid squad
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">Draft (incomplete)</Badge>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              <Button variant="outline" size="sm" onClick={share} disabled={validation.filled === 0}>
                <Share2 className="mr-1 h-3.5 w-3.5" /> Share
              </Button>
              <Button size="sm" onClick={save}>Save draft</Button>
            </div>
          </div>
        </div>
      </div>

      <PlayerPicker
        open={pickerSlot !== null}
        position={pickerPosition}
        excludeIds={excludeIds}
        remainingBudget={remaining + (pickerSlot !== null && draft.picks[pickerSlot] != null
          ? (byId.get(draft.picks[pickerSlot] as number)?.price ?? 0)
          : 0)}
        onPick={(p) => {
          if (pickerSlot !== null) setPlayerAtSlot(pickerSlot, p.id);
          setPickerSlot(null);
        }}
        onClose={() => setPickerSlot(null)}
      />
    </div>
  );
}
