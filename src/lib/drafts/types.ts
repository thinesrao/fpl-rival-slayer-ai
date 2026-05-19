// Squad-drafting types. Persisted to localStorage scoped by teamId.

export type Position = "GKP" | "DEF" | "MID" | "FWD";

export interface SquadDraft {
  id: string;
  name: string;
  /** Budget in tenths of millions (FPL convention). 1000 = £100m. */
  budget: number;
  /** Player IDs in slot order: GK1, GK2, DEF1..5, MID1..5, FWD1..3. */
  picks: (number | null)[];
  captainId: number | null;
  viceId: number | null;
  /** Optional starting XI for visualisation. If absent we auto-pick. */
  startingXI?: number[];
  /** Preferred formation (e.g. "4-4-2"). Auto-resolved if not yet set. */
  formation?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PickerPlayer {
  id: number;
  code: number;
  webName: string;
  team: string;
  teamCode: number;
  position: Position;
  /** Price in £m (decimal). */
  price: number;
  form: number;
  totalPoints: number;
  selectedByPct: number;
  status: string;
  news?: string;
  /** Next-GW opponent label (e.g. "MUN (H)"). null on a blank GW. */
  nextOpponent?: string | null;
}

/** FPL squad shape: 2 GK, 5 DEF, 5 MID, 3 FWD = 15. */
export const SLOTS: Position[] = [
  "GKP", "GKP",
  "DEF", "DEF", "DEF", "DEF", "DEF",
  "MID", "MID", "MID", "MID", "MID",
  "FWD", "FWD", "FWD",
];

export const SLOT_LABELS = SLOTS.map((p, i) => {
  const sameTypeBefore = SLOTS.slice(0, i).filter((s) => s === p).length;
  return `${p}${sameTypeBefore + 1}`;
});

export function emptyDraft(name: string): SquadDraft {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    budget: 1000,
    picks: Array(15).fill(null),
    captainId: null,
    viceId: null,
    createdAt: now,
    updatedAt: now,
  };
}
