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
  /** FPL element.code — drives PL CDN player-photo URL. */
  photoCode?: number;
  /** Direct photo URL — fallback when photoCode isn't available. */
  photoUrl?: string;
  /** FPL team.code — drives the PL team-crest URL. */
  teamCode?: number;
  /** Team short label, used as the fallback crest when no teamCode is available. */
  teamShort?: string;
  captain?: boolean;
  vice?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  /** Static (no animated shine). Use for off-screen / dense layouts. */
  noShine?: boolean;
  onClick?: () => void;
  className?: string;
}

const SIZE = {
  xs: "w-20",
  sm: "w-24",
  md: "w-32",
  lg: "w-48",
} as const;

const OVR_TEXT = {
  xs: "text-lg",
  sm: "text-2xl",
  md: "text-3xl",
  lg: "text-5xl",
} as const;

const POS_TEXT = {
  xs: "text-[8px]",
  sm: "text-[9px]",
  md: "text-[10px]",
  lg: "text-xs",
} as const;

const NAME_TEXT = {
  xs: "text-[9px]",
  sm: "text-[10px]",
  md: "text-[13px]",
  lg: "text-base",
} as const;

const PHOTO_BOX = {
  xs: "h-12 w-12",
  sm: "h-14 w-14",
  md: "h-20 w-20",
  lg: "h-28 w-28",
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

const PHOTO_URL = (code: number) =>
  `https://resources.premierleague.com/premierleague/photos/players/250x250/p${code}.png`;
const CREST_URL = (teamCode: number) =>
  `https://resources.premierleague.com/premierleague/badges/50/t${teamCode}.png`;

export function FutCard({
  tier,
  ovr,
  position,
  name,
  sub,
  stats,
  photoCode,
  photoUrl,
  teamCode,
  teamShort,
  captain,
  vice,
  size = "md",
  noShine,
  onClick,
  className,
}: FutCardProps) {
  const [photoErrored, setPhotoErrored] = useState(false);
  const [crestErrored, setCrestErrored] = useState(false);
  const interactive = !!onClick;
  const showStats = stats && stats.length > 0 && size !== "xs";
  const showCrest = size === "md" || size === "lg";
  const photo =
    photoCode && photoCode > 0 ? PHOTO_URL(photoCode) : photoUrl ?? null;

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
        interactive &&
          "cursor-pointer hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      {!noShine && <HoloOverlay />}

      {/* Photo — upper portion, slightly inset from the right edge */}
      <div
        className={cn(
          "absolute z-0 flex items-end justify-center overflow-hidden",
          PHOTO_BOX[size],
          size === "xs" ? "right-0 top-1" : size === "sm" ? "right-0.5 top-1" : "right-1 top-1",
        )}
        aria-hidden
      >
        {photo && !photoErrored ? (
          // PL CDN photos are PNGs with transparent backgrounds.
          // Use a plain img — next/image's Image optimizer adds overhead we don't need here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            onError={() => setPhotoErrored(true)}
            className="h-full w-full object-contain object-bottom drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-full bg-zinc-900/15 ring-1 ring-zinc-900/20">
            <span className={cn("font-display font-bold", size === "xs" ? "text-[10px]" : "text-sm")}>
              {initials(name)}
            </span>
          </div>
        )}
      </div>

      {/* Captain / vice insignia */}
      {(captain || vice) && (
        <span
          aria-label={captain ? "Captain" : "Vice-captain"}
          className={cn(
            "absolute right-1 top-1 z-30 flex h-5 w-5 items-center justify-center rounded-full font-display text-[11px] font-bold ring-2 ring-zinc-900/40",
            captain ? "bg-yellow-300 text-zinc-900" : "bg-zinc-200 text-zinc-700",
          )}
        >
          {captain ? "C" : "V"}
        </span>
      )}

      {/* OVR + position stack — upper-left, layered over the photo */}
      <div className="absolute left-1.5 top-1 z-20 flex flex-col items-center leading-none">
        <span
          className={cn(
            "font-display font-extrabold tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]",
            OVR_TEXT[size],
          )}
        >
          {ovr}
        </span>
        <span
          className={cn(
            "mt-0.5 font-mono font-bold uppercase tracking-wider [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]",
            POS_TEXT[size],
          )}
        >
          {position}
        </span>
      </div>

      {/* Name + stats — lower portion */}
      <div
        className={cn(
          "absolute inset-x-1 z-20 flex flex-col items-stretch",
          size === "xs" ? "bottom-1" : size === "sm" ? "bottom-1" : "bottom-1.5",
        )}
      >
        <div
          className={cn(
            "truncate text-center font-display font-extrabold uppercase tracking-tight [text-shadow:0_1px_1px_rgba(0,0,0,0.25)]",
            NAME_TEXT[size],
          )}
        >
          {name}
        </div>
        {sub && (
          <div
            className={cn(
              "truncate text-center font-mono uppercase tracking-wider opacity-75",
              size === "xs" ? "text-[7px]" : "text-[8px]",
            )}
          >
            {sub}
          </div>
        )}
        {showStats && (
          <div
            className={cn(
              "mt-1 border-t border-zinc-900/15 pt-1",
              "grid gap-x-1.5 gap-y-0.5",
              size === "lg"
                ? stats!.length >= 5
                  ? "grid-cols-3"
                  : "grid-cols-2"
                : stats!.length >= 5
                  ? "grid-cols-3 gap-x-1"
                  : "grid-cols-2",
            )}
          >
            {stats!.slice(0, 6).map((s) => (
              <div
                key={s.label}
                className={cn(
                  "flex items-baseline justify-between font-mono leading-tight",
                  size === "lg" ? "text-[10px]" : "text-[9px]",
                )}
              >
                <span className="opacity-70">{s.label}</span>
                <span className="font-bold tabular-nums">{s.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Team crest (bottom-left) — only on md/lg where there's room */}
      {showCrest && (
        <div className="pointer-events-none absolute bottom-0.5 left-1 z-10 flex h-5 w-5 items-center justify-center opacity-90">
          {teamCode && teamCode > 0 && !crestErrored ? (
            <Image
              src={CREST_URL(teamCode)}
              width={20}
              height={20}
              alt=""
              onError={() => setCrestErrored(true)}
              className="h-5 w-5 object-contain drop-shadow"
            />
          ) : teamShort ? (
            <span className="rounded-sm bg-zinc-900/30 px-1 font-mono text-[8px] font-bold uppercase tracking-wider">
              {teamShort}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
