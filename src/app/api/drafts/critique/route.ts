// POST /api/drafts/critique  { encoded: string }
//
// One-shot AI verdict on a squad draft. Builds a structured snapshot
// (starting XI / bench split, captain + fixture, form leaders, injury
// flags, fixture squeeze) and asks Gemini for a punchy, opinionated
// markdown review. Returns markdown.

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { aiEnabled, env } from "@/lib/env";
import { FplError, getBootstrap, getFixtures, currentEvent } from "@/lib/fpl/client";
import { decodeDraft } from "@/lib/drafts/encode";
import type { FplElement } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  encoded: z.string().min(8).max(8000),
});

const POS_LABEL = ["?", "GKP", "DEF", "MID", "FWD"] as const;
type PosKey = "GKP" | "DEF" | "MID" | "FWD";

function fmtCurrency(tenths: number): string {
  return `£${(tenths / 10).toFixed(1)}m`;
}

/** Heuristic starting-XI picker: top 11 by (form × 0.4 + totalPoints × 0.01),
 *  respecting the largest legal formation that fits the squad. Mirrors the
 *  client's pickStartingXI semantics without the type translation overhead. */
function inferStartingXI(picks: FplElement[]): { xi: Set<number>; formation: string } {
  const byPos: Record<PosKey, FplElement[]> = { GKP: [], DEF: [], MID: [], FWD: [] };
  for (const p of picks) {
    const pos = POS_LABEL[p.element_type] as PosKey | "?";
    if (pos === "?") continue;
    byPos[pos].push(p);
  }
  const score = (p: FplElement) =>
    Number(p.form ?? 0) * 0.4 + (p.total_points ?? 0) * 0.01;
  for (const k of Object.keys(byPos) as PosKey[]) {
    byPos[k].sort((a, b) => score(b) - score(a));
  }

  // Pick formation: prefer 3-4-3/4-4-2/4-3-3 progressively until counts fit.
  const candidates: Array<{ name: string; def: number; mid: number; fwd: number }> = [
    { name: "4-4-2", def: 4, mid: 4, fwd: 2 },
    { name: "4-3-3", def: 4, mid: 3, fwd: 3 },
    { name: "3-4-3", def: 3, mid: 4, fwd: 3 },
    { name: "3-5-2", def: 3, mid: 5, fwd: 2 },
    { name: "4-5-1", def: 4, mid: 5, fwd: 1 },
    { name: "5-3-2", def: 5, mid: 3, fwd: 2 },
    { name: "5-4-1", def: 5, mid: 4, fwd: 1 },
  ];
  const fit = candidates.find(
    (c) => byPos.GKP.length >= 1 && byPos.DEF.length >= c.def && byPos.MID.length >= c.mid && byPos.FWD.length >= c.fwd,
  ) ?? candidates[0];

  const xi = new Set<number>();
  byPos.GKP.slice(0, 1).forEach((p) => xi.add(p.id));
  byPos.DEF.slice(0, fit.def).forEach((p) => xi.add(p.id));
  byPos.MID.slice(0, fit.mid).forEach((p) => xi.add(p.id));
  byPos.FWD.slice(0, fit.fwd).forEach((p) => xi.add(p.id));
  return { xi, formation: fit.name };
}

