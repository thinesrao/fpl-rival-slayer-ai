// Server-side resolver that turns the AI's recommended squad (lists of
// web_name strings) into a slim, fully-typed payload the pitch view can
// render without fetching `bs.elements` on the client.
//
// Also re-exports a shared `opponentForTeam` helper (lifted from prompts.ts
// where it was private) so client code can show "LEE (A)"-style chips.

import type {
  FplBootstrap,
  FplElement,
  FplFixture,
  FplTeam,
  ManagerSquad,
  Position,
  SquadProjection,
} from "@/lib/types";
import { projectPlayer } from "@/lib/projections/model";
import type { AiRecommendation } from "@/lib/ai/gemini";

const POS_BY_ID: Record<number, Position> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

export interface ResolvedPlayer {
  webName: string;
  playerId: number; // -1 when the AI named someone we can't find in bs.elements
  teamId: number;
  teamShort: string;
  teamCode: number; // for the FPL kit-image URL
  elementType: 1 | 2 | 3 | 4;
  position: Position;
  cost: number; // tenths of £m
  xPoints: number;
  opponent: string | null; // e.g. "LEE (A)"; null on blank GW
  isCaptain: boolean;
  isVice: boolean;
  isIn: boolean; // appears in rec.transfers[].in AND not in user's current squad
}

export interface SuggestedSquadResolved {
  startingXi: ResolvedPlayer[];
  bench: ResolvedPlayer[];
  totalXp: number; // sum of starting XI xPts including captain × multiplier
  bank: number;
  freeTransfers: number;
  formation: string; // e.g. "3-4-3"
}

/** Return the opponent code (e.g. "BUR (H)") for `teamId` in `fixtures`. */
export function opponentForTeam(
  teamId: number,
  fixtures: FplFixture[],
  teamsById: Map<number, FplTeam>,
): string | null {
  const matching = fixtures.filter((f) => f.team_h === teamId || f.team_a === teamId);
  if (matching.length === 0) return null;
  return matching
    .map((f) => {
      const isHome = f.team_h === teamId;
      const opp = teamsById.get(isHome ? f.team_a : f.team_h);
      return `${opp?.short_name ?? "?"} (${isHome ? "H" : "A"})`;
    })
    .join(" + ");
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

function findElementByWebName(name: string, bs: FplBootstrap): FplElement | null {
  // Exact match first; common case.
  const exact = bs.elements.find((e) => e.web_name === name);
  if (exact) return exact;
  // Case-insensitive equality (AI sometimes casing-drifts).
  const lower = name.toLowerCase();
  const ci = bs.elements.find((e) => e.web_name.toLowerCase() === lower);
  if (ci) return ci;
  // Substring fuzzy match — e.g. AI says "Bruno F." while web_name is "Fernandes".
  const norm = normalize(name);
  if (norm.length < 3) return null;
  const fuzzy = bs.elements.find((e) => {
    const en = normalize(e.web_name);
    return en === norm || en.includes(norm) || norm.includes(en);
  });
  return fuzzy ?? null;
}

interface ResolveArgs {
  rec: AiRecommendation;
  user: ManagerSquad;
  userProjection: SquadProjection;
  bs: FplBootstrap;
  fixtures: FplFixture[];
  gw: number;
  bank: number;
  freeTransfers: number;
}

export function resolveSuggestedSquad(args: ResolveArgs): SuggestedSquadResolved {
  const { rec, user, userProjection, bs, fixtures, gw, bank, freeTransfers } = args;
  const teamsById = new Map(bs.teams.map((t) => [t.id, t]));
  const userIds = new Set(user.picks.map((s) => s.player.id));
  const xpByPlayerId = new Map(userProjection.perPlayer.map((p) => [p.playerId, p.xPoints]));

  const inNames = new Set(
    rec.transfers
      .map((t) => t.in)
      .filter((n): n is string => typeof n === "string" && n.length > 0)
      .map((n) => normalize(n)),
  );
  const captainNorm = normalize(rec.captain?.pick ?? "");
  const viceNorm = normalize(rec.captain?.vice ?? "");

  const resolveOne = (webName: string): ResolvedPlayer => {
    const el = findElementByWebName(webName, bs);
    if (!el) {
      return placeholder(webName);
    }
    const team = teamsById.get(el.team);
    const position = POS_BY_ID[el.element_type] ?? "MID";
    const elementType = (el.element_type as 1 | 2 | 3 | 4) || 3;

    // Reuse the cached XI projection for owned players; freshly project
    // unowned IN-players using the same model.
    let xPoints: number;
    if (userIds.has(el.id) && xpByPlayerId.has(el.id)) {
      xPoints = xpByPlayerId.get(el.id) ?? 0;
    } else if (team) {
      xPoints = projectPlayer({ player: el, team, position, fixtures, gw, bs }).xPoints;
    } else {
      xPoints = 0;
    }

    const normName = normalize(el.web_name);
    return {
      webName: el.web_name,
      playerId: el.id,
      teamId: el.team,
      teamShort: team?.short_name ?? "?",
      teamCode: team?.code ?? 0,
      elementType,
      position,
      cost: el.now_cost,
      xPoints: Number(xPoints.toFixed(1)),
      opponent: opponentForTeam(el.team, fixtures, teamsById),
      isCaptain: normName === captainNorm,
      isVice: normName === viceNorm,
      isIn: inNames.has(normName) && !userIds.has(el.id),
    };
  };

  const startingXi = (rec.starting_xi ?? []).map(resolveOne);
  // Sort by position to enforce GK → DEF → MID → FWD even if the AI drifted.
  startingXi.sort((a, b) => a.elementType - b.elementType);

  const bench = (rec.bench ?? []).map(resolveOne);
  // Bench autosub order: AI emits [outfield1, outfield2, outfield3, GK].
  // We trust that ordering — don't re-sort, just guarantee the GK is last
  // by moving any GK to the end if the AI mis-ordered.
  bench.sort((a, b) => {
    if (a.elementType === 1 && b.elementType !== 1) return 1;
    if (b.elementType === 1 && a.elementType !== 1) return -1;
    return 0;
  });

  const def = startingXi.filter((p) => p.elementType === 2).length;
  const mid = startingXi.filter((p) => p.elementType === 3).length;
  const fwd = startingXi.filter((p) => p.elementType === 4).length;
  const formation = `${def}-${mid}-${fwd}`;

  // Total xPts: captain multiplier = 2 (3 if triple-captain chip is active,
  // but the pitch reflects the recommended line-up not chip state — so 2 is
  // the right default for the header readout).
  let totalXp = 0;
  for (const p of startingXi) totalXp += p.xPoints * (p.isCaptain ? 2 : 1);

  return {
    startingXi,
    bench,
    totalXp: Number(totalXp.toFixed(1)),
    bank,
    freeTransfers,
    formation,
  };
}

function placeholder(webName: string): ResolvedPlayer {
  return {
    webName,
    playerId: -1,
    teamId: 0,
    teamShort: "?",
    teamCode: 0,
    elementType: 3,
    position: "MID",
    cost: 0,
    xPoints: 0,
    opponent: null,
    isCaptain: false,
    isVice: false,
    isIn: false,
  };
}
