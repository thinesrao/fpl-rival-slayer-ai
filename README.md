# FPL Rival Slayer AI

> AI-powered Fantasy Premier League coach focused on the 2-3 mini-league rivals immediately above you.

Drop in your **FPL Team ID** and **Mini-League ID** and get:

- Side-by-side squad comparison with the rivals directly above you in the standings.
- Per-player **xPts projections** using form, fixture difficulty, xG/xA, minutes and injury status.
- **Overtake probability** for each rival from a Monte-Carlo simulation of the upcoming gameweek.
- An **AI strategist** (Google Gemini with Google Search grounding) that reads the latest injury and lineup news and returns a structured plan: transfers, captain pick, chip strategy, and differentials to exploit — every recommendation backed by citations.

## Stack

- **Next.js 15** (App Router) + TypeScript
- **Tailwind CSS** + hand-rolled shadcn/ui primitives
- **TanStack Query** for client data, **Recharts** for visualisations
- **Google Gemini 2.5 Pro** via the official `@google/genai` SDK with the `googleSearch` tool for live grounding
- **Official FPL API** (no third-party wrappers — see `src/lib/fpl/client.ts`)

Projection logic is a transparent, closed-form xP model inspired by [daniegr/OpenFPL](https://github.com/daniegr/OpenFPL); the heuristic transfer shortlist is inspired by [solioanalytics/open-fpl-solver](https://github.com/solioanalytics/open-fpl-solver); enriched datasets like [olbauday/FPL-Core-Insights](https://github.com/olbauday/FPL-Core-Insights) can be dropped into `src/data/` and loaded by `src/lib/stats/insights.ts` (extension point ready, not required for the MVP).

## Quick start

```bash
npm install
cp .env.example .env.local      # add your GEMINI_API_KEY (optional for non-AI features)
npm run dev                     # http://localhost:3000
```

Then open <http://localhost:3000> and enter your Team ID + Mini-League ID.

### Finding your IDs

- **Team ID**: log in to <https://fantasy.premierleague.com/>, click your team name. The number in `/entry/{id}/` is your team ID.
- **Mini-League ID**: open the mini-league standings. The trailing number in `/leagues/{id}/standings/c` is the league ID.

## Environment variables

| Name              | Required           | Default              | Purpose                                                            |
| ----------------- | ------------------ | -------------------- | ------------------------------------------------------------------ |
| `GEMINI_API_KEY`  | for the AI Coach   | —                    | Server-only Google AI Studio API key. Get one at <https://aistudio.google.com/app/apikey>. |
| `GEMINI_MODEL`    | no                 | `gemini-2.5-pro`     | Override the Gemini model (e.g. `gemini-2.5-flash` for cheaper/faster runs). |
| `FPL_USER_AGENT`  | no                 | `fpl-rival-slayer-ai/0.1` | Polite UA sent on every FPL API request. |

If `GEMINI_API_KEY` is not set, the rest of the app (rivals, projections, overtake odds) still works — the AI Coach tab shows a clear notice.

## Project layout

```
src/
├── app/
│   ├── api/
│   │   ├── rivals/           Resolve rivals + squads
│   │   ├── projections/      xPts + overtake odds
│   │   └── analysis/         End-to-end orchestrator → Gemini
│   ├── dashboard/[teamId]/[leagueId]/page.tsx
│   ├── page.tsx              Landing form
│   └── providers.tsx         TanStack Query provider
├── lib/
│   ├── fpl/                  Typed FPL API client + rival detection
│   ├── projections/          xP model + Monte-Carlo overtake odds
│   ├── optimizer/            Heuristic transfer shortlist
│   ├── ai/                   Gemini client + prompts
│   ├── env.ts                Zod-validated env
│   └── types.ts              Shared types
└── components/               Dashboard + shadcn primitives
```

## Deployment (Vercel)

```bash
vercel
# or push to GitHub and import into vercel.com
```

Set `GEMINI_API_KEY` in the Vercel project's environment variables. Everything else just works — the API routes use Node.js runtime and the dynamic FPL fetches use in-memory + Next.js fetch-cache hints to stay friendly to the FPL API.

> **Commits must be signed.** This project has *Require Verified Commits* enabled in
> Vercel (Settings → Git). Unsigned commits are refused silently — no deployment is
> created and no GitHub check appears, so it looks like the integration is broken
> rather than like a rejected commit. Configure signing once:
>
> ```bash
> git config gpg.format ssh
> git config user.signingkey ~/.ssh/id_ed25519.pub
> git config commit.gpgsign true
> ```
>
> The same public key must be added at **github.com → Settings → SSH and GPG keys →
> New SSH key** with key type **Signing Key** (an authentication key of the same name
> does not count). Verify with `git log --show-signature -1`.

## How the AI Coach stays current

Every recommendation call:

1. Fetches your live squad, the rivals immediately above you, the current fixtures, and projects xPts for every player.
2. Builds a heuristic transfer shortlist as a starting point.
3. Hands a structured digest to Gemini with the system prompt "elite FPL mini-league strategist" and the **`googleSearch` tool enabled**.
4. Gemini is instructed to search the web for the latest injury/training/press-conference news for every named player it considers, then return a JSON envelope with transfers, captain, chip strategy, differentials, and `news_citations` with the source URLs surfaced via grounding metadata.

## Troubleshooting network access

FPL fronts its API with Cloudflare bot management, which challenges data-centre
egress. Vercel's AWS ranges were blocked in May 2026; the Cloudflare Worker built to
dodge that was itself blocked in August 2026. There is no browser-side workaround —
FPL sends no CORS headers on any endpoint, so a server-side hop is mandatory.

The client therefore does not bind to one network path. `src/lib/fpl/origins.ts`
keeps an ordered list (direct, then `FPL_PROXY_URL` if set), fails over on 403/429/451
and on network errors, and remembers which path worked so steady-state traffic costs
one request rather than a wasted probe.

```bash
curl -s https://<deployment>/api/diag | jq
```

`GET /api/diag` probes every configured origin in parallel and reports status, latency
and whether the body is JSON or a Cloudflare challenge, plus booleans for which env
vars are set (never their values). Start here when FPL data stops loading.

## The decision spine

The dashboard opens with one verdict: the single change most worth making this
week, or an explicit "roll it" when nothing is worth making.

Actions are compared on one scale — the change in probability of finishing
above each tracked rival — so a captain switch and a transfer can be ranked
against each other. The comparison uses paired Monte-Carlo draws: both
scenarios are evaluated against the same random numbers, so what survives the
subtraction is the effect of the change rather than sampling noise.

An action is recommended **only when its 80% batch-spread interval excludes
zero**. That interval is the 10th/90th percentile spread across forty batch
means, not a credible interval on the true delta — it is a deliberately
conservative noise floor and carries no parameter uncertainty from the
projections themselves.
Most weeks nothing clears that bar, and the app says so. That is deliberate:
the model behind these numbers does not yet beat FPL's own expected points
(see Limitations), so manufacturing a weekly pick would be dishonest.

Early in the season, when the model has fewer than four historical rounds to
draw from, the engine reports insufficient history rather than making a
recommendation.

`GET /api/decision?teamId=&leagueId=` returns the verdict. It is deterministic
— seeded on the gameweek and entry — so the same week gives the same answer on
refresh and on a second device. It makes no AI call.

## Limitations

- Free-transfer count is not exposed by the public FPL API per gameweek, so the AI defaults to 1 free transfer. Use the prompt context if you have more banked.
- The xP model is intentionally closed-form (not the full XGBoost ensemble from OpenFPL) so it runs server-side in Next.js without any ML runtime.
- **The xP model is now backtested, but does not yet beat FPL's own expected points.**
  An audit on 2026-08-27 found six defects — minutes probability applied twice, a form
  term double-counting the xG/xA/bonus terms, a bonus term reading a season-cumulative
  ICT index that stopped discriminating between players partway through a season,
  fixture difficulty applied three times, and no defensive-contribution term despite
  that scoring category existing since 2025-26. All six are fixed. Monte-Carlo
  variance is no longer a hand-picked constant — it is fitted from historical
  residuals, bucketed by predicted points and position (`src/lib/projections/variance.ts`).
  The model is validated against a held-out set of 2025-26 gameweeks via
  `npm run backtest`, which reproduces the measurement and regenerates
  `src/data/model-report.json`; `/api/model-report` serves that summary and the
  in-app calibration panel renders it. On that holdout, our model currently scores
  RMSE 3.402 / Spearman 0.158 on starters, versus FPL's own published xP at
  RMSE 2.633 / Spearman 0.529 — FPL's figure is still more accurate. A "ship gate"
  (`src/lib/projections/model-report.ts`) tracks this and intentionally fails while
  that remains true. Until the gate passes, treat the projections in this app as
  directional rather than decisive; the UI surfaces this next to the relevant
  numbers when the gate is failing.

## License

MIT — see `LICENSE`.
