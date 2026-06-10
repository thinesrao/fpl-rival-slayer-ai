// FIFA World Cup 2026™ Fantasy rules, encoded per phase. Source: the official
// game guidelines (play.fifa.com/fantasy/help/guidelines) as documented by
// community rule guides, May–June 2026. Single source of truth — the
// validators, optimizer, and AI prompts all read from here.

import type { WcRound } from "@/lib/wc/fifa/types";

export type WcPhase =
  | "GROUP_MD1"
  | "GROUP_MD2"
  | "GROUP_MD3"
  | "R32"
  | "R16"
  | "QF"
  | "SF"
  | "FINAL";

export type BoosterId =
  | "wildcard"
  | "twelfth_man"
  | "max_captain"
  | "qualification"
  | "mystery";

export const BOOSTER_LABELS: Record<BoosterId, string> = {
  wildcard: "Wildcard",
  twelfth_man: "12th Man",
  max_captain: "Maximum Captain",
  qualification: "Qualification Booster",
  mystery: "Mystery Booster",
};

export interface WcRoundRules {
  phase: WcPhase;
  /** rounds.json round id (1..8). */
  roundId: number;
  label: string;
  /** $m */
  budget: number;
  maxPerNation: number;
  /** Free transfers INTO this round. Pre-MD1 squad creation is unconstrained. */
  freeTransfers: number;
  /** True for the R3-lock → R32-lock window (unlimited free transfers). */
  unlimitedTransferWindow: boolean;
  extraTransferPenalty: number;
  boostersAllowed: BoosterId[];
}

export const SQUAD_SHAPE = { GK: 2, DEF: 5, MID: 5, FWD: 3, total: 15 } as const;

/** Starting-XI formation bounds (min/max picked per position, 11 total). */
export const FORMATION_LIMITS = {
  GK: [1, 1],
  DEF: [3, 5],
  MID: [2, 5],
  FWD: [1, 3],
  starters: 11,
} as const;

const GROUP_BOOSTERS: BoosterId[] = ["wildcard", "twelfth_man", "max_captain"];
const KO_BOOSTERS: BoosterId[] = [
  "wildcard",
  "twelfth_man",
  "max_captain",
  "qualification",
  "mystery",
];

export const RULES_BY_PHASE: Record<WcPhase, WcRoundRules> = {
  GROUP_MD1: {
    phase: "GROUP_MD1",
    roundId: 1,
    label: "Matchday 1",
    budget: 100,
    maxPerNation: 3,
    freeTransfers: 2,
    unlimitedTransferWindow: false,
    extraTransferPenalty: -3,
    // Wildcard cannot be played in Round 1.
    boostersAllowed: ["twelfth_man", "max_captain"],
  },
  GROUP_MD2: {
    phase: "GROUP_MD2",
    roundId: 2,
    label: "Matchday 2",
    budget: 100,
    maxPerNation: 3,
    freeTransfers: 2,
    unlimitedTransferWindow: false,
    extraTransferPenalty: -3,
    boostersAllowed: GROUP_BOOSTERS,
  },
  GROUP_MD3: {
    phase: "GROUP_MD3",
    roundId: 3,
    label: "Matchday 3",
    budget: 100,
    maxPerNation: 3,
    freeTransfers: 2,
    unlimitedTransferWindow: false,
    extraTransferPenalty: -3,
    boostersAllowed: GROUP_BOOSTERS,
  },
  R32: {
    phase: "R32",
    roundId: 4,
    label: "Round of 32",
    budget: 105,
    maxPerNation: 3,
    freeTransfers: Infinity,
    unlimitedTransferWindow: true,
    extraTransferPenalty: 0,
    // Wildcard cannot be played in the R32 (transfers are unlimited anyway).
    boostersAllowed: ["twelfth_man", "max_captain", "qualification", "mystery"],
  },
  R16: {
    phase: "R16",
    roundId: 5,
    label: "Round of 16",
    budget: 105,
    maxPerNation: 4,
    freeTransfers: 4,
    unlimitedTransferWindow: false,
    extraTransferPenalty: -3,
    boostersAllowed: KO_BOOSTERS,
  },
  QF: {
    phase: "QF",
    roundId: 6,
    label: "Quarter-finals",
    budget: 105,
    maxPerNation: 5,
    freeTransfers: 4,
    unlimitedTransferWindow: false,
    extraTransferPenalty: -3,
    boostersAllowed: KO_BOOSTERS,
  },
  SF: {
    phase: "SF",
    roundId: 7,
    label: "Semi-finals",
    budget: 105,
    maxPerNation: 6,
    freeTransfers: 5,
    unlimitedTransferWindow: false,
    extraTransferPenalty: -3,
    boostersAllowed: KO_BOOSTERS,
  },
  FINAL: {
    phase: "FINAL",
    roundId: 8,
    label: "Final",
    budget: 105,
    maxPerNation: 8,
    freeTransfers: 6,
    unlimitedTransferWindow: false,
    extraTransferPenalty: -3,
    boostersAllowed: KO_BOOSTERS,
  },
};

const PHASE_BY_ROUND_ID: Record<number, WcPhase> = {
  1: "GROUP_MD1",
  2: "GROUP_MD2",
  3: "GROUP_MD3",
  4: "R32",
  5: "R16",
  6: "QF",
  7: "SF",
  8: "FINAL",
};

export function phaseForRoundId(roundId: number): WcPhase {
  return PHASE_BY_ROUND_ID[roundId] ?? "FINAL";
}

export function rulesForRound(round: Pick<WcRound, "id">): WcRoundRules {
  return RULES_BY_PHASE[phaseForRoundId(round.id)];
}
