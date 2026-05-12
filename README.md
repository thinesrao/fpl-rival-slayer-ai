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

## How the AI Coach stays current

Every recommendation call:

1. Fetches your live squad, the rivals immediately above you, the current fixtures, and projects xPts for every player.
2. Builds a heuristic transfer shortlist as a starting point.
3. Hands a structured digest to Gemini with the system prompt "elite FPL mini-league strategist" and the **`googleSearch` tool enabled**.
4. Gemini is instructed to search the web for the latest injury/training/press-conference news for every named player it considers, then return a JSON envelope with transfers, captain, chip strategy, differentials, and `news_citations` with the source URLs surfaced via grounding metadata.

## Limitations

- Free-transfer count is not exposed by the public FPL API per gameweek, so the AI defaults to 1 free transfer. Use the prompt context if you have more banked.
- The xP model is intentionally closed-form (not the full XGBoost ensemble from OpenFPL) so it runs server-side in Next.js without any ML runtime. It performs well in practice as a "directional" projection and feeds Gemini with structured signals.

## License

MIT — see `LICENSE`.
