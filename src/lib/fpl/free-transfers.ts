// Replays a manager's gameweek history to compute exactly how many free
// transfers they have entering the upcoming gameweek. The public FPL API
// doesn't expose this directly, so we derive it from the rules:
//
//   - You enter GW1 with 1 free transfer.
//   - Each GW you receive +1 FT, banked up to a maximum of 5.
//   - Each transfer you make in a GW deducts 1 FT. Beyond your FT count you
//     pay -4 per transfer (`event_transfers_cost > 0`).
//   - Wildcard played in GW N: unlimited transfers; FT resets to 1 entering N+1.
//   - Free Hit played in GW N: squad reverts; FT carries through as if the GW
//     had no transfers (FT entering N+1 == FT entering N, then +1).
//   - Bench Boost / Triple Captain do not affect FT.

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
      // WC: unlimited transfers don't deduct from bank, FT resets to 1 for next GW.
      ft = 1;
    } else if (chip === "freehit") {
      // FH: temporary squad — FT count carries through as if no GW happened,
      // and we still tick the weekly +1.
      ft = Math.min(FT_MAX, ft + 1);
    } else {
      // Normal GW: -event_transfers (floored at 0), then +1 for the next week.
      ft = Math.min(FT_MAX, Math.max(0, ft - g.event_transfers) + 1);
    }
    trace.push({ gw: g.event, transfers: g.event_transfers, chip, ftAfter: ft });
  }

  // Find the GW we are about to plan for: max completed event + 1, or 1 if none.
  const lastPlayed = played.length ? played[played.length - 1].event : 0;
  return { freeTransfers: ft, enteringGw: lastPlayed + 1, history: trace };
}
