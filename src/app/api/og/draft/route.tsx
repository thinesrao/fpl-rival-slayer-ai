/* eslint-disable @next/next/no-img-element */
// Squad-draft share card. 1200x630, OG-friendly.
//   GET /api/og/draft?d=<base64-url-encoded SquadDraft>
//
// Satori is strict — every <div> with multiple children must have
// display: flex (or display: none). Every container below is
// explicit. Strings are kept as a single text node per element.

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

  const byPos: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const id of draft.p) {
    if (id == null) continue;
    const e = byId.get(id);
    if (e) byPos[e.element_type].push(id);
  }

  const statusText =
    filled === 15 && inBudget ? "Valid · 15/15" : `${filled}/15 · £${totalCost.toFixed(1)}m`;
  const statusColor = inBudget ? EMERALD : ROSE;
  const captainLine = `Captain: ${captain?.web_name ?? "—"}  ·  Vice: ${vice?.web_name ?? "—"}`;
  const budgetLine = `£${totalCost.toFixed(1)}m of £${budget.toFixed(1)}m`;

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
        {/* Header row */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: EMERALD,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                marginRight: 14,
              }}
            >
              ⚔
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>Rival Slayer · draft</div>
              <div style={{ fontSize: 12, color: MUTED }}>fpl-rival-slayer-ai</div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              padding: "8px 16px",
              borderRadius: 999,
              background: `${statusColor}22`,
              border: `1px solid ${statusColor}66`,
              fontSize: 16,
              fontWeight: 700,
              color: statusColor,
            }}
          >
            {statusText}
          </div>
        </div>

        {/* Title block */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 28 }}>
          <div
            style={{
              display: "flex",
              fontSize: 14,
              color: MUTED,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            Squad draft
          </div>
          <div style={{ display: "flex", fontSize: 52, fontWeight: 900, lineHeight: 1.05 }}>
            {draft.n}
          </div>
          <div style={{ display: "flex", marginTop: 8, fontSize: 18, color: MUTED }}>
            {budgetLine}
          </div>
        </div>

        {/* Squad rows */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 28,
            flex: 1,
          }}
        >
          {[1, 2, 3, 4].map((etype) => (
            <div
              key={etype}
              style={{ display: "flex", flexDirection: "column", marginBottom: 12 }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: 11,
                  color: MUTED,
                  letterSpacing: 1.4,
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                {POS_LABEL[etype]}
              </div>
              <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap" }}>
                {byPos[etype].map((id) => {
                  const e = byId.get(id);
                  if (!e) return null;
                  const isCap = id === draft.c;
                  const isVice = id === draft.v && !isCap;
                  const ringColor = isCap ? AMBER : isVice ? "#cbd5e1" : BORDER;
                  return (
                    <div
                      key={id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        padding: 8,
                        marginRight: 8,
                        marginBottom: 4,
                        borderRadius: 10,
                        background: CARD,
                        border: `1px solid ${ringColor}`,
                        width: 104,
                      }}
                    >
                      <div style={{ display: "flex", position: "relative" }}>
                        <img
                          src={`https://resources.premierleague.com/premierleague/photos/players/110x140/p${e.code}.png`}
                          width={46}
                          height={58}
                          alt=""
                          style={{ borderRadius: 8 }}
                        />
                        {isCap && (
                          <div
                            style={{
                              position: "absolute",
                              top: -6,
                              right: -6,
                              width: 20,
                              height: 20,
                              borderRadius: 999,
                              background: AMBER,
                              color: "#451a03",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            C
                          </div>
                        )}
                        {isVice && (
                          <div
                            style={{
                              position: "absolute",
                              top: -6,
                              right: -6,
                              width: 20,
                              height: 20,
                              borderRadius: 999,
                              background: "#cbd5e1",
                              color: "#0f172a",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            V
                          </div>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          fontSize: 13,
                          fontWeight: 700,
                          marginTop: 4,
                          maxWidth: 92,
                          overflow: "hidden",
                        }}
                      >
                        {e.web_name}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          fontSize: 11,
                          color: MUTED,
                          marginTop: 2,
                        }}
                      >
                        {`${teamShort.get(e.team) ?? "?"} · £${(e.now_cost / 10).toFixed(1)}`}
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
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: 16,
            borderTop: `1px solid ${BORDER}`,
            fontSize: 13,
            color: MUTED,
          }}
        >
          <div style={{ display: "flex" }}>{captainLine}</div>
          <div style={{ display: "flex", color: EMERALD, fontWeight: 700 }}>Beat your rivals.</div>
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
