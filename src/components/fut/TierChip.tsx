import { cn } from "@/lib/utils";
import type { Tier } from "@/lib/fut/tier";

interface Props {
  tier?: Tier;
  children: React.ReactNode;
  className?: string;
}

const TIER_BORDER: Record<Tier, string> = {
  gold: "border-fut-gold/60 text-fut-gold",
  silver: "border-fut-silver/60 text-fut-silver",
  bronze: "border-fut-bronze/60 text-fut-bronze",
};

export function TierChip({ tier = "silver", children, className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm border px-1.5 font-mono text-[10px] font-bold uppercase tracking-wider",
        TIER_BORDER[tier],
        className,
      )}
    >
      {children}
    </span>
  );
}
