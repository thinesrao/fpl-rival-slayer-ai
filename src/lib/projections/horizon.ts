// Multi-GW projection horizon: produces per-GW SquadProjection for the user
// and every rival across N upcoming GWs. Used by the Plan tab + the
// cumulative overtake odds (probability of leaping the table gap after N GWs).
//
// We re-use `projectSquad(squad, fixtures, gw)` per GW, fetching that
// gameweek's fixtures separately so blanks/doubles are handled correctly.
// The user's transfer state isn't simulated here — we project the *current*
// squad forward. A future transfer-aware horizon is left for later.

import { getFixtures } from "@/lib/fpl/client";
import type { FplBootstrap, FplFixture, RivalContext, SquadProjection } from "@/lib/types";
import { projectSquad } from "./model";
import type { OvertakeOdds } from "@/lib/types";
import { computeOvertakeOdds } from "./overtake";

export interface HorizonGw {
  gw: number;
  fixtures: FplFixture[];
  user: SquadProjection;
  rivals: SquadProjection[];
  overtake: OvertakeOdds[]; // single-GW overtake odds for this GW
}

export interface HorizonResult {
  horizon: HorizonGw[];
  // Probability the user has surpassed each rival's *current* table position
  // by the end of the horizon (i.e. cumulative score gap > pointsBehind).
  cumulative: Array<{
    rivalEntryId: number;
    rivalName: string;
    pointsBehind: number;
    userExpectedTotal: number;
    rivalExpectedTotal: number;
    expectedDelta: number;
    overtakeProbability: number;
  }>;
}

export async function buildHorizon(
  ctx: RivalContext,
  bs: FplBootstrap,
  fromGw: number,
  n: number,
): Promise<HorizonResult> {
  const gws = bs.events
    .filter((e) => e.id >= fromGw)
    .slice(0, Math.max(1, n))
    .map((e) => e.id);

  const horizon: HorizonGw[] = await Promise.all(
    gws.map(async (gw) => {
      const fixtures = await getFixtures(gw);
      const user = projectSquad(ctx.user, fixtures, gw);
      const rivals = ctx.rivals.map((r) => projectSquad(r, fixtures, gw));
      const overtake = computeOvertakeOdds(ctx, user, rivals);
      return { gw, fixtures, user, rivals, overtake };
    }),
  );

  const cumulative = computeCumulativeOvertake(ctx, horizon);
  return { horizon, cumulative };
}

function normalSample(mean: number, stdev: number): number {
  const u1 = Math.random() || 1e-12;
  const u2 = Math.random() || 1e-12;
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdev * z;
}

export function computeCumulativeOvertake(
  ctx: RivalContext,
  horizon: HorizonGw[],
  simulations = 5000,
): HorizonResult["cumulative"] {
  const out: HorizonResult["cumulative"] = [];

  for (let i = 0; i < ctx.rivals.length; i++) {
    const rival = ctx.rivals[i];
    const pointsBehind = Math.max(0, rival.entry.total - ctx.user.entry.total);

    const userPerGw = horizon.map((h) => ({ mean: h.user.startingXIPoints, stdev: Math.max(1, h.user.stdev) }));
    const rivalPerGw = horizon.map((h) => {
      const r = h.rivals[i];
      return { mean: r?.startingXIPoints ?? 0, stdev: Math.max(1, r?.stdev ?? 1) };
    });

    const userExpectedTotal = userPerGw.reduce((acc, g) => acc + g.mean, 0);
    const rivalExpectedTotal = rivalPerGw.reduce((acc, g) => acc + g.mean, 0);

    let leaps = 0;
    let beats = 0;
    for (let s = 0; s < simulations; s++) {
      let userSum = 0;
      let rivalSum = 0;
      for (let g = 0; g < userPerGw.length; g++) {
        userSum += normalSample(userPerGw[g].mean, userPerGw[g].stdev);
        rivalSum += normalSample(rivalPerGw[g].mean, rivalPerGw[g].stdev);
      }
      if (userSum > rivalSum) beats++;
      if (userSum - rivalSum > pointsBehind) leaps++;
    }

    out.push({
      rivalEntryId: rival.entry.id,
      rivalName: rival.entry.name,
      pointsBehind,
      userExpectedTotal: Number(userExpectedTotal.toFixed(2)),
      rivalExpectedTotal: Number(rivalExpectedTotal.toFixed(2)),
      expectedDelta: Number((userExpectedTotal - rivalExpectedTotal).toFixed(2)),
      overtakeProbability: Number(((pointsBehind === 0 ? beats : leaps) / simulations).toFixed(3)),
    });
  }

  return out;
}
