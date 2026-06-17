"use client";

// WC26 squad builder: pitch + picker with live rules validation. All state
// flows through useWcSquad (localStorage + Redis mirror). Tapping a tile
// opens an action sheet (captain/vice/start/bench/remove).

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Shirt, Sparkles, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WcPosition } from "@/lib/wc/fifa/types";
import type { WcSquadState } from "@/lib/wc/squad/types";
import { WcPitch } from "./WcPitch";
import { WcPlayerPicker } from "./WcPlayerPicker";
import type { WcBootstrap, WcPickerPlayer } from "./useWcData";

const SHAPE: Record<WcPosition, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const XI_LIMITS: Record<WcPosition, [number, number]> = {
  GK: [1, 1],
  DEF: [3, 5],
  MID: [2, 5],
  FWD: [1, 3],
};

export interface WcSquadBuilderProps {
  data: WcBootstrap;
  squad: WcSquadState;
  update: (updater: (prev: WcSquadState) => WcSquadState) => void;
}

/** Price-ranked legal lineup from 15 picks (client mirror of the server logic). */
export function arrangeLineup(players: WcPickerPlayer[]): { xi: number[]; bench: number[] } {
  const score = (p: WcPickerPlayer) => p.price + (p.status !== "playing" ? -100 : 0);
  const byPos = (pos: WcPosition) =>
    players.filter((p) => p.position === pos).sort((a, b) => score(b) - score(a));
  const xi: WcPickerPlayer[] = [...byPos("GK").slice(0, 1)];
  const defs = byPos("DEF");
  const mids = byPos("MID");
  const fwds = byPos("FWD");
  xi.push(...defs.slice(0, XI_LIMITS.DEF[0]), ...mids.slice(0, XI_LIMITS.MID[0]), ...fwds.slice(0, XI_LIMITS.FWD[0]));
  const rest = [...defs.slice(XI_LIMITS.DEF[0]), ...mids.slice(XI_LIMITS.MID[0]), ...fwds.slice(XI_LIMITS.FWD[0])].sort(
    (a, b) => score(b) - score(a),
  );
  for (const p of rest) {
    if (xi.length >= 11) break;
    if (xi.filter((q) => q.position === p.position).length < XI_LIMITS[p.position][1]) xi.push(p);
  }
  const bench = players
    .filter((p) => !xi.includes(p))
    .sort((a, b) => (a.position === "GK" ? 1 : 0) - (b.position === "GK" ? 1 : 0) || score(b) - score(a));
  return { xi: xi.map((p) => p.id), bench: bench.map((p) => p.id) };
}

