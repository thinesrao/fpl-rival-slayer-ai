// Shared shape for "pre-fill a SquadDraft from a real FPL squad".
//
// Two routes produce one: /api/my-squad-draft-seed reads the last gameweek
// whose picks the public API will serve, and /api/my-team reads the squad the
// manager has saved for the *upcoming* deadline (wildcard drafts included),
// which needs their own login. Both hand the client the same object so the
// Drafts panel doesn't care which one it called.

import type { Position } from "./types";

/** Slot capacity per position — an FPL squad is always 2/5/5/3. */
const CAPACITY: Record<1 | 2 | 3 | 4, number> = { 1: 2, 2: 5, 3: 5, 4: 3 };

const POSITIONS: Record<1 | 2 | 3 | 4, Position> = {
  1: "GKP",
  2: "DEF",
  3: "MID",
  4: "FWD",
};

export interface SeedPick {
  elementId: number;
  /** FPL slot number: 1..11 are the starting XI, 12..15 the bench in autosub order. */
  position: number;
  isCaptain: boolean;
  isVice: boolean;
  /** Tenths of a million. Selling price where we know it, else now_cost. */
  value: number;
}

export interface SeedPlayer {
  id: number;
  webName: string;
  position: Position;
  isStarter: boolean;
}

/** Where the squad came from — the client uses this to label the draft. */
export type SeedSource = "confirmed" | "pending" | "suggested";

export interface DraftSeed {
  /** The gameweek this squad is for. */
  gw: number;
  bank: number;
  squadValue: number;
  /** Spendable cap = bank + squad value. */
  budget: number;
  /** Player IDs in SquadDraft slot order: GK1, GK2, DEF1..5, MID1..5, FWD1..3. */
  picks: (number | null)[];
  captainId: number | null;
  viceId: number | null;
  startingXI: number[];
  formation: string;
  /** "wildcard", "freehit", … when a chip is active on this squad. */
  activeChip: string | null;
  /**
   * "confirmed" — the deadline has passed and this is what the public API
   * serves. "pending" — read from the manager's own account before the
   * deadline, so it can still change. "suggested" — nobody owns this squad;
   * the optimiser built it.
   */
  source: SeedSource;
  summary: SeedPlayer[];
}

export interface BuildDraftSeedArgs {
  gw: number;
  /** Tenths of a million. */
  bank: number;
  picks: SeedPick[];
  elementTypeById: Map<number, number>;
  webNameById: Map<number, string>;
  activeChip: string | null;
  source: SeedSource;
}

/**
 * Reshape a real FPL squad into the slot-ordered draft the editor expects.
 *
 * Within each position group we keep FPL's own slot order, so the bench a
 * manager set (slots 12..15) survives the round trip instead of being
 * re-derived from form or total points.
 */
export function buildDraftSeed(args: BuildDraftSeedArgs): DraftSeed {
  const { gw, bank, picks, elementTypeById, webNameById, activeChip, source } = args;

  const groups: Record<1 | 2 | 3 | 4, SeedPick[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const pick of picks) {
    const etype = elementTypeById.get(pick.elementId);
    if (etype !== 1 && etype !== 2 && etype !== 3 && etype !== 4) continue;
    groups[etype].push(pick);
  }

  const ordered: Array<{ pick: SeedPick; etype: 1 | 2 | 3 | 4 }> = [];
  for (const etype of [1, 2, 3, 4] as const) {
    const slots = [...groups[etype]].sort((a, b) => a.position - b.position);
    for (const pick of slots.slice(0, CAPACITY[etype])) ordered.push({ pick, etype });
  }

  const draftPicks: (number | null)[] = ordered.map(({ pick }) => pick.elementId);
  // Pad to 15 if the account returned a partial squad (pre-season, say).
  while (draftPicks.length < 15) draftPicks.push(null);

  const isStarter = (p: SeedPick) => p.position <= 11;
  const squadValue = ordered.reduce((sum, { pick }) => sum + pick.value, 0);

  const counts = { DEF: 0, MID: 0, FWD: 0 };
  for (const { pick, etype } of ordered) {
    if (!isStarter(pick)) continue;
    if (etype === 2) counts.DEF++;
    if (etype === 3) counts.MID++;
    if (etype === 4) counts.FWD++;
  }

  return {
    gw,
    bank,
    squadValue,
    budget: bank + squadValue,
    picks: draftPicks,
    captainId: ordered.find(({ pick }) => pick.isCaptain)?.pick.elementId ?? null,
    viceId: ordered.find(({ pick }) => pick.isVice)?.pick.elementId ?? null,
    startingXI: ordered.filter(({ pick }) => isStarter(pick)).map(({ pick }) => pick.elementId),
    formation: `${counts.DEF}-${counts.MID}-${counts.FWD}`,
    activeChip,
    source,
    summary: ordered.map(({ pick, etype }) => ({
      id: pick.elementId,
      webName: webNameById.get(pick.elementId) ?? `#${pick.elementId}`,
      position: POSITIONS[etype],
      isStarter: isStarter(pick),
    })),
  };
}
