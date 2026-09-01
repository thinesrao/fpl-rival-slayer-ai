import type { DeltaDistribution } from "@/lib/decision/simulate";

export type ActionKind = "roll" | "transfer" | "captain";

/**
 * "recommend" — an action's edge survived the model's own uncertainty.
 * "too-close" — nothing did; rolling is the honest answer.
 * "locked"    — the deadline has passed; there is nothing left to decide.
 * "unavailable" — we could not compute a verdict and will not guess.
 */
export type GateStatus = "recommend" | "too-close" | "locked" | "unavailable";

export interface Evidence {
  label: string;
  /** Must stay in sync with TabId in src/components/BottomNav.tsx. */
  tab: "squad" | "vs" | "coach" | "matches" | "collection";
  params?: Record<string, string>;
}

export interface Action {
  kind: ActionKind;
  headline: string;
  detail: string;
  overtakeDelta: DeltaDistribution;
  /** 0, or a negative points cost such as -4 for an extra transfer. */
  hitCost: number;
  evidence: Evidence[];
}

export interface Decision {
  verdict: Action;
  alternatives: Action[];
  deadline: { gw: number; iso: string; hoursRemaining: number };
  gateStatus: GateStatus;
  /** Human-readable reason, set when the gate is not "recommend". */
  note?: string;
}
