// Lightweight, transparent per-player expected-points (xP) model for the
// upcoming gameweek. This is *inspired* by daniegr/OpenFPL's feature set but
// implemented as a closed-form formula so it can run on the server inside a
// Next.js route handler without any ML runtime.
//
// xPts = minutesProb × (
//          basePts(position)
//        + xG90 × xMinutes × goalPts(position)
//        + xA90 × xMinutes × 3
//        + cleanSheetProb × csPts(position)
//        + bonusExpectation
//        + formBoost(form)
//      ) − fdrPenalty(opponent)
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

const GOAL_PTS: Record<Position, number> = { GKP: 6, DEF: 6, MID: 5, FWD: 4 };
const CS_PTS: Record<Position, number> = { GKP: 4, DEF: 4, MID: 1, FWD: 0 };
const BASE_APPEARANCE_PTS = 2; // 60+ minutes
const FDR_NEUTRAL = 3; // 1=easy, 5=hard

function numeric(x: string | number | null | undefined, fallback = 0): number {
  if (x === null || x === undefined) return fallback;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function clampUnit(n: number) {
  return Math.max(0, Math.min(1, n));
}

function minutesProbability(player: FplElement): number {
  // chance_of_playing_next_round is null for "fully fit" (treat as 100%).
  const chance = player.chance_of_playing_next_round;
  const chanceProb = chance === null ? 1 : chance / 100;
  // If a player has been getting near 90 starts per 90, weight up.
  const startsRatio = clampUnit(player.starts_per_90 ?? 1);
  return clampUnit(chanceProb * (0.5 + 0.5 * startsRatio));
}

function expectedMinutes(player: FplElement): number {
  const minutesProb = minutesProbability(player);
  // Use historical minutes share to estimate expected minutes when they play.
  // total minutes / games-equivalent → average; cap at 90.
  const avgPerStart = player.starts_per_90 > 0 ? 90 : 60; // proxy
  return Math.max(0, Math.min(90, minutesProb * avgPerStart));
}

function teamCleanSheetProb(fdr: number): number {
  // FDR 1 (easy) → 50% CS; 5 (hard) → 5%.
  const table: Record<number, number> = { 1: 0.5, 2: 0.35, 3: 0.22, 4: 0.12, 5: 0.05 };
  return table[fdr] ?? 0.2;
}

function fdrAttackMultiplier(fdr: number): number {
  // Lower FDR → easier opponent → more goals/assists.
  const table: Record<number, number> = { 1: 1.25, 2: 1.1, 3: 1.0, 4: 0.85, 5: 0.7 };
  return table[fdr] ?? 1.0;
}

function bonusExpectation(player: FplElement): number {
  // ICT index ~ proxy for bonus likelihood. Normalize: very rough.
  const ict = numeric(player.ict_index) / 100;
  return Math.min(1.5, ict);
}

function formBoost(player: FplElement): number {
  const form = numeric(player.form); // 0..~12
  // Translate form into a small additive boost (centered around recent pts/game).
  return Math.max(-0.5, Math.min(2.0, (form - 3.0) * 0.3));
}

function fixtureForTeam(
  fixtures: FplFixture[],
  teamId: number,
  gw: number,
): { fdr: number; isHome: boolean; opponent: number | null; doubleHeader: number } {
  const matching = fixtures.filter((f) => f.event === gw && (f.team_h === teamId || f.team_a === teamId));
  if (matching.length === 0) {
    // Blank gameweek for this team.
    return { fdr: 5, isHome: true, opponent: null, doubleHeader: 0 };
  }
  // For DGWs we just average; we still mark `doubleHeader` so the caller can
  // surface that in notes.
  const isHome = matching[0].team_h === teamId;
  const opponent = isHome ? matching[0].team_a : matching[0].team_h;
  const fdr =
    matching.reduce((acc, f) => acc + (f.team_h === teamId ? f.team_h_difficulty : f.team_a_difficulty), 0) /
    matching.length;
  return { fdr, isHome, opponent, doubleHeader: matching.length };
}

export interface ProjectPlayerArgs {
  player: FplElement;
  team: FplTeam;
  position: Position;
  fixtures: FplFixture[];
  gw: number;
  bs: FplBootstrap;
}

export function projectPlayer(args: ProjectPlayerArgs): PlayerProjection {
  const { player, team, position, fixtures, gw, bs } = args;
  const fixture = fixtureForTeam(fixtures, team.id, gw);

  const notes: string[] = [];
  if (fixture.opponent === null) {
    notes.push("Blank gameweek — no fixture");
  }
  if (fixture.doubleHeader > 1) {
    notes.push(`Double gameweek (${fixture.doubleHeader} matches)`);
  }
  if (player.chance_of_playing_next_round !== null && player.chance_of_playing_next_round < 100) {
    notes.push(
      `Availability: ${player.chance_of_playing_next_round}%${player.news ? ` — ${player.news}` : ""}`,
    );
  } else if (player.status !== "a") {
    notes.push(`Status: ${player.status}${player.news ? ` — ${player.news}` : ""}`);
  }

  const minProb = minutesProbability(player);
  const xMin = expectedMinutes(player);
  const minutesFactor = xMin / 90;

  const xG90 = numeric(player.expected_goals_per_90);
  const xA90 = numeric(player.expected_assists_per_90);
  const csProb = teamCleanSheetProb(fixture.fdr);
  const attMult = fdrAttackMultiplier(fixture.fdr);

  if (fixture.fdr <= 2) notes.push(fixture.isHome ? "Favourable home fixture" : "Favourable away fixture");
  if (fixture.fdr >= 4) notes.push(fixture.isHome ? "Tough home fixture" : "Tough away fixture");

  const goalsContribution = xG90 * minutesFactor * GOAL_PTS[position] * attMult * fixture.doubleHeader || 0;
  const assistsContribution = xA90 * minutesFactor * 3 * attMult * fixture.doubleHeader || 0;
  const cleanSheetContribution =
    position === "FWD" ? 0 : csProb * CS_PTS[position] * minutesFactor * fixture.doubleHeader;
  const appearance = BASE_APPEARANCE_PTS * minutesFactor * fixture.doubleHeader;
  const bonus = bonusExpectation(player) * minutesFactor * fixture.doubleHeader;
  const form = formBoost(player) * fixture.doubleHeader;

  const raw =
    minProb *
    (appearance + goalsContribution + assistsContribution + cleanSheetContribution + bonus + form);

  // Slight FDR penalty to keep tough fixtures pulled down even after attMult.
  const fdrPenalty = Math.max(0, (fixture.fdr - FDR_NEUTRAL) * 0.4);

  // Sanity floor/ceiling.
  const xPoints = Math.max(0, raw - fdrPenalty);

  // Variance scales with xPoints and unavailability; goalkeepers + defenders
  // are lower variance, attackers higher.
  const positionVar: Record<Position, number> = { GKP: 6, DEF: 7, MID: 10, FWD: 12 };
  const variance = positionVar[position] * Math.max(0.5, xPoints / 5) * (1 + (1 - minProb));

  const injuryRisk = 1 - minProb;

  // Suppress unused param warning — bootstrap reserved for future enrichment.
  void bs;

  return {
    playerId: player.id,
    webName: player.web_name,
    position,
    xPoints: Number(xPoints.toFixed(2)),
    variance: Number(variance.toFixed(2)),
    injuryRisk: Number(injuryRisk.toFixed(2)),
    fixtureDifficulty: Number(fixture.fdr.toFixed(1)),
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
