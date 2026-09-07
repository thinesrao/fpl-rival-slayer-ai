// Composes candidate enumeration, the paired simulation and the rule into a
// single Decision. No AI call, no network — everything it needs is passed in,
// which is what makes it deterministic and cheap enough to run on every view.

import { captainCandidates, transferCandidates, type Candidate } from "@/lib/decision/candidates";
import { hashSeed } from "@/lib/decision/rng";
import { pickVerdict } from "@/lib/decision/rule";
import { type RivalTarget, simulateDelta } from "@/lib/decision/simulate";
import type { Action, Decision } from "@/lib/decision/types";
import type { TransferOption } from "@/lib/optimizer/transfer-options";
import type { ManagerSquad, SquadProjection } from "@/lib/types";

export interface DecideArgs {
  squad: ManagerSquad;
  userProjection: SquadProjection;
  rivals: Array<{ entryId: number; name: string; projection: SquadProjection; pointsBehind: number }>;
  transferOptions: TransferOption[];
  freeTransfers: number;
  deadline: { gw: number; iso: string };
  /** Injected so the verdict is a pure function of its inputs. */
  now: number;
  /** False when the model has too little history to project honestly. */
  minHistoryMet: boolean;
}

const MS_PER_HOUR = 3_600_000;

function rollAction(): Action {
  return {
    kind: "roll",
    headline: "Roll your transfer",
    detail: "Nothing available this week clears the noise in our own projections.",
    overtakeDelta: { mean: 0, lower80: 0, upper80: 0, perRival: [] },
    hitCost: 0,
    evidence: [{ label: "How your rivals are tracking", tab: "vs" }],
  };
}

export function decide(args: DecideArgs): Decision {
  const { squad, userProjection, rivals, transferOptions, freeTransfers, deadline, now, minHistoryMet } = args;

  const hoursRemaining = Number(((Date.parse(deadline.iso) - now) / MS_PER_HOUR).toFixed(1));
  const deadlineInfo = { gw: deadline.gw, iso: deadline.iso, hoursRemaining };
  const roll = rollAction();

  if (!Number.isFinite(hoursRemaining)) {
    return {
      verdict: roll,
      alternatives: [],
      deadline: deadlineInfo,
      gateStatus: "unavailable",
      note: "Could not read the deadline for this gameweek.",
    };
  }

  if (hoursRemaining <= 0) {
    return {
      verdict: roll,
      alternatives: [],
      deadline: deadlineInfo,
      gateStatus: "locked",
      note: `GW${deadline.gw} is locked in. Nothing left to decide until the next deadline.`,
    };
  }

  if (!minHistoryMet) {
    return {
      verdict: roll,
      alternatives: [],
      deadline: deadlineInfo,
      gateStatus: "unavailable",
      note: "Too little history this season for the model to project honestly yet.",
    };
  }

  // With no tracked rivals there is nobody to overtake, so fall back to a
  // single synthetic opponent at the user's own projected level: the delta
  // then measures whether an action raises the score at all.
  const targets: RivalTarget[] =
    rivals.length > 0
      ? rivals.map((r) => ({
          entryId: r.entryId,
          name: r.name,
          expected: r.projection.startingXIPoints,
          stdev: r.projection.stdev,
          pointsBehind: r.pointsBehind,
        }))
      : [
          {
            entryId: 0,
            name: "the field",
            expected: userProjection.startingXIPoints,
            stdev: userProjection.stdev,
            pointsBehind: 0,
          },
        ];

  const candidates: Candidate[] = [
    ...transferCandidates(transferOptions, userProjection, freeTransfers),
    ...captainCandidates(squad, userProjection),
  ];

  const seed = hashSeed("decision", deadline.gw, squad.entry.id);

  const actions: Action[] = candidates.map((c) => ({
    kind: c.kind,
    headline: c.headline,
    detail: c.detail,
    hitCost: c.hitCost,
    evidence: c.evidence,
    // Every candidate is simulated against the SAME draws, so the ranking between
    // them is a like-for-like comparison rather than a difference of independently
    // noisy estimates — the same reason simulateDelta pairs baseline against variant.
    overtakeDelta: simulateDelta({
      baseline: userProjection,
      variant: c.variant,
      rivals: targets,
      seed,
    }),
  }));

  const { verdict, alternatives, gateStatus } = pickVerdict(roll, actions);

  return {
    verdict,
    alternatives,
    deadline: deadlineInfo,
    gateStatus,
    note:
      gateStatus === "too-close"
        ? "No move this week beats doing nothing by more than our own margin of error."
        : undefined,
  };
}