export function WcSquadBuilder({ data, squad, update }: WcSquadBuilderProps) {
  const [sheetPlayer, setSheetPlayer] = useState<WcPickerPlayer | null>(null);

  const byId = useMemo(() => new Map(data.players.map((p) => [p.id, p])), [data.players]);
  const picked = useMemo(
    () => squad.picks.map((id) => byId.get(id)).filter((p): p is WcPickerPlayer => Boolean(p)),
    [squad.picks, byId],
  );
  const pickedIds = useMemo(() => new Set(squad.picks), [squad.picks]);

  const totalCost = useMemo(
    () => Math.round(picked.reduce((s, p) => s + p.price, 0) * 10) / 10,
    [picked],
  );
  const bank = Math.round((data.rules.budget - totalCost) * 10) / 10;

  const posCounts = useMemo(() => {
    const c: Record<WcPosition, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const p of picked) c[p.position]++;
    return c;
  }, [picked]);

  const nationCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of picked) c.set(p.team, (c.get(p.team) ?? 0) + 1);
    return c;
  }, [picked]);

  const errors = useMemo(() => {
    const errs: string[] = [];
    if (picked.length < 15) errs.push(`${15 - picked.length} slot${picked.length === 14 ? "" : "s"} to fill`);
    if (bank < 0) errs.push(`Over budget by $${Math.abs(bank).toFixed(1)}m`);
    for (const [team, n] of nationCounts) {
      if (n > data.rules.maxPerNation) errs.push(`${team} ×${n} (max ${data.rules.maxPerNation})`);
    }
    if (picked.length === 15 && squad.captainId == null) errs.push("Pick a captain");
    return errs;
  }, [picked.length, bank, nationCounts, data.rules.maxPerNation, squad.captainId]);

  // Remaining-slot budget guard: leave $3.5m per unfilled slot.
  const blockedReason = (p: WcPickerPlayer): string | null => {
    if (posCounts[p.position] >= SHAPE[p.position]) return `${p.position} full`;
    const remainingAfter = 15 - picked.length - 1;
    if (totalCost + p.price > data.rules.budget - remainingAfter * 3.5) return "Too expensive";
    if ((nationCounts.get(p.team) ?? 0) >= data.rules.maxPerNation) return `Max ${data.rules.maxPerNation}/nation`;
    return null;
  };

  const applyPicks = (picks: number[]) => {
    update((prev) => {
      const players = picks.map((id) => byId.get(id)).filter((p): p is WcPickerPlayer => Boolean(p));
      const { xi, bench } = picks.length === 15 ? arrangeLineup(players) : { xi: [], bench: [] };
      const captainId = prev.captainId != null && picks.includes(prev.captainId) && xi.includes(prev.captainId) ? prev.captainId : xi[0] ?? null;
      const viceId =
        prev.viceId != null && prev.viceId !== captainId && xi.includes(prev.viceId)
          ? prev.viceId
          : xi.find((id) => id !== captainId) ?? null;
      // Preserve a manual XI arrangement when it's still the same 15 players.
      const keepManual =
        prev.startingXI.length === 11 &&
        picks.length === 15 &&
        prev.startingXI.every((id) => picks.includes(id)) &&
        prev.bench.every((id) => picks.includes(id)) &&
        prev.startingXI.length + prev.bench.length === 15;
      return {
        ...prev,
        picks,
        startingXI: keepManual ? prev.startingXI : xi,
        bench: keepManual ? prev.bench : bench,
        captainId: keepManual ? prev.captainId : captainId,
        viceId: keepManual ? prev.viceId : viceId,
      };
    });
  };

  const onPick = (p: WcPickerPlayer) => {
    if (pickedIds.has(p.id) || blockedReason(p)) return;
    applyPicks([...squad.picks, p.id]);
  };

  const removePlayer = (p: WcPickerPlayer) => {
    applyPicks(squad.picks.filter((id) => id !== p.id));
    setSheetPlayer(null);
  };

  const makeCaptain = (p: WcPickerPlayer, role: "captain" | "vice") => {
    update((prev) => ({
      ...prev,
      captainId: role === "captain" ? p.id : prev.captainId === p.id ? prev.viceId : prev.captainId,
      viceId: role === "vice" ? p.id : prev.viceId === p.id ? null : prev.viceId,
    }));
    toast.success(`${p.name} is your ${role === "captain" ? "captain" : "vice-captain"}`);
    setSheetPlayer(null);
  };

  const swapBenchXi = (benchP: WcPickerPlayer, xiP: WcPickerPlayer) => {
    update((prev) => ({
      ...prev,
      startingXI: prev.startingXI.map((id) => (id === xiP.id ? benchP.id : id)),
      bench: prev.bench.map((id) => (id === benchP.id ? xiP.id : id)),
      captainId: prev.captainId === xiP.id ? benchP.id : prev.captainId,
      viceId: prev.viceId === xiP.id ? benchP.id : prev.viceId,
    }));
    setSheetPlayer(null);
  };

  /** XI players the sheet's bench player may legally swap with. */
  const eligibleSwapTargets = (benchP: WcPickerPlayer): WcPickerPlayer[] => {
    const xiPlayers = squad.startingXI.map((id) => byId.get(id)).filter((p): p is WcPickerPlayer => Boolean(p));
    return xiPlayers.filter((xiP) => {
      if (xiP.position === benchP.position) return true;
      const counts: Record<WcPosition, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
      for (const q of xiPlayers) counts[q.position]++;
      counts[xiP.position]--;
      counts[benchP.position]++;
      return (Object.keys(counts) as WcPosition[]).every(
        (pos) => counts[pos] >= XI_LIMITS[pos][0] && counts[pos] <= XI_LIMITS[pos][1],
      );
    });
  };

  const xiPlayers = squad.startingXI.map((id) => byId.get(id)).filter((p): p is WcPickerPlayer => Boolean(p));
  const benchPlayers = squad.bench.map((id) => byId.get(id)).filter((p): p is WcPickerPlayer => Boolean(p));
  const sheetIsBench = sheetPlayer != null && squad.bench.includes(sheetPlayer.id);

  return (
    <div className="space-y-3">
      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
        <Badge variant="secondary" className="font-mono">
          {picked.length}/15
        </Badge>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-xs",
            bank < 0 ? "bg-red-500/20 text-red-300" : "bg-muted/60",
          )}
        >
          <Wallet className="h-3 w-3" />${bank.toFixed(1)}m left
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1 font-mono text-xs">
          <Shirt className="h-3 w-3" />
          {(["GK", "DEF", "MID", "FWD"] as const).map((pos) => `${posCounts[pos]}/${SHAPE[pos]}`).join(" · ")}
        </span>
        {errors.length === 0 ? (
          <span className="ml-auto inline-flex items-center gap-1 font-mono text-xs text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Squad legal
          </span>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            {errors[0]}
          </span>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          {picked.length > 0 ? (
            <WcPitch
              startingXI={picked.length === 15 ? xiPlayers : picked}
              bench={picked.length === 15 ? benchPlayers : []}
              captainId={squad.captainId}
              viceId={squad.viceId}
              onTileClick={setSheetPlayer}
            />
          ) : (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
              Pick players (or let the AI draft for you) to fill your pitch
            </div>
          )}
          {picked.length === 15 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                const { xi, bench } = arrangeLineup(picked);
                update((prev) => ({
                  ...prev,
                  startingXI: xi,
                  bench,
                  captainId: prev.captainId != null && xi.includes(prev.captainId) ? prev.captainId : xi[0],
                  viceId: prev.viceId != null && xi.includes(prev.viceId) && prev.viceId !== prev.captainId ? prev.viceId : xi[1],
                }));
              }}
            >
              <Sparkles className="mr-1 h-3.5 w-3.5" /> Auto-arrange best XI
            </Button>
          )}
        </div>

        <div className="h-[520px] lg:h-auto">
          <WcPlayerPicker
            players={data.players}
            pickedIds={pickedIds}
            blockedReason={blockedReason}
            onPick={onPick}
          />
        </div>
      </div>

      {/* Action sheet */}
      {sheetPlayer && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
          onClick={() => setSheetPlayer(null)}
        >
          <div
            className="w-full max-w-md space-y-2 rounded-t-2xl border bg-card p-4 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-display text-lg font-bold">{sheetPlayer.name}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {sheetPlayer.teamName} · {sheetPlayer.position} · ${sheetPlayer.price.toFixed(1)}m ·{" "}
                  {sheetPlayer.percentSelected.toFixed(1)}% owned · {sheetPlayer.nextOpponent ?? "no fixture"}
                </div>
              </div>
            </div>

            {!sheetIsBench && squad.startingXI.includes(sheetPlayer.id) && (
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" onClick={() => makeCaptain(sheetPlayer, "captain")} disabled={squad.captainId === sheetPlayer.id}>
                  Captain
                </Button>
                <Button size="sm" variant="secondary" onClick={() => makeCaptain(sheetPlayer, "vice")} disabled={squad.viceId === sheetPlayer.id}>
                  Vice-captain
                </Button>
              </div>
            )}

            {sheetIsBench && (
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Swap into XI for…</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {eligibleSwapTargets(sheetPlayer).map((xiP) => (
                    <Button key={xiP.id} size="sm" variant="outline" onClick={() => swapBenchXi(sheetPlayer, xiP)}>
                      {xiP.name.split(" ").slice(-1)[0]} ({xiP.position})
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <Button size="sm" variant="destructive" className="w-full" onClick={() => removePlayer(sheetPlayer)}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove from squad
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
