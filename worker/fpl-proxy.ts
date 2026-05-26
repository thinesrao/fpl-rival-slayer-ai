// Cloudflare Worker that proxies the public Fantasy Premier League API.
//
// Why: FPL's bot filter 403s most data-centre egress (including Vercel's
// AWS ranges). Cloudflare Workers run on Cloudflare's edge IPs, which the
// filter generally still allows through.
//
// What it does:
//   GET https://<worker>.workers.dev/api/entry/942359/
//   → GET https://fantasy.premierleague.com/api/entry/942359/
//   (with browser-like headers added so the bot filter is happy)
//
// Deploy:
//   1. npm i -g wrangler && wrangler login
//   2. cd worker && wrangler deploy
//   3. (Optional but recommended) wrangler secret put FPL_PROXY_SECRET
//      Pick any random string. Then set the *same* string as a
//      Vercel env var named FPL_PROXY_SECRET so the Next.js app
//      can authenticate to the worker.
//   4. Set FPL_PROXY_URL in Vercel to the worker URL (no trailing slash),
//      e.g. https://fpl-proxy.your-name.workers.dev
//
// Security: with FPL_PROXY_SECRET set, the worker rejects requests that
// don't carry the matching X-FPL-Proxy-Secret header, so randoms can't
// piggy-back on your worker quota.

interface Env {
  FPL_PROXY_SECRET?: string;
}

const ALLOWED_PREFIX = "/api/";
const UPSTREAM = "https://fantasy.premierleague.com";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-GB,en;q=0.9",
  Referer: "https://fantasy.premierleague.com/",
  Origin: "https://fantasy.premierleague.com",
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("method_not_allowed", { status: 405 });
    }

    const url = new URL(req.url);
    if (!url.pathname.startsWith(ALLOWED_PREFIX)) {
      return new Response("not_found", { status: 404 });
    }

    if (env.FPL_PROXY_SECRET) {
      const presented = req.headers.get("x-fpl-proxy-secret");
      if (presented !== env.FPL_PROXY_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
    }

    const upstreamUrl = `${UPSTREAM}${url.pathname}${url.search}`;
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: BROWSER_HEADERS,
      cf: {
        cacheTtl: 60,
        cacheEverything: true,
      },
    });

    const headers = new Headers();
    const passthrough = ["content-type", "cache-control", "etag", "last-modified"];
    for (const name of passthrough) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
