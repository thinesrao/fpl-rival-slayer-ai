// Replays a manager's gameweek history to compute exactly how many free
// transfers they have entering the upcoming gameweek. The public FPL API
// doesn't expose this directly, so we derive it from the rules:
//
//   - You enter GW1 with 1 free transfer.
//   - Each normal GW the count is updated as:
//        next = min(5, max(0, current - transfers_used) + 1)
//   - Wildcard played in GW N: count resets to 1 entering GW N+1 (the weekly
//     +1 is consumed by the WC, no extra accumulation).
//   - Free Hit played in GW N: the gameweek is "frozen" for transfer-banking
//     purposes — the squad reverts and you do NOT receive the weekly +1.
//     Count entering GW N+1 == count entering GW N.
//   - Bench Boost / Triple Captain do not affect transfers; treated as normal.

import type { FplEntryHistory } from "@/lib/fpl/client";

const FT_MAX = 5;
const FT_AT_SEASON_START = 1;

export interface FreeTransfersResult {
  freeTransfers: number;       // count entering the upcoming GW
  enteringGw: number;          // the GW the count is valid for
  history: Array<{ gw: number; transfers: number; chip: string | null; ftAfter: number }>;
}

export function computeFreeTransfers(history: FplEntryHistory): FreeTransfersResult {
  const chipByGw = new Map(history.chips.map((c) => [c.event, c.name]));
  const played = [...history.current].sort((a, b) => a.event - b.event);

  let ft = FT_AT_SEASON_START;
  const trace: FreeTransfersResult["history"] = [];

  for (const g of played) {
    const chip = chipByGw.get(g.event) ?? null;
    if (chip === "wildcard") {
      // WC: unlimited transfers, no FT deduction, count resets to 1 next GW.
      ft = 1;
    } else if (chip === "freehit") {
      // FH: the GW is bypassed for FT-banking. Count entering next GW is
      // unchanged from entering this GW. No +1, no deduction.
      // (ft stays the same)
    } else {
      // Normal GW (or BB/TC which behave normally for FT).
      ft = Math.min(FT_MAX, Math.max(0, ft - g.event_transfers) + 1);
    }
    trace.push({ gw: g.event, transfers: g.event_transfers, chip, ftAfter: ft });
  }

  const lastPlayed = played.length ? played[played.length - 1].event : 0;
  return { freeTransfers: ft, enteringGw: lastPlayed + 1, history: trace };
}
