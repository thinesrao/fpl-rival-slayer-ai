// POST /api/drafts/critique  { encoded: string }
//
// One-shot AI verdict on a squad draft. We don't need the full chat
// plumbing here — no history, no rival context, just the squad + the
// current bootstrap-static for player names, prices, and team
// strength. Returns markdown.

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { aiEnabled, env } from "@/lib/env";
import { FplError, getBootstrap, getFixtures, currentEvent } from "@/lib/fpl/client";
import { decodeDraft } from "@/lib/drafts/encode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  encoded: z.string().min(8).max(8000),
});

const POS_LABEL = ["?", "GKP", "DEF", "MID", "FWD"];

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
    return NextResponse.json({ error: "bad_draft", message: "Couldn't decode the draft payload." }, { status: 400 });
  }

  try {
    const bs = await getBootstrap();
    const event = currentEvent(bs);
    const gw = event?.id ?? 1;
    const fixtures = await getFixtures();
    const byId = new Map(bs.elements.map((e) => [e.id, e]));
    const teamShort = new Map(bs.teams.map((t) => [t.id, t.short_name]));

    // Compact, model-friendly squad summary.
    const lines = draft.p
      .map((id) => (id != null ? byId.get(id) : null))
      .filter((e): e is NonNullable<typeof e> => e != null)
      .map((e) => {
        const tag =
          e.id === draft.c ? " [CAPTAIN]" : e.id === draft.v ? " [VICE]" : "";
        const flag = e.status !== "a" ? ` [status:${e.status}${e.news ? ` "${e.news}"` : ""}]` : "";
        return `- ${POS_LABEL[e.element_type]} ${e.web_name} (${teamShort.get(e.team) ?? "?"}) £${(e.now_cost / 10).toFixed(1)}m · ${e.total_points} pts · form ${e.form ?? 0} · EO ${e.selected_by_percent ?? 0}%${tag}${flag}`;
      })
      .join("\n");

    const totalCost = draft.p.reduce<number>(
      (s, id) => s + (id != null ? byId.get(id)?.now_cost ?? 0 : 0),
      0,
    ) / 10;

    // Fixture overweight check — count next-3 GW fixtures per club among
    // squad members, surface clubs whose 3-fixture run is weakest.
    const nextThree = fixtures
      .filter((f) => !f.finished && f.event != null && f.event >= gw && f.event < gw + 3)
      .map((f) => ({
        event: f.event,
        home: f.team_h,
        away: f.team_a,
        difficulty_h: f.team_h_difficulty,
        difficulty_a: f.team_a_difficulty,
      }));
    const clubsInSquad = new Set<number>();
    for (const id of draft.p) {
      if (id == null) continue;
      const e = byId.get(id);
      if (e) clubsInSquad.add(e.team);
    }
    const fixtureLines: string[] = [];
    for (const tid of clubsInSquad) {
      const rows = nextThree
        .filter((f) => f.home === tid || f.away === tid)
        .map((f) => {
          const isHome = f.home === tid;
          const opp = isHome ? f.away : f.home;
          const diff = isHome ? f.difficulty_h : f.difficulty_a;
          return `${teamShort.get(opp) ?? "?"}${isHome ? "(H)" : "(A)"} d${diff}`;
        });
      if (rows.length) {
        fixtureLines.push(`  ${teamShort.get(tid)}: ${rows.join(", ")}`);
      }
    }

    const prompt = `You are an FPL strategist reviewing a manager's draft squad
for Gameweek ${gw}. Give a sharp, opinionated, no-fluff verdict. Use
markdown with short headings. Keep the whole response under 250 words.

Required sections (omit any that don't apply):
- **Verdict** — one-sentence overall take.
- **Strengths** — 2–3 bullets.
- **Weak spots** — 2–3 bullets. Be specific (named players, prices).
- **Fixture watch** — call out any 3-game runs that look soft or
  brutal based on the fixture difficulty data below.
- **One tweak** — the single change you'd make and the player to swap
  in (must be a real PL player at a reasonable price).

SQUAD (£${totalCost.toFixed(1)}m of £${(draft.b / 10).toFixed(1)}m budget):
${lines}

NEXT 3 GW FIXTURES for squad clubs:
${fixtureLines.join("\n") || "  (no upcoming fixtures available)"}

Be direct. Don't hedge.`;

    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.5,
        maxOutputTokens: 600,
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
