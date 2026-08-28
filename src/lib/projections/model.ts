// Lightweight, transparent per-player expected-points (xP) model for the
// upcoming gameweek.
//
// projectPlayer adapts the live FPL bootstrap into the shared PlayerFeatures
// shape (via liveFeatures) and scores it through scorePlayer — the same
// scoring path the backtest harness uses. This keeps the live app and the
// harness on one code path, so the harness validates code that actually ships.
//
// The model is intentionally bounded and explainable — callers can show the
// breakdown to the user, and `PlayerProjection.notes` captures the human
// reasoning per player.

import type {
  FplBootstrap,
  FplElement,
  FplFixture,
  FplTeam,
  ManagerSquad,
  PlayerProjection,
  Position,
  SquadProjection,
  SquadSlot,
} from "@/lib/types";
import { liveFeatures } from "@/lib/projections/live-features";
import { scorePlayer } from "@/lib/projections/scoring";
import { estimateVariance } from "@/lib/projections/variance";

export interface ProjectPlayerArgs {
  player: FplElement;
  team: FplTeam;
  position: Position;
  fixtures: FplFixture[];
  gw: number;
  bs: FplBootstrap;
}

export function projectPlayer(args: ProjectPlayerArgs): PlayerProjection {
  const { player, team, position, fixtures, gw } = args;
  const features = liveFeatures({ player, team, position, fixtures, gw });
  const scored = scorePlayer(features);

  const notes: string[] = [];
  if (features.fixtureCount === 0) notes.push("Blank gameweek — no fixture");
  if (features.fixtureCount > 1) notes.push(`Double gameweek (${features.fixtureCount} matches)`);
  if (features.fdr <= 2) notes.push(features.isHome ? "Favourable home fixture" : "Favourable away fixture");
  if (features.fdr >= 4) notes.push(features.isHome ? "Tough home fixture" : "Tough away fixture");

  const chance = player.chance_of_playing_next_round;
  if (chance !== null && chance !== undefined && chance < 100) {
    notes.push(`Availability: ${chance}%${player.news ? ` — ${player.news}` : ""}`);
  } else if (player.status !== "a") {
    notes.push(`Status: ${player.status}${player.news ? ` — ${player.news}` : ""}`);
  }
  if (scored.components.defensiveContribution >= 0.5) {
    notes.push("Regular defensive-contribution threat");
  }

  return {
    playerId: player.id,
    webName: player.web_name,
    position,
    xPoints: Number(scored.xPoints.toFixed(2)),
    variance: Number(estimateVariance(position, scored.xPoints).toFixed(2)),
    injuryRisk: Number((1 - features.availability).toFixed(2)),
    fixtureDifficulty: Number(features.fdr.toFixed(1)),
    notes,
  };
}

export function projectSquad(
  squad: ManagerSquad,
  fixtures: FplFixture[],
  gw: number,
  bs: FplBootstrap,
): SquadProjection {
  const projections: Array<{ slot: SquadSlot; proj: PlayerProjection }> = squad.picks.map((slot) => ({
    slot,
    proj: projectPlayer({
      player: slot.player,
      team: slot.team,
      position: slot.position,
      fixtures,
      gw,
      bs,
    }),
  }));

  let startingXIPoints = 0;
  let benchPoints = 0;
  let totalVar = 0;

  for (const { slot, proj } of projections) {
    if (slot.pick.multiplier > 0) {
      startingXIPoints += proj.xPoints * slot.pick.multiplier;
      totalVar += proj.variance * Math.max(1, slot.pick.multiplier ** 2);
    } else {
      benchPoints += proj.xPoints;
    }
  }

  return {
    entryId: squad.entry.id,
    startingXIPoints: Number(startingXIPoints.toFixed(2)),
    benchPoints: Number(benchPoints.toFixed(2)),
    totalExpected: Number((startingXIPoints + benchPoints * 0.1).toFixed(2)),
    stdev: Number(Math.sqrt(totalVar).toFixed(2)),
    perPlayer: projections.map((p) => p.proj),
  };
}
