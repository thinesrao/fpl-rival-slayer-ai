// Tiny CORS-adding proxy for the public Fantasy Premier League API.
//
// Why: FPL doesn't serve Access-Control-Allow-Origin headers AND
// Vercel/Cloudflare-Worker egress IPs are on FPL's bot-management block
// list. This proxy runs on Render (free, no credit card) and adds CORS
// headers so the Next.js server-side routes can reach FPL.
//
// Deploy on Render (one-time, ~3 min):
//   1. Push this repo to GitHub
//   2. Go to render.com → New → Web Service → connect this repo
//   3. Set Root Directory to "fpl-proxy", Environment to "Docker"
//   4. Add env var: FPL_PROXY_SECRET = <generate with: openssl rand -hex 24>
//   5. Deploy → copy the .onrender.com URL
//   6. In Vercel, set FPL_PROXY_URL = https://<your-service>.onrender.com
//      and FPL_PROXY_SECRET = <same secret from step 4>
//
// Verify:
//   curl -H "X-FPL-Proxy-Secret: $SECRET" \
//     https://<your-service>.onrender.com/api/entry/4778037/

import http from "node:http";

const PORT = process.env.PORT || 8080;
const SECRET = process.env.FPL_PROXY_SECRET || "";
const UPSTREAM = "https://fantasy.premierleague.com";

const ALLOWED_ORIGINS = new Set([
  "https://fpl-rival-slayer-ai.vercel.app",
  "https://myexperimentsite.online",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function corsOriginFor(reqOrigin) {
  if (!reqOrigin) return "*";
  if (ALLOWED_ORIGINS.has(reqOrigin)) return reqOrigin;
  if (/^https:\/\/[a-z0-9-]+-thinesraos-projects\.vercel\.app$/i.test(reqOrigin)) return reqOrigin;
  return "null";
}

function corsHeaders(reqOrigin) {
  return {
    "Access-Control-Allow-Origin": corsOriginFor(reqOrigin),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "X-FPL-Proxy-Secret, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain", ...corsHeaders(origin) });
    res.end("method_not_allowed");
    return;
  }

  if (!req.url.startsWith("/api/")) {
    if (req.url === "/" || req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain", ...corsHeaders(origin) });
      res.end("ok");
      return;
    }
    res.writeHead(404, corsHeaders(origin));
    res.end("not_found");
    return;
  }

  if (SECRET) {
    const presented = req.headers["x-fpl-proxy-secret"];
    if (presented !== SECRET) {
      res.writeHead(403, { "Content-Type": "text/plain", ...corsHeaders(origin) });
      res.end("forbidden");
      return;
    }
  }

  const upstreamUrl = `${UPSTREAM}${req.url}`;
  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });

    const headers = {
      ...corsHeaders(origin),
      "Content-Type": upstream.headers.get("content-type") || "application/json",
      "Cache-Control": upstream.headers.get("cache-control") || "no-store",
    };
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, headers);
    res.end(body);
  } catch (err) {
    res.writeHead(502, { "Content-Type": "text/plain", ...corsHeaders(origin) });
    res.end(`upstream_error: ${err?.message || "unknown"}`);
  }
});

server.listen(PORT, () => {
  console.log(`fpl-proxy listening on :${PORT}`);
});
