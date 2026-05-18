"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  code: number;
  name: string;
  /** Next-GW Fixture Difficulty Rating (1 easiest .. 5 hardest). Renders as a colored ring. */
  difficulty?: number;
  /** chance_of_playing_next_round (0..100) or `null`. <100 shows an amber/red corner dot. */
  chanceOfPlaying?: number | null;
  /** Visual size. */
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const SIZE_PX = { xs: 24, sm: 32, md: 40, lg: 56 } as const;

/** FPL FDR palette — matches the official site's color coding. */
function ringClass(fdr?: number) {
  if (!fdr) return "ring-border";
  if (fdr <= 1) return "ring-emerald-500";
  if (fdr === 2) return "ring-emerald-400";
  if (fdr === 3) return "ring-zinc-400";
  if (fdr === 4) return "ring-rose-500";
  return "ring-rose-700";
}

function injuryDot(chance: number | null | undefined) {
  if (chance == null || chance >= 100) return null;
  if (chance === 0) return "bg-rose-500"; // ruled out
  if (chance <= 50) return "bg-amber-400"; // major doubt
  if (chance < 100) return "bg-amber-200"; // minor doubt
  return null;
}

export function PlayerPhoto({ code, name, difficulty, chanceOfPlaying, size = "md", className }: Props) {
  const [errored, setErrored] = useState(false);
  const px = SIZE_PX[size];
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const dot = injuryDot(chanceOfPlaying);

  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-visible rounded-full ring-2",
        ringClass(difficulty),
        className,
      )}
      style={{ width: px, height: px }}
      title={name}
    >
      {errored || !code ? (
        <span
          className="flex h-full w-full items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
          aria-label={name}
        >
          {initials || "?"}
        </span>
      ) : (
        <Image
          src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${code}.png`}
          width={px}
          height={px}
          alt={name}
          onError={() => setErrored(true)}
          className="h-full w-full rounded-full bg-muted object-cover object-top"
        />
      )}
      {dot && (
        <span
          aria-hidden
          className={cn("absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background", dot)}
        />
      )}
    </div>
  );
}
