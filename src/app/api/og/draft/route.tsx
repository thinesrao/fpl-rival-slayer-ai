/* eslint-disable @next/next/no-img-element */
// Squad-draft share card. 1200x630, OG-friendly.
//   GET /api/og/draft?d=<base64-url-encoded SquadDraft>
//
// Pure server render: decodes the draft from the URL, joins against
// bootstrap-static for player metadata, and lays out a quick at-a-
// glance card the user can drop into a group chat.

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { getBootstrap } from "@/lib/fpl/client";
import { decodeDraft } from "@/lib/drafts/encode";

export const runtime = "nodejs";

const BG = "#0a0f1a";
const CARD = "#0f1626";
const BORDER = "#1f2a44";
const TEXT = "#e7ecf2";
const MUTED = "#8a93a8";
const EMERALD = "#10b981";
const ROSE = "#fb7185";
const AMBER = "#f59e0b";

const POS_LABEL = ["?", "GKP", "DEF", "MID", "FWD"];

export async function GET(req: NextRequest) {
  const enc = req.nextUrl.searchParams.get("d");
  if (!enc) return new Response("missing ?d=", { status: 400 });
  const draft = decodeDraft(enc);
  if (!draft) return new Response("invalid draft payload", { status: 400 });

  const bs = await getBootstrap();
  const byId = new Map(bs.elements.map((e) => [e.id, e]));
  const teamShort = new Map(bs.teams.map((t) => [t.id, t.short_name]));

  const filled = draft.p.filter((id) => id != null).length;
  const totalCostTenths = draft.p.reduce<number>(
    (s, id) => s + (id != null ? byId.get(id)?.now_cost ?? 0 : 0),
    0,
  );
  const totalCost = totalCostTenths / 10;
  const budget = draft.b / 10;
  const inBudget = totalCost <= budget;

  const captain = draft.c != null ? byId.get(draft.c) : null;
  const vice = draft.v != null ? byId.get(draft.v) : null;

  // Group picks by position for layout.
  const byPos: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const id of draft.p) {
    if (id == null) continue;
    const e = byId.get(id);
    if (e) byPos[e.element_type].push(id);
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          color: TEXT,
          display: "flex",
          flexDirection: "column",
          padding: "40px 48px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Header strip */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: EMERALD,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
              }}
            >
              ⚔
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 18, fontWeight: 600 }}>Rival Slayer · draft</div>
              <div style={{ fontSize: 12, color: MUTED }}>fpl-rival-slayer-ai.vercel.app</div>
            </div>
          </div>
          <div
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              background: inBudget ? `${EMERALD}22` : `${ROSE}22`,
              border: `1px solid ${inBudget ? EMERALD : ROSE}66`,
              fontSize: 14,
              fontWeight: 600,
              color: inBudget ? EMERALD : ROSE,
            }}
          >
            {filled === 15 && inBudget ? "Valid · 15/15" : `${filled}/15 · £${totalCost.toFixed(1)}m`}
          </div>
        </div>

        {/* Draft name + budget */}
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 14, color: MUTED, letterSpacing: 2, textTransform: "uppercase" }}>
            Squad draft
          </div>
          <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.05 }}>{draft.n}</div>
          <div style={{ marginTop: 6, fontSize: 16, color: MUTED }}>
            £{totalCost.toFixed(1)}m used of £{budget.toFixed(1)}m budget
          </div>
        </div>

        {/* Squad rows */}
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
          {[1, 2, 3, 4].map((etype) => (
            <div key={etype} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 11, color: MUTED, letterSpacing: 1.2, textTransform: "uppercase" }}>
                {POS_LABEL[etype]}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                {byPos[etype].map((id) => {
                  const e = byId.get(id);
                  if (!e) return null;
                  const isCap = id === draft.c;
                  const isVice = id === draft.v;
                  return (
                    <div
                      key={id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                        padding: 8,
                        borderRadius: 10,
                        background: CARD,
                        border: `1px solid ${isCap ? AMBER : isVice ? "#cbd5e1" : BORDER}`,
                        width: 100,
                      }}
                    >
                      <div style={{ position: "relative", display: "flex" }}>
                        <img
                          src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${e.code}.png`}
                          width={42}
                          height={54}
                          alt=""
                          style={{ borderRadius: 8 }}
                        />
                        {isCap && (
                          <div
                            style={{
                              position: "absolute",
                              top: -4,
                              right: -4,
                              width: 18,
                              height: 18,
                              borderRadius: 999,
                              background: AMBER,
                              color: "#451a03",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 11,
                              fontWeight: 800,
                            }}
                          >
                            C
                          </div>
                        )}
                        {isVice && !isCap && (
                          <div
                            style={{
                              position: "absolute",
                              top: -4,
                              right: -4,
                              width: 18,
                              height: 18,
                              borderRadius: 999,
                              background: "#cbd5e1",
                              color: "#0f172a",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 11,
                              fontWeight: 800,
                            }}
                          >
                            V
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {e.web_name}
                      </div>
                      <div style={{ fontSize: 11, color: MUTED, display: "flex", gap: 4 }}>
                        <span>{teamShort.get(e.team) ?? "?"}</span>
                        <span>·</span>
                        <span>£{(e.now_cost / 10).toFixed(1)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            paddingTop: 16,
            borderTop: `1px solid ${BORDER}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
            color: MUTED,
          }}
        >
          <span>
            Captain: {captain ? captain.web_name : "—"} · Vice: {vice ? vice.web_name : "—"}
          </span>
          <span>Beat your rivals.</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=600, s-maxage=3600" },
    },
  );
}
