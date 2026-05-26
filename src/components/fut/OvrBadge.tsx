import { cn } from "@/lib/utils";
import { type Tier, tierGradientClass } from "@/lib/fut/tier";

interface Props {
  tier: Tier;
  ovr: number;
  size?: "sm" | "md";
  className?: string;
}

const SIZE = {
  sm: "h-6 px-2 text-[11px]",
  md: "h-7 px-2.5 text-sm",
} as const;

export function OvrBadge({ tier, ovr, size = "md", className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md font-display font-bold tracking-tight text-zinc-900 shadow-sm",
        tierGradientClass(tier),
        SIZE[size],
        className,
      )}
    >
      {ovr}
    </span>
  );
}
