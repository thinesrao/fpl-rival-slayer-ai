// Chip status + lightweight behaviour prediction for rivals (and the user).
//
// FPL gives each classic manager: 2 × Wildcard (one per half-season), 1 × Free
// Hit, 1 × Bench Boost, 1 × Triple Captain. `entry/{id}/history/.chips` lists
// what's been used. We can infer the rest.
//
// Behaviour hint heuristic (intentionally simple, no Gemini call):
//   - If the rival has Bench Boost left AND there's a DGW within the next
//     3 GWs whose teams overlap their squad heavily → "BB likely in DGW N".
//   - If Free Hit left AND there's a blank-heavy GW within 3 GWs → "FH likely
//     in BGW N".
//   - If Triple Captain left AND their captain has a DGW → "TC candidate".
//   - Otherwise → "holding chips".

import type {
  FplBootstrap,
  FplFixture,
  ManagerSquad,
} from "@/lib/types";
import type { FplEntryHistory } from "@/lib/fpl/client";

export type ChipName = "wildcard" | "wildcard2" | "freehit" | "bboost" | "3xc";

export interface ChipStatus {
  used: Array<{ chip: ChipName; gw: number }>;
  remaining: ChipName[]; // chips the manager hasn't used yet
  hint: string;
  hintRisk: "low" | "medium" | "high";
}

const ALL_CHIPS: ChipName[] = ["wildcard", "wildcard2", "freehit", "bboost", "3xc"];

const CHIP_LABELS: Record<ChipName, string> = {
  wildcard: "WC1",
  wildcard2: "WC2",
  freehit: "FH",
  bboost: "BB",
  "3xc": "TC",
};

const HALF_SEASON_GW = 19; // GW19 deadline is the conventional cut-off for WC1.

export function chipLabel(c: ChipName): string {
  return CHIP_LABELS[c];
}

function normalizeChipName(raw: string, gw: number): ChipName {
  // FPL returns "wildcard" for both wildcards; we tag the second one based on
  // when it was used so the UI can distinguish them.
  if (raw === "wildcard") return gw <= HALF_SEASON_GW ? "wildcard" : "wildcard2";
  if (raw === "freehit") return "freehit";
  if (raw === "bboost") return "bboost";
  if (raw === "3xc") return "3xc";
  // Future-proof: any unknown chip falls under the generic wildcard bucket.
  return (raw as ChipName);
}

export interface AnalyseChipsArgs {
  history: FplEntryHistory | null;
  squad: ManagerSquad;
  bs: FplBootstrap;
  horizonFixtures: Array<{ gw: number; fixtures: FplFixture[] }>;
}

export function analyseChips(args: AnalyseChipsArgs): ChipStatus {
  const { history, squad, horizonFixtures } = args;

  const used: ChipStatus["used"] = [];
  for (const c of history?.chips ?? []) {
    used.push({ chip: normalizeChipName(c.name, c.event), gw: c.event });
  }
  // Distinguish WC1 vs WC2 even if FPL only sent "wildcard" twice.
  const wildcardUses = used.filter((u) => u.chip === "wildcard" || u.chip === "wildcard2");
  if (wildcardUses.length === 2) {
    wildcardUses.sort((a, b) => a.gw - b.gw);
    wildcardUses[0].chip = "wildcard";
    wildcardUses[1].chip = "wildcard2";
  }

  const usedSet = new Set(used.map((u) => u.chip));
  const remaining = ALL_CHIPS.filter((c) => !usedSet.has(c));

  // Lightweight behaviour hint.
  const userTeamIds = new Set(squad.picks.map((s) => s.team.id));
  let hint = "Holding remaining chips.";
  let hintRisk: ChipStatus["hintRisk"] = "low";

  for (const { gw, fixtures } of horizonFixtures) {
    if (fixtures.length === 0) continue;
    const teamFixtureCount = new Map<number, number>();
    for (const f of fixtures) {
      teamFixtureCount.set(f.team_h, (teamFixtureCount.get(f.team_h) ?? 0) + 1);
      teamFixtureCount.set(f.team_a, (teamFixtureCount.get(f.team_a) ?? 0) + 1);
    }
    let doubles = 0;
    let blanks = 0;
    for (const tid of userTeamIds) {
      const c = teamFixtureCount.get(tid) ?? 0;
      if (c > 1) doubles++;
      if (c === 0) blanks++;
    }
    if (doubles >= 5 && remaining.includes("bboost")) {
      hint = `Bench Boost candidate in GW${gw} (≥${doubles} doubled teams in squad).`;
      hintRisk = "high";
      break;
    }
    if (doubles >= 3 && remaining.includes("3xc")) {
      hint = `Triple Captain risk in GW${gw} (multiple DGW players).`;
      hintRisk = hintRisk === "low" ? "medium" : hintRisk;
    }
    if (blanks >= 4 && remaining.includes("freehit")) {
      hint = `Free Hit candidate in GW${gw} (≥${blanks} blanked teams in squad).`;
      hintRisk = "high";
      break;
    }
  }

  return { used, remaining, hint, hintRisk };
}
