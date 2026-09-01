// Monte-Carlo overtake probability: simulate a single gameweek a few thousand
// times by sampling each squad's score from a Normal centered on its starting-XI
// expected points with std-dev = projected stdev. The overtake probability is
// the fraction of simulations where the user's GW total beats the rival's.
//
// We then *also* check whether the simulated score gap is enough to close the
// real-world standings gap (`pointsBehind`), since the user's goal is to leap
// the rival in the table, not merely outscore them in a single GW.

import { normalSampler } from "@/lib/decision/rng";
import type { OvertakeOdds, RivalContext, SquadProjection } from "@/lib/types";

export function computeOvertakeOdds(
  ctx: RivalContext,
  userProj: SquadProjection,
  rivalProjs: SquadProjection[],
  simulations = 2000,
  rng: () => number = Math.random,
): OvertakeOdds[] {
  const sample = normalSampler(rng);
  const odds: OvertakeOdds[] = [];

  for (let i = 0; i < ctx.rivals.length; i++) {
    const rival = ctx.rivals[i];
    const rivalProj = rivalProjs[i];
    if (!rivalProj) continue;

    const pointsBehind = Math.max(0, rival.entry.total - ctx.user.entry.total);
    let beats = 0;
    let leaps = 0;

    for (let s = 0; s < simulations; s++) {
      const userScore = sample(userProj.startingXIPoints, Math.max(1, userProj.stdev));
      const rivalScore = sample(rivalProj.startingXIPoints, Math.max(1, rivalProj.stdev));
      if (userScore > rivalScore) beats++;
      if (userScore - rivalScore > pointsBehind) leaps++;
    }

    odds.push({
      rivalEntryId: rival.entry.id,
      rivalName: rival.entry.name,
      rivalRank: rival.entry.rank,
      userExpected: userProj.startingXIPoints,
      rivalExpected: rivalProj.startingXIPoints,
      expectedDelta: Number((userProj.startingXIPoints - rivalProj.startingXIPoints).toFixed(2)),
      // We report the *table-leap* probability, since that's the actual goal.
      // If the user is already ahead this collapses to "P(stay ahead)" via beats.
      overtakeProbability: Number(((pointsBehind === 0 ? beats : leaps) / simulations).toFixed(3)),
      pointsBehind,
    });
  }

  return odds;
}
