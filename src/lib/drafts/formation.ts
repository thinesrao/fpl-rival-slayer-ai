// Formation helpers. A "formation" describes the shape of the starting
// XI as DEF-MID-FWD counts (1 GK is implicit). All formations honour
// the FPL constraints: 1 GK, ≥3 DEF, ≥2 MID, ≥1 FWD, summing to 11.

import type { PickerPlayer, Position, SquadDraft } from "./types";

export type Formation = "3-4-3" | "3-5-2" | "4-3-3" | "4-4-2" | "4-5-1" | "5-3-2" | "5-4-1";

export const FORMATIONS: Formation[] = [
  "3-4-3",
  "3-5-2",
  "4-3-3",
  "4-4-2",
  "4-5-1",
  "5-3-2",
  "5-4-1",
];

export interface FormationShape {
  GKP: number;
  DEF: number;
  MID: number;
  FWD: number;
}

export function parseFormation(f: Formation): FormationShape {
  const [d, m, w] = f.split("-").map((n) => parseInt(n, 10));
  return { GKP: 1, DEF: d, MID: m, FWD: w };
}

/** Pick the best starting XI from a squad for a given formation,
 *  ranking by totalPoints (a reasonable proxy in the absence of xP).
 *  Falls back to whatever fits if the squad is incomplete. */
export function pickStartingXI(
  draft: SquadDraft,
  byId: Map<number, PickerPlayer>,
  formation: Formation,
): number[] {
  const shape = parseFormation(formation);
  const byPos: Record<Position, PickerPlayer[]> = { GKP: [], DEF: [], MID: [], FWD: [] };
  for (const id of draft.picks) {
    if (id == null) continue;
    const p = byId.get(id);
    if (!p) continue;
    byPos[p.position].push(p);
  }
  for (const pos of Object.keys(byPos) as Position[]) {
    byPos[pos].sort((a, b) => b.totalPoints - a.totalPoints);
  }
  const xi: number[] = [];
  (Object.keys(shape) as Position[]).forEach((pos) => {
    const n = shape[pos];
    xi.push(...byPos[pos].slice(0, n).map((p) => p.id));
  });
  return xi;
}

/**
 * The XI to render for a draft: keep whatever starting XI the draft already
 * carries (a squad seeded from FPL brings the manager's own bench order with
 * it) and only auto-pick the slots it can't account for.
 *
 * A stored XI goes stale as soon as the user transfers someone out or changes
 * formation, so each position is trimmed to the formation's shape and any
 * shortfall is filled from the remaining picks by totalPoints — a repair
 * rather than a re-derivation, so one transfer doesn't reshuffle the XI.
 */
export function resolveStartingXI(
  draft: SquadDraft,
  byId: Map<number, PickerPlayer>,
  formation: Formation,
): number[] {
  const stored = draft.startingXI;
  if (!stored || stored.length === 0) return pickStartingXI(draft, byId, formation);

  const shape = parseFormation(formation);
  const inSquad = new Set(draft.picks.filter((id): id is number => id != null));

  const kept: Record<Position, number[]> = { GKP: [], DEF: [], MID: [], FWD: [] };
  const seen = new Set<number>();
  for (const id of stored) {
    if (!inSquad.has(id) || seen.has(id)) continue;
    const p = byId.get(id);
    if (!p) continue;
    if (kept[p.position].length >= shape[p.position]) continue;
    kept[p.position].push(id);
    seen.add(id);
  }

  // Fill any shortfall from the bench, best first.
  const spare: Record<Position, PickerPlayer[]> = { GKP: [], DEF: [], MID: [], FWD: [] };
  for (const id of inSquad) {
    if (seen.has(id)) continue;
    const p = byId.get(id);
    if (p) spare[p.position].push(p);
  }
  const xi: number[] = [];
  for (const pos of ["GKP", "DEF", "MID", "FWD"] as Position[]) {
    spare[pos].sort((a, b) => b.totalPoints - a.totalPoints);
    const short = shape[pos] - kept[pos].length;
    const fill = short > 0 ? spare[pos].slice(0, short).map((p) => p.id) : [];
    xi.push(...kept[pos], ...fill);
  }
  return xi;
}

/** Given a squad and chosen XI, return the bench (non-starting picks). */
export function bench(draft: SquadDraft, xi: number[]): number[] {
  return draft.picks.filter((id): id is number => id != null && !xi.includes(id));
}

/** Best-effort: pick the largest formation that the current squad can
 *  legally start, preferring the user-configured one. */
export function safeFormation(
  draft: SquadDraft,
  byId: Map<number, PickerPlayer>,
  preferred?: Formation,
): Formation {
  const counts: FormationShape = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const id of draft.picks) {
    if (id == null) continue;
    const p = byId.get(id);
    if (p) counts[p.position]++;
  }
  const canStart = (f: Formation) => {
    const s = parseFormation(f);
    return counts.GKP >= s.GKP && counts.DEF >= s.DEF && counts.MID >= s.MID && counts.FWD >= s.FWD;
  };
  if (preferred && canStart(preferred)) return preferred;
  return FORMATIONS.find(canStart) ?? "4-4-2";
}
