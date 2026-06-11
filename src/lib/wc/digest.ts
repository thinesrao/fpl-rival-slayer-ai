// The anti-stale-LLM layer: a compact plain-text digest of live tournament +
// squad state injected into every coach/chat prompt so Gemini reasons from
// today's facts, not its training data.

import type { WcContext } from "./context";
import { isPreTournamentLock } from "./context";
import { displayName, roundLockTime } from "./fifa/client";
import type { WcPlayer } from "./fifa/types";
import { rulesDigest } from "./ai/prompts";
import type { WcSquadState } from "./squad/types";
import { recentDeltas } from "./snapshot";
import { BOOSTER_LABELS, type BoosterId } from "./rules/config";

export async function buildWcDigest(ctx: WcContext, squad: WcSquadState | null): Promise<string> {
  const lines: string[] = [];
  const round = ctx.active ?? ctx.target;
  const planning = ctx.target;

  lines.push(`TODAY: ${new Date().toISOString()}`);
  lines.push(rulesDigest(ctx.targetRules));
  lines.push(
    `ROUND STATE: planning for ${planning.stage} round ${planning.id} (locks ${roundLockTime(planning).toISOString()}).` +
      (ctx.active ? ` Round ${ctx.active.id} is LIVE.` : " No round currently live."),
  );
  if (isPreTournamentLock(ctx)) {
    lines.push(
      "PRE-DEADLINE (Matchday 1): the squad is NOT locked yet — the user can still change any number of " +
        "players, captain and bench freely at no cost. Transfer limits only begin after Round 1 locks.",
    );
  }

  // Kickoffs in order for the round in question — captain-rotation needs this.
  const matches = [...round.tournaments].sort((a, b) => a.date.localeCompare(b.date));
  if (matches.length > 0) {
    lines.push(`FIXTURES (kickoff order, round ${round.id}):`);
    for (const m of matches) {
      const score =
        m.homeScore != null && m.awayScore != null ? ` ${m.homeScore}-${m.awayScore}` : "";
      const state = m.period !== "pre_match" ? ` [${m.period}${m.minutes ? ` ${m.minutes}'` : ""}]` : "";
      lines.push(`  ${m.date} ${m.homeSquadAbbr ?? "TBD"} v ${m.awaySquadAbbr ?? "TBD"}${score}${state} @ ${m.venueCity ?? "?"}`);
    }
  }

  if (squad && squad.picks.length > 0) {
    const players = squad.picks
      .map((id) => ctx.playerById.get(id))
      .filter((p): p is WcPlayer => Boolean(p));
    lines.push(`USER SQUAD (${players.length}/15):`);
    for (const p of players) {
      const team = ctx.teamIndex.byId.get(p.squadId);
      const role =
        p.id === squad.captainId ? " (C)" : p.id === squad.viceId ? " (VC)" : "";
      const slot = squad.startingXI.includes(p.id) ? "XI" : "BENCH";
      const status = p.status !== "playing" ? ` STATUS:${p.status}` : "";
      lines.push(
        `  P${p.id} ${displayName(p)}${role} [${slot}] ${team?.abbr} ${p.position} $${p.price.toFixed(1)}m ` +
          `${p.stats.totalPoints}pts own${p.percentSelected.toFixed(1)}%${status}`,
      );
    }
    const used = Object.entries(squad.boostersUsed)
      .map(([b, r]) => `${BOOSTER_LABELS[b as BoosterId]} (round ${r})`)
      .join(", ");
    lines.push(`BOOSTERS USED: ${used || "none"}.`);
    if (squad.activeBooster) {
      lines.push(`BOOSTER ARMED THIS ROUND: ${BOOSTER_LABELS[squad.activeBooster.id]}.`);
    }
    const transfersThisRound = squad.transfersByRound[planning.id]?.length ?? 0;
    lines.push(`TRANSFERS MADE THIS ROUND: ${transfersThisRound}.`);
  } else {
    lines.push("USER SQUAD: not built yet.");
  }

  // Status/ownership deltas since the last snapshot (injuries surface here
  // even before news search does).
  const deltas = await recentDeltas(15);
  if (deltas.length > 0) {
    lines.push("RECENT OFFICIAL-FEED CHANGES (newest first):");
    for (const d of deltas) lines.push(`  ${d.at.slice(0, 16)} ${d.player}: ${d.detail}`);
  }

  // Form/ownership leaders give the model the meta at a glance.
  const active = ctx.players.filter((p) => p.status === "playing");
  const topOwned = [...active].sort((a, b) => b.percentSelected - a.percentSelected).slice(0, 12);
  lines.push(
    "MOST OWNED: " +
      topOwned
        .map((p) => `${displayName(p)} ${ctx.teamIndex.byId.get(p.squadId)?.abbr} ${p.percentSelected.toFixed(0)}%`)
        .join("; "),
  );
  const completed = ctx.rounds.filter((r) => r.status === "complete").length;
  if (completed > 0) {
    const topForm = [...active].sort((a, b) => b.stats.form - a.stats.form).slice(0, 12);
    lines.push(
      "BEST FORM: " +
        topForm.map((p) => `${displayName(p)} ${p.stats.form.toFixed(1)}`).join("; "),
    );
  }

  return lines.join("\n");
}
