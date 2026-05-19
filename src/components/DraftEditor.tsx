"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeftRight, Check, Crown, Loader2, Share2, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayerPhoto } from "@/components/PlayerPhoto";
import { PlayerPicker } from "@/components/PlayerPicker";
import { MagneticCaptainBadge } from "@/components/MagneticCaptainBadge";
import { SLOTS, type PickerPlayer, type Position, type SquadDraft } from "@/lib/drafts/types";
import { validateDraft } from "@/lib/drafts/validate";
import { upsertDraft } from "@/lib/drafts/storage";
import { encodeDraft } from "@/lib/drafts/encode";
import {
  FORMATIONS,
  type Formation,
  pickStartingXI,
  safeFormation,
} from "@/lib/drafts/formation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  teamId: number;
  initial: SquadDraft;
  onClose: () => void;
  onSaved: (d: SquadDraft) => void;
}

interface ActionMenu {
  slotIdx: number;
  playerId: number;
}

export function DraftEditor({ teamId, initial, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<SquadDraft>(initial);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ id: number | null; label: string }>({ id: null, label: "" });
  const [critique, setCritique] = useState<string | null>(null);
  const [critiqueLoading, setCritiqueLoading] = useState(false);
  const [actionMenu, setActionMenu] = useState<ActionMenu | null>(null);

  const anchorRefs = useRef<Map<number, HTMLElement>>(new Map());
  const getAnchors = () => [...anchorRefs.current.entries()].map(([id, el]) => ({ id, el }));

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
  const liveBank = draft.budget / 10 - validation.totalCost;

  const formation: Formation = useMemo(
    () => safeFormation(draft, byId, draft.formation as Formation | undefined),
    [draft, byId],
  );

  // Live starting XI from formation × totalPoints. Bench = remaining picks.
  const startingXI = useMemo(() => {
    if (!byId.size) return new Set<number>();
    return new Set(pickStartingXI(draft, byId, formation));
  }, [draft, byId, formation]);

  // Bench order: GK first, then outfielders by element_type so the strip
  // reads GK | DEF | MID | FWD left-to-right.
  const benchIds = useMemo(() => {
    const ids = draft.picks
      .map((id, slotIdx) => ({ id, slotIdx }))
      .filter((x): x is { id: number; slotIdx: number } => x.id != null && !startingXI.has(x.id));
    ids.sort((a, b) => {
      const pa = byId.get(a.id)?.position ?? "MID";
      const pb = byId.get(b.id)?.position ?? "MID";
      const order: Record<Position, number> = { GKP: 0, DEF: 1, MID: 2, FWD: 3 };
      return order[pa] - order[pb];
    });
    return ids;
  }, [draft.picks, startingXI, byId]);

  // Starting XI split by position for pitch rows.
  const startersByPos = useMemo(() => {
    const groups: Record<Position, Array<{ id: number; slotIdx: number }>> = {
      GKP: [], DEF: [], MID: [], FWD: [],
    };
    draft.picks.forEach((id, slotIdx) => {
      if (id == null || !startingXI.has(id)) return;
      const pos = byId.get(id)?.position;
      if (!pos) return;
      groups[pos].push({ id, slotIdx });
    });
    return groups;
  }, [draft.picks, startingXI, byId]);

  // Mutators ------------------------------------------------------------------

  const setPlayerAtSlot = (slot: number, playerId: number | null) => {
    setDraft((d) => {
      const picks = [...d.picks];
      const wasId = picks[slot];
      picks[slot] = playerId;
      const captainId = wasId === d.captainId ? null : d.captainId;
      const viceId = wasId === d.viceId ? null : d.viceId;
      return { ...d, picks, captainId, viceId };
    });
  };

  const setCaptain = (playerId: number) => {
    setDraft((d) => ({
      ...d,
      captainId: playerId,
      viceId: d.viceId === playerId ? null : d.viceId,
    }));
    toast.success("Captain assigned");
  };

  const setVice = (playerId: number) => {
    setDraft((d) => ({
      ...d,
      viceId: playerId,
      captainId: d.captainId === playerId ? null : d.captainId,
    }));
    toast.success("Vice captain assigned");
  };

  // Network actions -----------------------------------------------------------

  const save = () => {
    upsertDraft(teamId, draft);
    toast.success("Draft saved");
    onSaved(draft);
  };

  const runCritique = async () => {
    setCritiqueLoading(true);
    setCritique(null);
    try {
      const res = await fetch("/api/drafts/critique", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ encoded: encodeDraft(draft) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.message || body?.error || `Critique failed (${res.status})`);
        return;
      }
      if (!body?.markdown) {
        toast.error("Empty critique response.");
        return;
      }
      setCritique(body.markdown as string);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCritiqueLoading(false);
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/draft/${encodeDraft(draft)}`;
    const title = `${draft.name} — FPL draft`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text: title, url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied — paste it into your group chat.");
    } catch {
      // Last-resort fallback: open the preview page in a new tab.
      window.open(url, "_blank", "noopener");
    }
  };

  // Find slot index for a given player id (used by drag onAssign callbacks).
  const slotForPlayerId = (id: number) => draft.picks.findIndex((p) => p === id);

  // ---------------------------------------------------------------------------

  const excludeIds = draft.picks.filter((id): id is number => id != null);
  const pickerPosition = pickerSlot !== null ? SLOTS[pickerSlot] : null;
  const pickerSlotCurrentPrice =
    pickerSlot !== null && draft.picks[pickerSlot] != null
      ? byId.get(draft.picks[pickerSlot] as number)?.price ?? 0
      : 0;
  // For an in-place swap the user gets back the outgoing player's price plus
  // the existing bank — i.e. they can spend up to (outgoingPrice + liveBank).
  const pickerRemainingBudget = liveBank + pickerSlotCurrentPrice;

  const actionPlayer = actionMenu ? byId.get(actionMenu.playerId) : null;

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
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="h-8 px-2">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Budget readout (read-only — derived from your real bank + squad value) */}
        <div className="grid grid-cols-3 gap-2 border-b bg-card/60 px-4 py-2 text-center text-[11px]">
          <div>
            <div className="font-mono text-sm font-semibold">£{validation.totalCost.toFixed(1)}m</div>
            <div className="uppercase tracking-widest text-muted-foreground">Squad value</div>
          </div>
          <div>
            <div
              className={cn(
                "font-mono text-sm font-semibold",
                liveBank < 0 ? "text-rose-400" : "text-emerald-400",
              )}
            >
              £{liveBank.toFixed(1)}m
            </div>
            <div className="uppercase tracking-widest text-muted-foreground">Bank</div>
          </div>
          <div>
            <div className="font-mono text-sm font-semibold">£{(draft.budget / 10).toFixed(1)}m</div>
            <div className="uppercase tracking-widest text-muted-foreground">Cap</div>
          </div>
        </div>

        {/* Formation picker */}
        <div className="flex items-center gap-2 overflow-x-auto border-b bg-background/40 px-4 py-2 text-[11px]">
          <span className="shrink-0 font-semibold uppercase tracking-widest text-muted-foreground">
            Formation
          </span>
          {FORMATIONS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setDraft((d) => ({ ...d, formation: f }))}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-0.5 font-mono transition-colors",
                formation === f
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card/40 text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Captain/Vice drag dock */}
        <div className="flex items-center justify-between gap-3 border-b bg-card/40 px-4 py-2 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">
            Tap a player for the action menu, or drag{" "}
            <span className="font-bold text-amber-400">C</span> /{" "}
            <span className="font-bold text-slate-200">V</span> onto a player.
          </span>
          <span className="sm:hidden">Tap a player to assign captain / vice / transfer.</span>
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

        {/* Pitch + bench */}
        <div className="flex-1 overflow-y-auto p-2">
          <div
            className="relative overflow-hidden rounded-lg p-3"
            style={{
              backgroundImage:
                "linear-gradient(180deg,#0d3b1e 0%,#0a2c17 100%), repeating-linear-gradient(0deg,transparent 0,transparent 32px,rgba(255,255,255,0.025) 32px,rgba(255,255,255,0.025) 33px)",
              backgroundBlendMode: "overlay",
            }}
          >
            {/* Pitch markings */}
            <div className="pointer-events-none absolute inset-2 rounded border border-white/15" />
            <div className="pointer-events-none absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 bg-white/10" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />

            <div className="relative space-y-3">
              {(["GKP", "DEF", "MID", "FWD"] as Position[]).map((pos) => (
                <PitchRow
                  key={pos}
                  cells={startersByPos[pos]}
                  byId={byId}
                  captainId={draft.captainId}
                  viceId={draft.viceId}
                  anchorRefs={anchorRefs}
                  hoverInfo={hoverInfo}
                  onTap={(slotIdx, playerId) => setActionMenu({ slotIdx, playerId })}
                />
              ))}
            </div>
          </div>

          {/* Bench strip */}
          <div className="mt-2 rounded-lg border bg-slate-900/60 p-2">
            <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              <span>Bench</span>
              <span className="font-mono">{benchIds.length} / 4</span>
            </div>
            <div className="flex justify-around gap-2">
              {benchIds.length === 0 ? (
                <div className="py-4 text-[11px] text-muted-foreground">
                  No bench players — fill the squad to enable subs.
                </div>
              ) : (
                benchIds.map(({ id, slotIdx }) => (
                  <PitchTile
                    key={slotIdx}
                    id={id}
                    slotIdx={slotIdx}
                    player={byId.get(id) ?? null}
                    captainId={draft.captainId}
                    viceId={draft.viceId}
                    anchorRefs={anchorRefs}
                    hoverInfo={hoverInfo}
                    bench
                    onTap={() => setActionMenu({ slotIdx, playerId: id })}
                  />
                ))
              )}
            </div>
          </div>
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
          {critique && (
            <div className="mb-2 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md border border-violet-500/30 bg-violet-500/5 p-3 text-[11px] leading-relaxed">
              {critique}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {validation.ok ? (
              <Badge variant="success" className="gap-1">
                <Check className="h-3 w-3" /> Valid squad
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Draft (incomplete)
              </Badge>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              <Button
                variant="outline"
                size="sm"
                onClick={runCritique}
                disabled={critiqueLoading || validation.filled < 11}
                title={validation.filled < 11 ? "Fill at least 11 slots first" : "Get an AI verdict"}
              >
                {critiqueLoading ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-3.5 w-3.5 text-violet-300" />
                )}
                {critiqueLoading ? "Thinking…" : critique ? "Re-roast" : "Roast my draft"}
              </Button>
              <Button variant="outline" size="sm" onClick={share} disabled={validation.filled === 0}>
                <Share2 className="mr-1 h-3.5 w-3.5" /> Share
              </Button>
              <Button size="sm" onClick={save}>Save draft</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Player action menu */}
      <AnimatePresence>
        {actionMenu && actionPlayer && (
          <motion.div
            className="fixed inset-0 z-[80] flex items-end justify-center bg-background/70 backdrop-blur-sm md:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setActionMenu(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm overflow-hidden rounded-t-2xl border bg-card shadow-2xl md:rounded-2xl"
            >
              <div className="flex items-center gap-3 border-b p-3">
                <PlayerPhoto code={actionPlayer.code} name={actionPlayer.webName} size="md" />
                <div className="flex-1">
                  <div className="font-semibold">{actionPlayer.webName}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {actionPlayer.team} · {actionPlayer.position} · £{actionPlayer.price.toFixed(1)}m
                  </div>
                </div>
              </div>
              <div className="flex flex-col">
                <MenuAction
                  icon={<Crown className="h-4 w-4 text-amber-400" />}
                  label={draft.captainId === actionMenu.playerId ? "Captain ✓" : "Make captain"}
                  disabled={draft.captainId === actionMenu.playerId}
                  onClick={() => {
                    setCaptain(actionMenu.playerId);
                    setActionMenu(null);
                  }}
                />
                <MenuAction
                  icon={<span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-300 text-[9px] font-bold text-slate-900">V</span>}
                  label={draft.viceId === actionMenu.playerId ? "Vice captain ✓" : "Make vice captain"}
                  disabled={draft.viceId === actionMenu.playerId}
                  onClick={() => {
                    setVice(actionMenu.playerId);
                    setActionMenu(null);
                  }}
                />
                <MenuAction
                  icon={<ArrowLeftRight className="h-4 w-4 text-primary" />}
                  label="Transfer out — pick a replacement"
                  onClick={() => {
                    const idx = slotForPlayerId(actionMenu.playerId);
                    setPickerSlot(idx >= 0 ? idx : null);
                    setActionMenu(null);
                  }}
                />
                <MenuAction
                  icon={<Trash2 className="h-4 w-4 text-rose-400" />}
                  label="Remove from squad"
                  onClick={() => {
                    const idx = slotForPlayerId(actionMenu.playerId);
                    if (idx >= 0) setPlayerAtSlot(idx, null);
                    setActionMenu(null);
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => setActionMenu(null)}
                className="w-full border-t bg-card py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <PlayerPicker
        open={pickerSlot !== null}
        position={pickerPosition}
        excludeIds={excludeIds}
        remainingBudget={pickerRemainingBudget}
        onPick={(p) => {
          if (pickerSlot !== null) setPlayerAtSlot(pickerSlot, p.id);
          setPickerSlot(null);
        }}
        onClose={() => setPickerSlot(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents

interface PitchRowProps {
  cells: Array<{ id: number; slotIdx: number }>;
  byId: Map<number, PickerPlayer>;
  captainId: number | null;
  viceId: number | null;
  anchorRefs: React.RefObject<Map<number, HTMLElement>>;
  hoverInfo: { id: number | null; label: string };
  onTap: (slotIdx: number, playerId: number) => void;
}

function PitchRow({ cells, byId, captainId, viceId, anchorRefs, hoverInfo, onTap }: PitchRowProps) {
  if (cells.length === 0) return null;
  return (
    <div className="flex items-end justify-around gap-1">
      {cells.map(({ id, slotIdx }) => (
        <PitchTile
          key={slotIdx}
          id={id}
          slotIdx={slotIdx}
          player={byId.get(id) ?? null}
          captainId={captainId}
          viceId={viceId}
          anchorRefs={anchorRefs}
          hoverInfo={hoverInfo}
          onTap={() => onTap(slotIdx, id)}
        />
      ))}
    </div>
  );
}

interface PitchTileProps {
  id: number;
  slotIdx: number;
  player: PickerPlayer | null;
  captainId: number | null;
  viceId: number | null;
  anchorRefs: React.RefObject<Map<number, HTMLElement>>;
  hoverInfo: { id: number | null; label: string };
  bench?: boolean;
  onTap: () => void;
}

function PitchTile({ id, player, captainId, viceId, anchorRefs, hoverInfo, bench, onTap }: PitchTileProps) {
  const isCaptain = captainId === id;
  const isVice = viceId === id && !isCaptain;
  const isHoveredC = hoverInfo.id === id && hoverInfo.label === "C";
  const isHoveredV = hoverInfo.id === id && hoverInfo.label === "V";

  if (!player) {
    return (
      <div className="flex w-16 flex-col items-center gap-1 opacity-40">
        <div className="h-10 w-10 rounded-full border border-dashed border-white/30" />
        <div className="text-[9px] uppercase text-muted-foreground">empty</div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        "group relative flex w-16 flex-col items-center gap-0.5 rounded-md p-1 text-center transition-all",
        "hover:bg-white/5 active:scale-95",
        isHoveredC && "scale-110 ring-2 ring-amber-300",
        isHoveredV && "scale-110 ring-2 ring-slate-200",
        bench && "w-14",
      )}
    >
      <div
        ref={(el) => {
          if (el) anchorRefs.current?.set(id, el);
          else anchorRefs.current?.delete(id);
        }}
        className="relative"
      >
        <PlayerPhoto code={player.code} name={player.webName} size={bench ? "sm" : "md"} />
        {isCaptain && (
          <span
            aria-label="Captain"
            style={{
              background: "linear-gradient(120deg,#fde68a 0%,#f59e0b 35%,#fbbf24 60%,#f59e0b 100%)",
              boxShadow: "0 0 8px #f59e0b88",
            }}
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-amber-950"
          >
            C
          </span>
        )}
        {isVice && (
          <span
            aria-label="Vice captain"
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-900 shadow"
          >
            V
          </span>
        )}
      </div>
      <div className="w-full truncate text-[10px] font-medium text-white drop-shadow">
        {player.webName}
      </div>
      <div className="rounded bg-black/40 px-1 text-[9px] font-mono text-white">
        £{player.price.toFixed(1)}
      </div>
    </button>
  );
}

interface MenuActionProps {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

function MenuAction({ icon, label, disabled, onClick }: MenuActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border/40 px-4 py-3 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed text-muted-foreground/60"
          : "text-foreground hover:bg-muted/40",
      )}
    >
      <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
}
