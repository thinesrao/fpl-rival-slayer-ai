"use client";

import { useState } from "react";
import { ArrowLeftRight, Sparkles, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ResolvedPlayer {
  webName: string;
  playerId: number;
  teamShort: string;
  teamCode: number;
  elementType: 1 | 2 | 3 | 4;
  position: "GKP" | "DEF" | "MID" | "FWD";
  cost: number;
  xPoints: number;
  opponent: string | null;
  isCaptain: boolean;
  isVice: boolean;
  isIn: boolean;
}

interface SuggestedSquad {
  startingXi: ResolvedPlayer[];
  bench: ResolvedPlayer[];
  totalXp: number;
  bank: number;
  freeTransfers: number;
  formation: string;
}

/** Tells the tile what to print in its second/third lines.
 *  - "fixture": opponent abbreviation + xP (Suggested Squad default)
 *  - "price":   team abbreviation + £price (Drafts mode) */
export type BottomMode = "fixture" | "price";

interface Props {
  suggested: SuggestedSquad;
  onTileClick?: (playerId: number, webName: string) => void;
  /** Used to label the header (e.g. "GW 37"). Defaults to no GW label. */
  gw?: number;
  /** Hide the built-in stats header — useful when the parent has its own. */
  hideHeader?: boolean;
  /** Switch the tile bottom-label scheme. Defaults to "fixture". */
  bottomMode?: BottomMode;
  /** If provided, called for each tile with the DOM node. Used by the
   *  magnetic captain-drag system to register snap targets. */
  registerAnchor?: (playerId: number, el: HTMLElement | null) => void;
  /** If provided, called for each tile to determine a transient highlight
   *  (e.g. while a captain/vice badge is hovering this player). */
  highlight?: (playerId: number) => "captain" | "vice" | null;
}

const KIT_BASE = "https://fantasy.premierleague.com/dist/img/shirts/standard";

function kitUrl(teamCode: number, isGk: boolean): string {
  return `${KIT_BASE}/shirt_${teamCode}${isGk ? "_1" : ""}-66.png`;
}

export function SuggestedSquadPitch({
  suggested,
  onTileClick,
  gw,
  hideHeader = false,
  bottomMode = "fixture",
  registerAnchor,
  highlight,
}: Props) {
  const gk = suggested.startingXi.filter((p) => p.elementType === 1);
  const def = suggested.startingXi.filter((p) => p.elementType === 2);
  const mid = suggested.startingXi.filter((p) => p.elementType === 3);
  const fwd = suggested.startingXi.filter((p) => p.elementType === 4);

  return (
    <div className="space-y-2">
      {!hideHeader && (
        <Header
          gw={gw}
          totalXp={suggested.totalXp}
          bank={suggested.bank}
          freeTransfers={suggested.freeTransfers}
          formation={suggested.formation}
        />
      )}

      <div
        className="relative overflow-hidden rounded-2xl border"
        style={{
          background:
            "linear-gradient(to bottom, hsl(120 55% 32%), hsl(120 50% 27%))",
        }}
      >
        <PitchLines />

        <div className="relative flex flex-col gap-3 px-1 py-4 sm:gap-4 sm:px-2 sm:py-5">
          <Row players={gk} onTileClick={onTileClick} bottomMode={bottomMode} registerAnchor={registerAnchor} highlight={highlight} />
          <Row players={def} onTileClick={onTileClick} bottomMode={bottomMode} registerAnchor={registerAnchor} highlight={highlight} />
          <Row players={mid} onTileClick={onTileClick} bottomMode={bottomMode} registerAnchor={registerAnchor} highlight={highlight} />
          <Row players={fwd} onTileClick={onTileClick} bottomMode={bottomMode} registerAnchor={registerAnchor} highlight={highlight} />
        </div>
      </div>

      <BenchStrip bench={suggested.bench} onTileClick={onTileClick} bottomMode={bottomMode} registerAnchor={registerAnchor} highlight={highlight} />
    </div>
  );
}

function Header({
  gw,
  totalXp,
  bank,
  freeTransfers,
  formation,
}: {
  gw?: number;
  totalXp: number;
  bank: number;
  freeTransfers: number;
  formation: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        {gw !== undefined && <Badge variant="outline">GW {gw}</Badge>}
        <Badge variant="secondary" className="font-mono">
          {formation}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1 font-mono">
          <Sparkles className="h-3 w-3 text-primary" />
          <strong className="font-semibold">{totalXp.toFixed(1)}</strong> xPts
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1 font-mono">
          <Wallet className="h-3 w-3" />£{(bank / 10).toFixed(1)}m
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-1 font-mono text-emerald-700 dark:text-emerald-300">
          <ArrowLeftRight className="h-3 w-3" />
          {freeTransfers} FT
        </span>
      </div>
    </div>
  );
}

function PitchLines() {
  // Pure-CSS field markings: centre line + circle, two penalty-area arcs.
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-white/15" />
      <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
      <div className="absolute left-1/2 top-0 h-12 w-32 -translate-x-1/2 rounded-b-2xl border border-t-0 border-white/15" />
      <div className="absolute bottom-0 left-1/2 h-12 w-32 -translate-x-1/2 rounded-t-2xl border border-b-0 border-white/15" />
    </div>
  );
}

interface RowProps {
  players: ResolvedPlayer[];
  onTileClick?: (id: number, name: string) => void;
  bottomMode: BottomMode;
  registerAnchor?: (playerId: number, el: HTMLElement | null) => void;
  highlight?: (playerId: number) => "captain" | "vice" | null;
}

