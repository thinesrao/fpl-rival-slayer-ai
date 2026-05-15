// Post-validation for AI news citations.
//
// Gemini's training data has player→club mappings frozen at its cutoff. Even
// with googleSearch grounding it sometimes fabricates a citation that asserts
// a player plays for their PRIOR club (e.g. "Calvert-Lewin starts for Everton"
// when he's since moved). FPL bootstrap data is authoritative for the current
// season — we use it here to drop stale citations and tag the survivors with
// the player's current club so the UI can show it.
//
// Heuristic for "stale":
//   1. Resolve the cited player's web_name to a current FplElement.
//   2. If their current team's `name` or `short_name` appears in the summary,
//      keep it (the AI got it right).
//   3. Otherwise, scan the summary for any OTHER PL team's `name`. If one is
//      mentioned, the citation is referring to the wrong club → drop.
//   4. If no team is mentioned at all (only the opponent, e.g. "starts vs
//      Newcastle"), we can't judge → keep, but don't tag a currentTeam.
//
// This is intentionally conservative: false negatives (a stale citation that
// happens not to mention any team) are acceptable; false positives (dropping
// a valid citation) would hurt user trust more.

import type { FplBootstrap } from "@/lib/types";
import { findElementByWebName } from "@/lib/projections/resolve-suggested";

export interface RawCitation {
  player: string;
  summary: string;
  source_url?: string;
}

export interface ValidatedCitation extends RawCitation {
  currentTeam?: { name: string; short: string };
}

export interface ValidationResult {
  kept: ValidatedCitation[];
  dropped: Array<{ citation: RawCitation; reason: string }>;
}

export function validateCitations(citations: RawCitation[], bs: FplBootstrap): ValidationResult {
  const kept: ValidatedCitation[] = [];
  const dropped: ValidationResult["dropped"] = [];

  for (const c of citations) {
    if (!c.player || !c.summary) {
      kept.push(c);
      continue;
    }
    const el = findElementByWebName(c.player, bs);
    if (!el) {
      // Unknown player — can't judge; keep but don't tag a team.
      kept.push(c);
      continue;
    }
    const playerTeam = bs.teams.find((t) => t.id === el.team);
    if (!playerTeam) {
      kept.push(c);
      continue;
    }

    const summaryLow = c.summary.toLowerCase();
    const ptNameLow = playerTeam.name.toLowerCase();
    const ptShortLow = playerTeam.short_name.toLowerCase();
    const playerTeamMentioned = summaryLow.includes(ptNameLow) || summaryLow.includes(ptShortLow);

    if (playerTeamMentioned) {
      kept.push({ ...c, currentTeam: { name: playerTeam.name, short: playerTeam.short_name } });
      continue;
    }

    // Player's team isn't mentioned. Does the summary name some OTHER PL team?
    let mismatch: string | null = null;
    for (const t of bs.teams) {
      if (t.id === playerTeam.id) continue;
      if (summaryLow.includes(t.name.toLowerCase())) {
        mismatch = t.name;
        break;
      }
    }

    if (mismatch) {
      dropped.push({
        citation: c,
        reason: `stale team reference: cites "${mismatch}" but ${el.web_name} now plays for ${playerTeam.name}`,
      });
    } else {
      // No team named at all — likely talks only about form/availability.
      // Keep with current-team annotation so the user sees the ground truth.
      kept.push({ ...c, currentTeam: { name: playerTeam.name, short: playerTeam.short_name } });
    }
  }

  return { kept, dropped };
}
