// The rule that decides whether the app is allowed to tell you to do something.
//
// Sub-project A measured this model at Spearman 0.155 against FPL's own xP at
// 0.529. Issuing a confident weekly instruction off a model that weak would
// spend the trust that measurement bought. So an action is recommended only
// when its whole 80% credible interval sits above zero — when the edge is
// larger than the noise in our own estimate of it.
//
// Most real FPL weeks have no such action, and saying so is the point.

import type { Action, GateStatus } from "@/lib/decision/types";

/** True when the action's 80% interval lies entirely above zero. */
export function clearsBar(action: Action): boolean {
  if (action.kind === "roll") return false;
  return action.overtakeDelta.lower80 > 0;
}

export function pickVerdict(
  roll: Action,
  candidates: Action[],
): { verdict: Action; alternatives: Action[]; gateStatus: GateStatus } {
  const ranked = [...candidates].sort((a, b) => b.overtakeDelta.mean - a.overtakeDelta.mean);
  const winner = ranked.find(clearsBar);

  if (!winner) {
    // Rolling wins. Keep the near-misses visible so a user who disagrees can
    // see exactly what was weighed and how close it came.
    return { verdict: roll, alternatives: ranked, gateStatus: "too-close" };
  }

  return {
    verdict: winner,
    alternatives: [...ranked.filter((a) => a !== winner), roll],
    gateStatus: "recommend",
  };
}
