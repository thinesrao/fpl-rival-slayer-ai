// Network-path diagnostic. Reports which routes to the FPL API this runtime
// can actually use, so a future outage can be triaged in one request instead
// of a deploy-and-guess loop.
//
// Deliberately exposes no secrets — only booleans for which env vars are set.
import { NextResponse } from "next/server";

import { ORIGINS, activeOriginLabel } from "@/lib/fpl/origins";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ProbeResult {
  label: string;
  status: number | null;
  ms: number;
  bytes: number | null;
  kind: string;
  snippet: string;
}

function classify(body: string): string {
  const head = body.trimStart();
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  if (/Just a moment|cf-browser-verification|challenge-platform/i.test(body)) return "cf-challenge";
  return "other";
}

async function probe(label: string, url: string, headers: Record<string, string>): Promise<ProbeResult> {
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { headers, cache: "no-store" });
    const body = await res.text();
    return {
      label,
      status: res.status,
      ms: Date.now() - startedAt,
      bytes: body.length,
      kind: classify(body),
      snippet: body.slice(0, 160).replace(/\s+/g, " "),
    };
  } catch (error) {
    return {
      label,
      status: null,
      ms: Date.now() - startedAt,
      bytes: null,
      kind: "network-error",
      snippet: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET() {
  // Probe every configured origin independently, in parallel — we want the
  // full picture, not just the first one that happens to work.
  const probes = await Promise.all(
    ORIGINS.map((origin) =>
      probe(origin.label, `${origin.base}/bootstrap-static/`, { ...origin.headers }),
    ),
  );

  return NextResponse.json(
    {
      region: process.env.VERCEL_REGION ?? "local",
      vercelEnv: process.env.VERCEL_ENV ?? "local",
      configured: {
        proxyUrl: Boolean(process.env.FPL_PROXY_URL),
        proxySecret: Boolean(process.env.FPL_PROXY_SECRET),
        geminiKey: Boolean(process.env.GEMINI_API_KEY),
        redis: Boolean(process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL),
      },
      originsInPriorityOrder: ORIGINS.map((o) => o.label),
      activeOrigin: activeOriginLabel(),
      probes,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
