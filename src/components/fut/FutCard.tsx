"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  type Tier,
  tierGradientClass,
  tierShadowClass,
} from "@/lib/fut/tier";
import { HoloOverlay } from "./HoloOverlay";

export interface FutCardStat {
  label: string;
  value: string | number;
}

export interface FutCardProps {
  tier: Tier;
  ovr: number;
  position: string;
  name: string;
  sub?: string;
  stats?: FutCardStat[];
  /** Premier League player code, renders via the PL CDN. */
  photoCode?: number;
  /** Direct photo URL — used when not a PL player (e.g. manager initials). */
  photoUrl?: string;
  captain?: boolean;
  vice?: boolean;
  size?: "sm" | "md" | "lg";
  /** Static (no animated shine). Use for off-screen / dense layouts. */
  noShine?: boolean;
  onClick?: () => void;
  className?: string;
}

const SIZE = {
  sm: "w-20",
  md: "w-32",
  lg: "w-44",
} as const;

const OVR_TEXT = {
  sm: "text-2xl",
  md: "text-4xl",
  lg: "text-5xl",
} as const;

const NAME_TEXT = {
  sm: "text-[10px]",
  md: "text-sm",
  lg: "text-base",
} as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function FutCard({
  tier,
  ovr,
  position,
  name,
  sub,
  stats,
  photoCode,
  photoUrl,
  captain,
  vice,
  size = "md",
  noShine,
  onClick,
  className,
}: FutCardProps) {
  const [photoErrored, setPhotoErrored] = useState(false);
  const showStats = stats && stats.length > 0;
  const interactive = !!onClick;

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        "relative isolate aspect-[5/7] overflow-hidden rounded-xl text-zinc-900 transition-transform",
        tierGradientClass(tier),
        tierShadowClass(tier),
        SIZE[size],
        interactive && "cursor-pointer hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      {!noShine && <HoloOverlay />}

      {(captain || vice) && (
        <span
          aria-label={captain ? "Captain" : "Vice-captain"}
          className={cn(
            "absolute right-1.5 top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded-full font-display text-[11px] font-bold ring-2 ring-zinc-900/40",
            captain
              ? "bg-yellow-300 text-zinc-900"
              : "bg-zinc-200 text-zinc-700",
          )}
        >
          {captain ? "C" : "V"}
        </span>
      )}

      <div className="relative z-10 flex h-full flex-col p-2">
        <div className="flex items-start gap-1.5">
          <div className="flex flex-col items-center leading-none">
            <span
              className={cn(
                "font-display font-extrabold tabular-nums",
                OVR_TEXT[size],
              )}
            >
              {ovr}
            </span>
            <span className="mt-0.5 font-mono text-[10px] font-bold tracking-wider">
              {position.toUpperCase()}
            </span>
          </div>

          <div className="ml-auto flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-zinc-900/15 ring-1 ring-zinc-900/20">
            {photoCode && !photoErrored ? (
              <Image
                src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${photoCode}.png`}
                width={48}
                height={60}
                alt={name}
                onError={() => setPhotoErrored(true)}
                className="h-full w-full object-cover object-top"
              />
            ) : photoUrl && !photoErrored ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt={name}
                onError={() => setPhotoErrored(true)}
                className="h-full w-full object-cover object-center"
              />
            ) : (
              <span className="font-display text-sm font-bold">
                {initials(name)}
              </span>
            )}
          </div>
        </div>

        <div className="mt-auto">
          <div
            className={cn(
              "truncate text-center font-display font-bold uppercase tracking-tight",
              NAME_TEXT[size],
            )}
          >
            {name}
          </div>
          {sub && (
            <div className="truncate text-center font-mono text-[9px] uppercase tracking-wider opacity-75">
              {sub}
            </div>
          )}
          {showStats && (
            <div
              className={cn(
                "mt-1.5 grid gap-x-2 gap-y-0.5 border-t border-zinc-900/15 pt-1.5 text-[10px]",
                stats!.length > 2 ? "grid-cols-2" : "grid-cols-1",
              )}
            >
              {stats!.slice(0, 4).map((s) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between font-mono"
                >
                  <span className="opacity-70">{s.label}</span>
                  <span className="font-bold tabular-nums">{s.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
