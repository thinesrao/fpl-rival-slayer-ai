export type Tier = "gold" | "silver" | "bronze";

const PCT_GOLD = 0.7;
const PCT_BRONZE = 0.3;

export function managerTier(
  rank: number,
  totalInLeague: number,
  isUser = false,
): Tier {
  if (isUser) return "gold";
  if (totalInLeague <= 0) return "silver";
  const pct = (totalInLeague - rank) / totalInLeague;
  if (pct >= PCT_GOLD) return "gold";
  if (pct < PCT_BRONZE) return "bronze";
  return "silver";
}

export function playerOvr(xPoints: number): number {
  const raw = Math.round(xPoints * 9);
  return Math.max(50, Math.min(99, raw));
}

export function managerOvr(rank: number, totalInLeague: number): number {
  if (totalInLeague <= 0) return 75;
  const pct = (totalInLeague - rank) / totalInLeague;
  const ovr = Math.round(50 + pct * 45);
  return Math.max(50, Math.min(95, ovr));
}

export function playerTier(ovr: number): Tier {
  if (ovr >= 80) return "gold";
  if (ovr >= 65) return "silver";
  return "bronze";
}

export function tierGradientClass(tier: Tier): string {
  switch (tier) {
    case "gold":
      return "bg-tier-gold";
    case "silver":
      return "bg-tier-silver";
    case "bronze":
      return "bg-tier-bronze";
  }
}

export function tierShadowClass(tier: Tier): string {
  switch (tier) {
    case "gold":
      return "shadow-fut-gold";
    case "silver":
      return "shadow-fut-silver";
    case "bronze":
      return "shadow-fut-bronze";
  }
}

export function tierTextClass(tier: Tier): string {
  switch (tier) {
    case "gold":
      return "text-fut-gold";
    case "silver":
      return "text-fut-silver";
    case "bronze":
      return "text-fut-bronze";
  }
}