function Row({ players, onTileClick, bottomMode, registerAnchor, highlight }: RowProps) {
  if (players.length === 0) return null;
  return (
    <div className="flex w-full justify-around gap-0.5 sm:gap-1.5">
      {players.map((p, i) => (
        <Tile
          key={`${p.playerId}-${i}`}
          player={p}
          onClick={onTileClick}
          bottomMode={bottomMode}
          registerAnchor={registerAnchor}
          highlight={highlight?.(p.playerId) ?? null}
        />
      ))}
    </div>
  );
}

interface TileProps {
  player: ResolvedPlayer;
  onClick?: (id: number, name: string) => void;
  small?: boolean;
  bottomMode: BottomMode;
  registerAnchor?: (playerId: number, el: HTMLElement | null) => void;
  highlight?: "captain" | "vice" | null;
}

function Tile({ player, onClick, small = false, bottomMode, registerAnchor, highlight }: TileProps) {
  const isGk = player.elementType === 1;
  const [imgFailed, setImgFailed] = useState(false);
  const clickable = !!onClick && player.playerId > 0;
  const Tag = clickable ? "button" : "div";
  const hoverGold = highlight === "captain";
  const hoverSilver = highlight === "vice";
  return (
    <Tag
      type={clickable ? "button" : undefined}
      onClick={clickable ? () => onClick!(player.playerId, player.webName) : undefined}
      title={clickable ? player.webName : player.webName}
      className={cn(
        "relative flex min-w-0 flex-1 basis-0 flex-col items-center gap-0.5 rounded-md transition-all",
        small ? "max-w-[78px]" : "max-w-[88px]",
        clickable && "cursor-pointer hover:scale-[1.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white",
        hoverGold && "scale-[1.08] ring-2 ring-amber-300",
        hoverSilver && "scale-[1.08] ring-2 ring-slate-200",
      )}
    >
      <div
        ref={(el) => {
          if (!registerAnchor) return;
          registerAnchor(player.playerId, el);
        }}
        className="relative h-9 w-9 sm:h-11 sm:w-11"
      >
        {imgFailed || player.teamCode === 0 ? (
          <div
            className="flex h-full w-full items-center justify-center rounded-md bg-white/85 text-[10px] font-bold text-slate-900"
            aria-hidden
          >
            {player.teamShort}
          </div>
        ) : (
          // FPL CDN kit assets — small, cached, no need for next/image optimization.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={kitUrl(player.teamCode, isGk)}
            alt={`${player.teamShort} kit`}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-contain drop-shadow"
          />
        )}
        {player.isCaptain && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-amber-950 shadow">
            C
          </span>
        )}
        {!player.isCaptain && player.isVice && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-900 shadow">
            V
          </span>
        )}
      </div>
      <div
        className={cn(
          "w-full overflow-hidden rounded-sm bg-white/95 px-1 py-0.5 text-center leading-tight shadow",
          player.isIn && "ring-1 ring-emerald-400",
        )}
      >
        <div className={cn("truncate font-semibold text-slate-900", small ? "text-[10px]" : "text-[11px]")}>
          {player.webName}
        </div>
        {bottomMode === "price" ? (
          <>
            <div className={cn("truncate text-slate-600", small ? "text-[9px]" : "text-[9px] sm:text-[10px]")}>
              {player.teamShort}
            </div>
            <div className={cn("font-mono font-semibold text-emerald-700", small ? "text-[10px]" : "text-[10px] sm:text-[11px]")}>
              £{(player.cost / 10).toFixed(1)}
            </div>
          </>
        ) : (
          <>
            <div className={cn("truncate text-slate-600", small ? "text-[9px]" : "text-[9px] sm:text-[10px]")}>
              {player.opponent ?? "BLANK"}
            </div>
            <div className={cn("font-mono font-semibold text-emerald-700", small ? "text-[10px]" : "text-[10px] sm:text-[11px]")}>
              {player.xPoints.toFixed(1)} xP
            </div>
          </>
        )}
      </div>
      {player.isIn && (
        <span className="absolute -left-1 top-0 rounded bg-emerald-500 px-1 py-0.5 text-[8px] font-bold text-white shadow">
          IN
        </span>
      )}
    </Tag>
  );
}

interface BenchProps {
  bench: ResolvedPlayer[];
  onTileClick?: (id: number, name: string) => void;
  bottomMode: BottomMode;
  registerAnchor?: (playerId: number, el: HTMLElement | null) => void;
  highlight?: (playerId: number) => "captain" | "vice" | null;
}

function BenchStrip({ bench, onTileClick, bottomMode, registerAnchor, highlight }: BenchProps) {
  if (!bench || bench.length === 0) return null;
  // Outfield numbered 1.., GK gets the GKP label (autosub last).
  let outfieldNum = 0;
  const labels = bench.map((p) => {
    if (p.elementType === 1) return `GKP`;
    outfieldNum++;
    return `${outfieldNum}.${p.position}`;
  });
  return (
    <div className="overflow-hidden rounded-2xl border bg-muted/40 px-2 py-3">
      <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Bench (autosub order)
      </div>
      <div className="flex w-full justify-around gap-0.5 sm:gap-1.5">
        {bench.map((p, i) => (
          <div key={`${p.playerId}-${i}`} className="flex min-w-0 flex-1 basis-0 max-w-[88px] flex-col items-center gap-1">
            <div className="text-[9px] font-semibold uppercase text-muted-foreground">{labels[i]}</div>
            <Tile
              player={p}
              onClick={onTileClick}
              small
              bottomMode={bottomMode}
              registerAnchor={registerAnchor}
              highlight={highlight?.(p.playerId) ?? null}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
