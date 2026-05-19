// FPL-rule validation for a drafted squad: filled-slot counts, budget,
// captain/vice present, max-3-per-club. Returns a list of issues.

import type { PickerPlayer, SquadDraft } from "./types";

export interface DraftValidation {
  filled: number; // 0..15
  totalCost: number; // £m
  inBudget: boolean;
  captainSet: boolean;
  viceSet: boolean;
  clubViolations: Array<{ team: string; count: number }>;
  ok: boolean;
  errors: string[];
}

export function validateDraft(draft: SquadDraft, byId: Map<number, PickerPlayer>): DraftValidation {
  const players = draft.picks.map((id) => (id == null ? null : byId.get(id) ?? null));
  const filled = players.filter((p) => p != null).length;
  const totalCost = players.reduce((s, p) => s + (p?.price ?? 0), 0);
  const inBudget = totalCost <= draft.budget / 10;

  const clubCounts = new Map<string, number>();
  for (const p of players) {
    if (!p) continue;
    clubCounts.set(p.team, (clubCounts.get(p.team) ?? 0) + 1);
  }
  const clubViolations = [...clubCounts.entries()]
    .filter(([, n]) => n > 3)
    .map(([team, count]) => ({ team, count }));

  const captainSet = draft.captainId != null && draft.picks.includes(draft.captainId);
  const viceSet = draft.viceId != null && draft.viceId !== draft.captainId && draft.picks.includes(draft.viceId);

  const errors: string[] = [];
  if (filled < 15) errors.push(`${15 - filled} empty slot${filled === 14 ? "" : "s"}`);
  if (!inBudget) errors.push(`Over budget (£${totalCost.toFixed(1)}m / £${(draft.budget / 10).toFixed(1)}m)`);
  if (clubViolations.length > 0) {
    errors.push(
      `Max 3 per club: ${clubViolations.map((c) => `${c.team} ×${c.count}`).join(", ")}`,
    );
  }
  if (!captainSet) errors.push("No captain set");
  if (!viceSet) errors.push("No vice captain set");

  return {
    filled,
    totalCost,
    inBudget,
    captainSet,
    viceSet,
    clubViolations,
    ok: errors.length === 0,
    errors,
  };
}
