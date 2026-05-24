import { cn } from "@/lib/utils";
import { type Tier } from "@/lib/fut/tier";

interface Props {
  tier: Tier;
  /** 0..1 tear progress, used as a clip-path on the foil. */
  tear?: number;
  className?: string;
}

const TIER_FILL: Record<Tier, { from: string; to: string }> = {
  gold:   { from: "#fbbf24", to: "#b45309" },
  silver: { from: "#c8cdd4", to: "#54585e" },
  bronze: { from: "#d97757", to: "#5e3318" },
};

export function FutPack({ tier, tear = 0, className }: Props) {
  const fill = TIER_FILL[tier];
  const tearPct = Math.min(1, Math.max(0, tear));
  const clipTop = `inset(0 0 ${tearPct * 100}% 0)`;
  return (
    <div className={cn("relative", className)}>
      <svg viewBox="0 0 200 280" className="h-full w-full drop-shadow-2xl">
        <defs>
          <linearGradient id={`pack-${tier}`} x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor={fill.from} />
            <stop offset="100%" stopColor={fill.to} />
          </linearGradient>
          <linearGradient id={`pack-shine-${tier}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.5)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.2)" />
          </linearGradient>
        </defs>
        <rect x="6" y="6" width="188" height="268" rx="12" ry="12" fill={`url(#pack-${tier})`} />
        <rect x="6" y="6" width="188" height="268" rx="12" ry="12" fill={`url(#pack-shine-${tier})`} />
        {/* Foil seal (top half) — clipped away as tear progresses. */}
        <g style={{ clipPath: clipTop }}>
          <rect x="6" y="6" width="188" height="120" rx="12" ry="12" fill="rgba(255,255,255,0.18)" />
          <rect x="22" y="22" width="156" height="2" fill="rgba(0,0,0,0.18)" />
        </g>
        {/* Centre emblem */}
        <g transform="translate(100 140)">
          <circle r="42" fill="rgba(0,0,0,0.18)" />
          <text
            x="0"
            y="6"
            textAnchor="middle"
            fontFamily="var(--font-display), sans-serif"
            fontWeight="800"
            fontSize="32"
            fill="rgba(255,255,255,0.92)"
          >
            FPL
          </text>
        </g>
        <text
          x="100"
          y="232"
          textAnchor="middle"
          fontFamily="var(--font-mono), monospace"
          fontSize="11"
          letterSpacing="2"
          fontWeight="700"
          fill="rgba(255,255,255,0.85)"
        >
          MANAGER PACK
        </text>
        <text
          x="100"
          y="252"
          textAnchor="middle"
          fontFamily="var(--font-mono), monospace"
          fontSize="9"
          letterSpacing="3"
          fill="rgba(0,0,0,0.55)"
        >
          {tier.toUpperCase()}
        </text>
      </svg>
    </div>
  );
}
