"use client";

// WC26 pitch view: FUT cards on the shared stadium backdrop, nation flag as
// the card art. The big card number is the player's POINTS for the current
// round (live while a match runs, final after) — FPL-style — not a price-OVR.
// Card colour (gold/silver/bronze) still tracks price so premiums read as
// premium at a glance.

import { cn } from "@/lib/utils";
import { FutCard } from "@/components/fut/FutCard";
import { PitchBackdrop } from "@/components/fut/PitchBackdrop";
import { playerTier, type Tier } from "@/lib/fut/tier";
import { flagEmoji } from "@/lib/wc/flags";
import type { WcPickerPlayer } from "./useWcData";

export interface WcPitchProps {
  startingXI: WcPickerPlayer[];
  bench: WcPickerPlayer[];
  captainId: number | null;
  viceId: number | null;
  onTileClick?: (player: WcPickerPlayer) => void;
  /** Optional per-player points override (e.g. a specific round). Defaults to
   *  each player's latest-round points. */
  livePoints?: Map<number, number>;
  className?: string;
}

/** Card colour tier from price ($3.5m → bronze … $10.5m → gold). */
function priceTier(price: number): Tier {
  return playerTier(Math.round(58 + ((price - 3.5) / 7) * 38));
}

export function WcPitch({
  startingXI,
  bench,
  captainId,
  viceId,
  onTileClick,
  livePoints,
  className,
}: WcPitchProps) {
  const row = (pos: string) => startingXI.filter((p) => p.position === pos);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative isolate overflow-hidden rounded-2xl border border-fut-gold/15">
        <PitchBackdrop />
        <div className="relative flex flex-col gap-3 px-1 py-5 sm:gap-4 sm:px-2 sm:py-6">
          {[row("FWD"), row("MID"), row("DEF"), row("GK")].map((players, i) => (
            <Row
              key={i}
              players={players}
              captainId={captainId}
              viceId={viceId}
              onTileClick={onTileClick}
              livePoints={livePoints}
            />
          ))}
        </div>
      </div>

      {bench.length > 0 && (
        <div className="overflow-hidden rounded-2xl border bg-muted/40 px-2 py-3">
          <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Bench (autosub order)
          </div>
          <div className="flex w-full justify-around gap-0.5 sm:gap-1.5">
            {bench.map((p, i) => (
              <div key={p.id} className="flex min-w-0 max-w-[88px] flex-1 basis-0 flex-col items-center gap-1">
                <div className="text-[9px] font-semibold uppercase text-muted-foreground">
                  {p.position === "GK" ? "GK" : `${i + 1}.${p.position}`}
                </div>
                <Tile
                  player={p}
                  captainId={captainId}
                  viceId={viceId}
                  onTileClick={onTileClick}
                  livePoints={livePoints}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  players,
  ...rest
}: {
  players: WcPickerPlayer[];
  captainId: number | null;
  viceId: number | null;
  onTileClick?: (player: WcPickerPlayer) => void;
  livePoints?: Map<number, number>;
}) {
  if (players.length === 0) return null;
  return (
    <div className="flex w-full justify-around gap-0.5 sm:gap-1.5">
      {players.map((p) => (
        <div key={p.id} className="relative flex min-w-0 max-w-[88px] flex-1 basis-0 flex-col items-center">
          <Tile player={p} {...rest} />
        </div>
      ))}
    </div>
  );
}

function Tile({
  player,
  captainId,
  viceId,
  onTileClick,
  livePoints,
}: {
  player: WcPickerPlayer;
  captainId: number | null;
  viceId: number | null;
  onTileClick?: (player: WcPickerPlayer) => void;
  livePoints?: Map<number, number>;
}) {
  const points = livePoints?.get(player.id) ?? player.lastRoundPoints ?? 0;
  const sub = `${player.nextOpponent ?? "—"} · $${player.price.toFixed(1)}`;
  const unavailable = player.status !== "playing";

  return (
    <div className="relative w-full">
      <FutCard
        tier={priceTier(player.price)}
        ovr={points}
        position={player.position}
        name={player.name.split(" ").slice(-1)[0]}
        sub={sub}
        photoUrl={undefined}
        teamShort={player.team}
        captain={player.id === captainId}
        vice={player.id === viceId}
        size="xs"
        noShine
        onClick={onTileClick ? () => onTileClick(player) : undefined}
        className={cn("!w-full", unavailable && "opacity-60 grayscale")}
      />
      <span aria-hidden className="pointer-events-none absolute left-1 bottom-5 z-20 text-sm">
        {flagEmoji(player.team)}
      </span>
      {unavailable && (
        <span className="absolute -left-1 top-0 z-30 rounded bg-red-600 px-1 py-0.5 text-[8px] font-bold text-white shadow">
          OUT
        </span>
      )}
    </div>
  );
}
