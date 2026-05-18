/* eslint-disable @next/next/no-img-element */
// Auto-generated GW recap share card. PNG 1200x630, OG-friendly.
//   GET /api/og/recap?teamId=123&gw=38   (gw optional; falls back to most-recent finished)
//
// Renders an inline edge-runtime image via Next.js ImageResponse (Satori).
// Pure inline styles — Satori doesn't support Tailwind classes.

import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { getEntry, getEntryHistory } from "@/lib/fpl/client";

export const runtime = "nodejs";

const BG = "#0a0f1a";
const CARD = "#0f1626";
const BORDER = "#1f2a44";
const TEXT = "#e7ecf2";
const MUTED = "#8a93a8";
const ACCENT = "#10b981";
const ACCENT_DIM = "#0ea271";
const ROSE = "#fb7185";
const AMBER = "#f59e0b";

interface RecapData {
  teamName: string;
  managerName: string;
  gw: number;
  gwNet: number;
  gwGross: number;
  transferCost: number;
  pointsOnBench: number;
  overallRank: number;
  rankDelta: number; // negative = climbed (FPL: lower rank = better)
  totalPoints: number;
  benchSeasonTotal: number;
}

async function buildRecap(teamId: number, gwOverride?: number): Promise<RecapData> {
  const [entry, history] = await Promise.all([getEntry(teamId), getEntryHistory(teamId)]);
  const current = history.current ?? [];
  if (current.length === 0) {
    throw new Error("No GW history for this team");
  }
  const targetIdx = gwOverride
    ? current.findIndex((c) => c.event === gwOverride)
    : current.length - 1;
  if (targetIdx < 0) throw new Error(`GW ${gwOverride} not found in history`);
  const cur = current[targetIdx];
  const prev = targetIdx > 0 ? current[targetIdx - 1] : null;
  const rankDelta = prev ? cur.overall_rank - prev.overall_rank : 0;
  const benchSeasonTotal = current.reduce((s, h) => s + h.points_on_bench, 0);
  return {
    teamName: entry.name,
    managerName: `${entry.player_first_name} ${entry.player_last_name}`.trim(),
    gw: cur.event,
    gwNet: cur.points - cur.event_transfers_cost,
    gwGross: cur.points,
    transferCost: cur.event_transfers_cost,
    pointsOnBench: cur.points_on_bench,
    overallRank: cur.overall_rank,
    rankDelta,
    totalPoints: cur.total_points,
    benchSeasonTotal,
  };
}

function fmtNumber(n: number) {
  return n.toLocaleString("en-US");
}

function fmtRankDelta(delta: number) {
  if (delta === 0) return { text: "no change", color: MUTED };
  if (delta < 0) return { text: `▲ ${fmtNumber(Math.abs(delta))}`, color: ACCENT };
  return { text: `▼ ${fmtNumber(Math.abs(delta))}`, color: ROSE };
}

export async function GET(req: NextRequest) {
  const teamId = Number(req.nextUrl.searchParams.get("teamId"));
  const gwOverride = Number(req.nextUrl.searchParams.get("gw")) || undefined;
  if (!teamId || Number.isNaN(teamId)) {
    return new Response("teamId required", { status: 400 });
  }

  let r: RecapData;
  try {
    r = await buildRecap(teamId, gwOverride);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(msg, { status: 502 });
  }

  const rankDelta = fmtRankDelta(r.rankDelta);
  const netTone = r.gwNet >= 60 ? ACCENT : r.gwNet >= 40 ? AMBER : ROSE;

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
          padding: "48px 56px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Header strip */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: ACCENT_DIM,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                fontWeight: 700,
              }}
            >
              ⚔
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 22, fontWeight: 600 }}>Rival Slayer</div>
              <div style={{ fontSize: 14, color: MUTED }}>fpl-rival-slayer-ai.vercel.app</div>
            </div>
          </div>
          <div
            style={{
              padding: "8px 18px",
              borderRadius: 999,
              background: CARD,
              border: `1px solid ${BORDER}`,
              fontSize: 20,
              fontWeight: 600,
            }}
          >
            GW {r.gw}
          </div>
        </div>

        {/* Team title */}
        <div style={{ marginTop: 32, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 18, color: MUTED, letterSpacing: 2, textTransform: "uppercase" }}>
            {r.managerName}
          </div>
          <div style={{ fontSize: 56, fontWeight: 800, marginTop: 2, lineHeight: 1.05 }}>
            {r.teamName}
          </div>
        </div>

        {/* Big number — GW net pts */}
        <div
          style={{
            marginTop: 28,
            display: "flex",
            alignItems: "flex-end",
            gap: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 156, fontWeight: 900, color: netTone, lineHeight: 1 }}>
              {r.gwNet}
            </span>
            <span style={{ fontSize: 28, color: MUTED, fontWeight: 600 }}>pts</span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              paddingBottom: 14,
            }}
          >
            <div style={{ fontSize: 16, color: MUTED, textTransform: "uppercase", letterSpacing: 1.4 }}>
              GW Net
            </div>
            {r.transferCost > 0 && (
              <div style={{ fontSize: 18, color: MUTED, marginTop: 4 }}>
                gross {r.gwGross} (−{r.transferCost})
              </div>
            )}
          </div>
        </div>

        {/* Stat row */}
        <div style={{ marginTop: 32, display: "flex", gap: 16 }}>
          <Stat
            label="Overall rank"
            value={fmtNumber(r.overallRank)}
            sub={
              <span style={{ color: rankDelta.color, fontWeight: 700 }}>
                {rankDelta.text}
              </span>
            }
          />
          <Stat label="Bench (GW)" value={`${r.pointsOnBench}`} sub={`season ${r.benchSeasonTotal}`} />
          <Stat label="Total" value={fmtNumber(r.totalPoints)} sub="season pts" />
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: "auto",
            paddingTop: 24,
            borderTop: `1px solid ${BORDER}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 14,
            color: MUTED,
          }}
        >
          <span>Generated by Rival Slayer AI</span>
          <span>Find your edge in the mini-league.</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=600",
      },
    },
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: "18px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 14, color: MUTED, textTransform: "uppercase", letterSpacing: 1.2 }}>
        {label}
      </div>
      <div style={{ fontSize: 40, fontWeight: 800 }}>{value}</div>
      <div style={{ fontSize: 16, color: MUTED }}>{sub}</div>
    </div>
  );
}
