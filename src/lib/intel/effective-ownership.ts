// Mini-league effective ownership (EO) — the only ownership metric that
// matters for head-to-head rival hunting. Computed from the user + rival
// squads we already hydrate, plus the bootstrap for global ownership.
//
//   eoPct        = owners_in_pool / (1 + rivals)             [0-100]
//   captainEoPct = sum_of_multipliers / (1 + rivals) * 100    [0-300]
//                  (starter = 1, captain = 2, triple-captain = 3, bench = 0)
//   globalPct    = bootstrap selected_by_percent              [0-100]
//
// A player is a "true differential" if they have high captainEoPct rival-side
// but low user-side, or vice versa. We surface both views.

import type { ManagerSquad, RivalContext, SquadSlot } from "@/lib/types";
import type { FplBootstrap } from "@/lib/types";

export interface PlayerEo {
  playerId: number;
  webName: string;
  ownedByUser: boolean;
  ownedByRivalCount: number;
  userMultiplier: number; // 0/1/2/3
  rivalMultipliers: number[]; // one per rival (0/1/2/3)
  eoPct: number;
  captainEoPct: number;
  globalPct: number; // FPL-wide ownership
}

export type EoMap = Record<number, PlayerEo>;

function multiplierFor(slot: SquadSlot | undefined): number {
  return slot?.pick.multiplier ?? 0;
}

function findSlot(squad: ManagerSquad, playerId: number): SquadSlot | undefined {
  return squad.picks.find((s) => s.player.id === playerId);
}

export function computeEffectiveOwnership(ctx: RivalContext, bs: FplBootstrap): EoMap {
  const totalManagers = 1 + ctx.rivals.length;
  // Union of every player id appearing in any squad.
  const ids = new Set<number>();
  ctx.user.picks.forEach((s) => ids.add(s.player.id));
  ctx.rivals.forEach((r) => r.picks.forEach((s) => ids.add(s.player.id)));

  const bsById = new Map(bs.elements.map((p) => [p.id, p]));
  const out: EoMap = {};
  for (const id of ids) {
    const userSlot = findSlot(ctx.user, id);
    const ownedByUser = Boolean(userSlot);
    const userMultiplier = multiplierFor(userSlot);
    const rivalMultipliers = ctx.rivals.map((r) => multiplierFor(findSlot(r, id)));
    const rivalOwners = ctx.rivals.filter((r) => findSlot(r, id) !== undefined).length;
    const totalOwners = (ownedByUser ? 1 : 0) + rivalOwners;
    const sumMultipliers = userMultiplier + rivalMultipliers.reduce((a, b) => a + b, 0);
    const meta = bsById.get(id);
    out[id] = {
      playerId: id,
      webName: meta?.web_name ?? "?",
      ownedByUser,
      ownedByRivalCount: rivalOwners,
      userMultiplier,
      rivalMultipliers,
      eoPct: (totalOwners / totalManagers) * 100,
      captainEoPct: (sumMultipliers / totalManagers) * 100,
      globalPct: meta ? Number(meta.selected_by_percent) || 0 : 0,
    };
  }
  return out;
}

/** Find the players a rival owns + plays that the user does NOT have. These
 *  are the highest-leverage captain-EO threats — if a rival captains them and
 *  the user doesn't even own them, the rival gains 2x their points. */
export function rivalCaptainThreats(eo: EoMap): PlayerEo[] {
  return Object.values(eo)
    .filter((p) => !p.ownedByUser && p.captainEoPct >= 50)
    .sort((a, b) => b.captainEoPct - a.captainEoPct);
}

/** Players the user owns that the rivals do NOT — pure differential upside. */
export function userOnlyDifferentials(eo: EoMap): PlayerEo[] {
  return Object.values(eo)
    .filter((p) => p.ownedByUser && p.ownedByRivalCount === 0)
    .sort((a, b) => b.userMultiplier - a.userMultiplier);
}