export async function POST(req: NextRequest) {
  if (!aiEnabled) {
    return NextResponse.json(
      { error: "ai_disabled", message: "GEMINI_API_KEY is not set." },
      { status: 503 },
    );
  }
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  }
  const draft = decodeDraft(parsed.data.encoded);
  if (!draft) {
    return NextResponse.json(
      { error: "bad_draft", message: "Couldn't decode the draft payload." },
      { status: 400 },
    );
  }

  try {
    const bs = await getBootstrap();
    const event = currentEvent(bs);
    const gw = event?.id ?? 1;
    const targetGw = gw + 1;
    const fixtures = await getFixtures();

    const byId = new Map(bs.elements.map((e) => [e.id, e]));
    const teamShort = new Map(bs.teams.map((t) => [t.id, t.short_name]));
    const teamStrength = new Map(
      bs.teams.map((t) => [t.id, Math.round((t.strength_overall_home + t.strength_overall_away) / 2)]),
    );

    const allPicks = draft.p
      .map((id) => (id != null ? byId.get(id) : null))
      .filter((e): e is FplElement => e != null);

    if (allPicks.length === 0) {
      return NextResponse.json(
        { error: "empty_squad", message: "Add some players before requesting a critique." },
        { status: 400 },
      );
    }

    const { xi, formation } = inferStartingXI(allPicks);

    // Per-team next-3 fixture run (used both in the prompt and for captain FDR).
    interface FxRow {
      event: number | null;
      home: number;
      away: number;
      dh: number;
      da: number;
    }
    const nextThree: FxRow[] = fixtures
      .filter((f) => !f.finished && f.event != null && f.event >= targetGw && f.event < targetGw + 3)
      .map((f) => ({
        event: f.event,
        home: f.team_h,
        away: f.team_a,
        dh: f.team_h_difficulty,
        da: f.team_a_difficulty,
      }));

    const fdrFor = (teamId: number): string => {
      const rows = nextThree.filter((f) => f.home === teamId || f.away === teamId);
      if (rows.length === 0) return "—";
      return rows
        .map((f) => {
          const isHome = f.home === teamId;
          const opp = isHome ? f.away : f.home;
          const d = isHome ? f.dh : f.da;
          return `${teamShort.get(opp) ?? "?"}${isHome ? "(H)" : "(A)"} d${d}`;
        })
        .join(", ");
    };

    // Build squad lines split into Starting XI then Bench.
    const lineFor = (e: FplElement) => {
      const role = e.id === draft.c ? " [CAPTAIN]" : e.id === draft.v ? " [VICE]" : "";
      const flag =
        e.status !== "a"
          ? ` ⚠️ ${e.status === "d" ? "doubtful" : e.status === "i" ? "injured" : e.status === "s" ? "suspended" : e.status === "n" ? "ineligible" : e.status === "u" ? "unavailable" : e.status}` +
            (e.news ? ` (${e.news})` : "")
          : "";
      return `- ${POS_LABEL[e.element_type]} ${e.web_name} (${teamShort.get(e.team) ?? "?"}) · ${fmtCurrency(e.now_cost)} · ${e.total_points}pts · form ${Number(e.form ?? 0).toFixed(1)} · ${e.selected_by_percent ?? 0}% EO${role}${flag}`;
    };

    const xiLines = allPicks.filter((p) => xi.has(p.id)).map(lineFor).join("\n");
    const benchLines = allPicks.filter((p) => !xi.has(p.id)).map(lineFor).join("\n");

    const totalCost = allPicks.reduce((s, e) => s + e.now_cost, 0);
    const xiFormCount = allPicks.filter((p) => xi.has(p.id) && Number(p.form ?? 0) >= 5).length;
    const formLeaders = [...allPicks]
      .sort((a, b) => Number(b.form ?? 0) - Number(a.form ?? 0))
      .slice(0, 3)
      .map((e) => `${e.web_name} (${Number(e.form ?? 0).toFixed(1)})`)
      .join(", ");
    const lowOwnership = allPicks
      .filter((p) => xi.has(p.id))
      .filter((p) => Number(p.selected_by_percent ?? 100) < 5)
      .map((p) => `${p.web_name} ${p.selected_by_percent}%`);
    const injuryFlags = allPicks
      .filter((p) => p.status !== "a")
      .map((p) => `${p.web_name} [${p.status}]`);

    // Captain context: next fixture difficulty.
    const captain = draft.c != null ? byId.get(draft.c) : null;
    const vice = draft.v != null ? byId.get(draft.v) : null;
    const captainContext = captain
      ? `${captain.web_name} (${teamShort.get(captain.team)}) — next 3: ${fdrFor(captain.team)} · season ${captain.total_points}pts · form ${Number(captain.form ?? 0).toFixed(1)}`
      : "NOT SET";
    const viceContext = vice ? `${vice.web_name} (${teamShort.get(vice.team)})` : "NOT SET";

    // Club fixture squeeze table.
    const clubsInSquad = new Set<number>();
    for (const p of allPicks) clubsInSquad.add(p.team);
    const fixtureBlock: string[] = [];
    for (const tid of clubsInSquad) {
      const picksFromClub = allPicks
        .filter((p) => p.team === tid)
        .map((p) => p.web_name)
        .join(", ");
      const sched = fdrFor(tid);
      const strength = teamStrength.get(tid) ?? 0;
      fixtureBlock.push(`  ${teamShort.get(tid)} (str ${strength}) — ${picksFromClub} — runs: ${sched}`);
    }

    const prompt = `You are an FPL strategist roasting a manager's draft squad for
Gameweek ${targetGw}. Read the squad carefully and give a sharp, opinionated,
specific verdict. No fluff, no generic advice — every bullet must name a
player, a price, or a fixture. Lead with personality. Be the friend
who tells the truth at the pub.

OUTPUT RULES
- Use markdown with the section headings below, in this exact order.
- Skip any section that genuinely has nothing to say (don't pad).
- Stay under 320 words total.
- Refer to players by their web_name as printed below.
- All prices in £m to one decimal (£8.5m).
- When you propose a swap, name a SPECIFIC real Premier League replacement
  and a defensible price band.
- Don't hedge ("could potentially maybe…"). Pick a side.

SECTIONS
**Verdict** — one line. Memorable. Optionally lean witty.
**Captain call** — is C the right pick for GW${targetGw}? Use the captain's next-3
  fixture difficulty and the vice as backup. Flag if you'd flip C and V.
**Strengths** — 2-3 bullets. Specific picks at specific prices.
**Weak spots** — 2-3 bullets. Name the players you don't trust and why
  (price, form, fixture, injury). Don't be vague.
**Bench risk** — does the bench cover autosubs? Call out any flagged or
  rotation-prone sub.
**Fixture squeeze** — clubs whose 3-GW run is brutal (most picks affected) or
  soft (heavy run advantage).
**The swap** — the single highest-ROI transfer. Format:
  "OUT: <name> £X.Xm  ·  IN: <name> £Y.Ym" then one sentence on why.
**GW${targetGw} range** — predict a low / mid / high net-points band (e.g.
  "45 / 62 / 78"). Acknowledge variance.

DRAFT META
- Name: ${draft.n}
- Formation (inferred): ${formation}
- Squad cost: ${fmtCurrency(totalCost)} of ${fmtCurrency(draft.b)} cap
- Captain: ${captainContext}
- Vice: ${viceContext}
- Form leaders: ${formLeaders}
- Low-EO starters (<5%): ${lowOwnership.length ? lowOwnership.join(", ") : "none"}
- Injury / availability flags: ${injuryFlags.length ? injuryFlags.join(", ") : "none"}
- Starters in form (≥5.0): ${xiFormCount}/11

STARTING XI
${xiLines}

BENCH (in order GK, 1st sub, 2nd, 3rd)
${benchLines}

NEXT 3 GW FIXTURES — by squad club (team strength 1=weak, 5=elite)
${fixtureBlock.join("\n") || "  (no upcoming fixtures available)"}

Now: roast it. Be specific. Be sharp. Pick sides.`;

    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.7,
        maxOutputTokens: 900,
      },
    });
    const text = response.text ?? "";
    if (!text.trim()) {
      return NextResponse.json({ error: "empty_response" }, { status: 502 });
    }
    return NextResponse.json({ markdown: text, model: env.GEMINI_MODEL });
  } catch (err) {
    if (err instanceof FplError) {
      return NextResponse.json({ error: "fpl_error", message: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "internal_error", message: msg }, { status: 500 });
  }
}
