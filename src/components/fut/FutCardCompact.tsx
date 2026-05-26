"use client";

import { cn } from "@/lib/utils";
import {
  type Tier,
  tierGradientClass,
  tierShadowClass,
} from "@/lib/fut/tier";
import { OvrBadge } from "./OvrBadge";

export interface FutCardCompactProps {
  tier: Tier;
  ovr: number;
  position?: string;
  name: string;
  sub?: string;
  /** Right-edge slot — typically a stat (e.g., GW points). */
  trailing?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function FutCardCompact({
  tier,
  ovr,
  position,
  name,
  sub,
  trailing,
  active,
  onClick,
  className,
}: FutCardCompactProps) {
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
        "relative flex h-14 items-center gap-3 overflow-hidden rounded-lg border border-card-edge bg-card pl-1.5 pr-3 transition-colors",
        interactive && "cursor-pointer hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && cn("ring-1", tierShadowClass(tier)),
        className,
      )}
    >
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-md text-zinc-900",
          tierGradientClass(tier),
        )}
      >
        <span className="font-display text-lg font-extrabold leading-none tabular-nums">
          {ovr}
        </span>
        {position && (
          <span className="mt-0.5 font-mono text-[8px] font-bold tracking-wider leading-none">
            {position.toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">
        {initials(name)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-sm font-bold uppercase tracking-tight">
          {name}
        </div>
        {sub && (
          <div className="truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {sub}
          </div>
        )}
      </div>

      {trailing && (
        <div className="shrink-0 text-right">
          {typeof trailing === "string" || typeof trailing === "number" ? (
            <OvrBadge tier={tier} ovr={Number(trailing)} size="sm" />
          ) : (
            trailing
          )}
        </div>
      )}
    </div>
  );
}
