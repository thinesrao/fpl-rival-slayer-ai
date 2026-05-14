// Captain ROI: compares the points the user *got* from their captain to the
// points they would have got with the best in-squad captain alternative.
//
// "Best alternative" is the starting-XI player with the highest base actual
// points (other than the captain). The cost reflects what the user left on
// the table by not captaining them.

import type { FplLive } from "@/lib/fpl/client";
import type { FplPicksResponse, ManagerSquad } from "@/lib/types";

export interface CaptainRoi {
  captainPlayerId: number | null;
  captainName: string;
  captainBase: number;
  captainMultiplier: number;
  bestPlayerId: number | null;
  bestName: string;
  bestBase: number;
  // What the user actually got from the captain slot (base × multiplier).
  captainPoints: number;
  // What they would have got captaining the best alternative.
  bestPoints: number;
  // Points left on the table (positive = sub-optimal pick).
  pointsCost: number;
  hindsightVerdict: string;
}

export function computeCaptainRoi(
  squad: ManagerSquad,
  finalPicks: FplPicksResponse,
  live: FplLive,
): CaptainRoi {
  const ptsById = new Map(live.elements.map((e) => [e.id, e.stats.total_points ?? 0]));
  const captainPick = finalPicks.picks.find((p) => p.multiplier >= 2);
  const captainSlot = captainPick
    ? squad.picks.find((s) => s.player.id === captainPick.element)
    : undefined;

  const startersByMult = new Map<number, number>(
    finalPicks.picks.filter((p) => p.multiplier > 0).map((p) => [p.element, p.multiplier]),
  );

  let best: { id: number; name: string; base: number } | null = null;
  for (const slot of squad.picks) {
    if (slot.player.id === captainPick?.element) continue;
    if (!startersByMult.has(slot.player.id)) continue;
    const base = ptsById.get(slot.player.id) ?? 0;
    if (!best || base > best.base) {
      best = { id: slot.player.id, name: slot.player.web_name, base };
    }
  }

  const captainBase = ptsById.get(captainPick?.element ?? 0) ?? 0;
  const captainMultiplier = captainPick?.multiplier ?? 2;
  const captainPoints = captainBase * captainMultiplier;
  const bestPoints = (best?.base ?? 0) * captainMultiplier;
  const pointsCost = Number((bestPoints - captainPoints).toFixed(2));

  let verdict: string;
  if (!captainPick || !captainSlot) {
    verdict = "No captain identified.";
  } else if (pointsCost <= 0) {
    verdict = `${captainSlot.player.web_name} was the optimal captain choice this GW.`;
  } else if (pointsCost <= 4) {
    verdict = `${captainSlot.player.web_name} was fine — ${best?.name} would have netted only ${pointsCost} more.`;
  } else {
    verdict = `Captaining ${best?.name} instead of ${captainSlot.player.web_name} would have added ${pointsCost} pts.`;
  }

  return {
    captainPlayerId: captainPick?.element ?? null,
    captainName: captainSlot?.player.web_name ?? "(none)",
    captainBase,
    captainMultiplier,
    bestPlayerId: best?.id ?? null,
    bestName: best?.name ?? "(no alternative)",
    bestBase: best?.base ?? 0,
    captainPoints,
    bestPoints,
    pointsCost,
    hindsightVerdict: verdict,
  };
}
