# Decision Spine — design

**Status:** approved, not yet implemented
**Date:** 2026-08-29
**Scope:** sub-project B of four (see [Context](#context))
**Predecessor:** `docs/superpowers/specs/2026-08-27-trust-foundation-design.md` (merged)

## Problem

The app shows a manager everything and decides nothing for them. Five tabs, roughly
forty components and twenty-four API routes present projections, rival comparisons,
transfer shortlists, live scores and an AI plan — and leave the synthesis to the
reader. The owner's summary of what is wrong with it named four things, and the first
two are this: it does not change their decisions, and it has too much surface with
unclear hierarchy.

The raw material for a decision already exists and is good. `TransferOption`
(`src/lib/optimizer/transfer-options.ts`) carries, per candidate swap, the change in
overtake probability against each named rival and a cumulative `overtakeSum` used as
its primary ranking key. `AiRecommendation` (`src/lib/ai/gemini.ts`) returns a
structured weekly plan with search-grounded news citations. Neither is the app's
answer to "what do I do this week"; both are panels inside tabs.

So this sub-project is not about generating advice. It is about which advice earns the
top of the screen, and — harder — about when the honest answer is that no advice is
worth giving.

## Context

"Boost the app to the next level" decomposes into four sub-projects. This spec covers
**B** only.

| | Sub-project | Status |
|---|---|---|
| **A** | Trust foundation | Merged 2026-08-29 |
| **B** | Decision spine | This spec |
| **C** | Liveness — the gameweek clock (Decide / Watch / Review) | Not started |
| **D** | Product plumbing — onboarding, cost control, caching | Not started |

The organising idea behind B and C is that **the app should know what time it is**.
B builds the Decide surface; C makes the app switch between Decide, Watch and Review
as the gameweek turns.

## The constraint that shapes everything

Sub-project A measured the projection model against real outcomes. On the held-out
2025-26 set, among players who actually started:

| | RMSE | Spearman |
| --- | ---: | ---: |
| Our model | 3.330 | 0.155 |
| FPL's own `xP` | 2.633 | 0.529 |

The model ranks players poorly. A surface that confidently names a transfer every week
on the back of that would be exactly the failure A was built to prevent — a confident
number the app cannot justify.

The decision follows: **the spine recommends an action only when the simulated edge
exceeds what the action costs, with the model's own uncertainty priced in.** When it
does not, the spine says so and recommends holding.

This is a product position, not only an engineering one. Most weeks in FPL the honest
answer genuinely is "roll it — nothing here is worth four points". No competing tool
says that, because manufacturing a weekly pick is what drives reopening. Saying it is
the thing this app can offer that the accurate-but-silent alternatives do not.

## Scope

**The spine owns two decisions:** transfers and captain. Within them it leads with
whichever moves the manager's rank most this week, and "do nothing" is a first-class
verdict rather than a fallback.

**Not in scope.** Chips, starting-XI and bench ordering, any change to the projection
model or scoring, the decision backtest (see [Deferred](#deferred-with-reasons)), and
any new AI call.

## The core abstraction

Every candidate — including doing nothing — is an `Action` that can be simulated.

```ts
type Action =
  | { kind: "hold" }
  | { kind: "transfer"; option: TransferOption; hitCost: number }
  | { kind: "captain"; playerId: number; webName: string };
```

Each simulates to an `ActionOutcome`:

```ts
interface ActionOutcome {
  action: Action;
  /** Points this action costs up front: 0 free, 4 per hit. */
  costPoints: number;
  /** P(gain from this action exceeds its cost), from simulation. */
  pGainExceedsCost: number;
  /** Median simulated gain in points versus holding. Zero for `hold` itself. */
  medianGain: number;
  /** 10th and 90th percentile of that gain. */
  p10: number;
  p90: number;
  /** Change in P(overtake) for each rival, versus holding. */
  overtakeDelta: Array<{ rivalEntryId: number; rivalName: string; delta: number }>;
}
```

Because every action is measured as *expected gain versus doing nothing*, a transfer
and a captain switch sit on one scale. That is what lets the spine lead with whichever
matters this week rather than always leading with transfers.

## The decision rule

```
enumerate actions → simulate each → apply AI vetoes → argmax pGainExceedsCost
    ├─ best below ACT_THRESHOLD                    → verdict "hold"
    ├─ best above, but within TIE_BAND of runner-up → verdict "too-close"
    └─ best above, margin clear                     → verdict "act"
```

`rule.ts` is a pure function over already-simulated outcomes. It performs no I/O and no
simulation, so every branch is unit-testable without a network or a random seed.

### Costs

Free-transfer count is derived, not assumed. `computeFreeTransfers`
(`src/lib/fpl/free-transfers.ts`) already reconstructs it from `entry/{id}/history/`,
applying the banking cap and handling wildcard and free-hit correctly. A transfer
within the free allowance costs 0; each transfer beyond it costs 4.

*(The README's Limitations section currently claims the free-transfer count "is not
exposed by the public FPL API", which is stale — the derivation has existed for some
time. Correcting that line is in scope for this work, since the cost model depends on
it and a reader would otherwise conclude the spine is guessing.)*

### The option value of rolling

A free transfer is not actually free: FPL lets a manager bank transfers up to a cap, so
spending one now forgoes flexibility later. The rule prices this as a single named
constant, `ROLL_OPTION_VALUE`, added to the cost of any transfer action.

**This constant is a judgement, not a measurement, and must be labelled as such in the
code.** It is the first thing the deferred decision backtest should calibrate. Naming
it and admitting its provenance is the honest treatment; burying it inside a comparison
would repeat the hand-picked-variance mistake that A had to undo.

### Thresholds

`ACT_THRESHOLD` and `TIE_BAND` are likewise judgements at ship time, defined as named
constants with their reasoning recorded beside them. The success criteria below include
a behavioural check on whether they are set sanely — a fixture-neutral week that
produces a confident recommendation means the threshold is wrong.

## Architecture

```
src/lib/decide/
  types.ts       Action, ActionOutcome, Verdict, EvidenceLink
  actions.ts     enumerate candidates from squad + transfer options + starting XI
  simulate.ts    one Action -> ActionOutcome (seeded RNG)
  rule.ts        outcomes + vetoes -> Verdict          <- pure, exhaustively tested
  veto.ts        adverse news extracted from a cached AI analysis
  index.ts       orchestrator: assemble inputs, simulate, decide
src/app/api/decide/route.ts
src/components/decide/
  DecisionSpine.tsx    the landing surface
  VerdictCard.tsx      headline, reason, trust badge
  ActionCompare.tsx    chosen versus runner-up, with intervals
  EvidenceLinks.tsx    tappable links into the tabs that justify each claim
```

Reused unchanged: `buildProjections`, `projectSquad`, `generateTransferOptions`,
`computeOvertakeOdds`, `readAnalysis`, `computeFreeTransfers`. The residual-fitted
variance from A reaches the simulation indirectly — `projectSquad` calls
`estimateVariance` per player and sums into `SquadProjection.stdev`, which is what the
Monte Carlo samples from. There is no direct call from `src/lib/decide/`.

### One change outside that tree

`computeOvertakeOdds` (`src/lib/projections/overtake.ts`) draws from `Math.random()`
inside `normalSample`. It must accept an injectable RNG defaulting to `Math.random`, so
simulation-dependent tests are deterministic. Small change, load-bearing for testing.

## Data flow

```
GET /api/decide?teamId&leagueId
  ├─ resolve rival context, bootstrap, fixtures        (existing)
  ├─ buildProjections -> user + rival SquadProjections (existing)
  ├─ computeFreeTransfers(entryHistory)                (existing)
  ├─ generateTransferOptions(...)                      (existing)
  ├─ enumerate captain candidates from the starting XI
  ├─ simulate every action (hold included) under a seeded RNG
  ├─ readAnalysis(teamId, leagueId, gw) -> vetoes      (optional; never blocking)
  └─ rule.decide(outcomes, vetoes) -> Verdict
```

## The AI stays off the critical path

`veto.ts` reads an **already-cached** analysis via `readAnalysis`. It never triggers a
Gemini call. When there is no cached analysis, no `GEMINI_API_KEY`, or no Redis, the
spine renders with vetoes absent and says nothing about news.

The AI can *downgrade* or *annotate* a recommendation — flagging that an incoming
player is injured, suspended or rotation-risked, drawn from the search-grounded
citations the coach already returns. It can never *produce* one, and its self-reported
`confidence` never overrides a measured margin. This keeps the surface free, fast and
functional for users without a key, and keeps an unmeasured component out of the
decision itself.

## Placement

The spine renders above the tab bar on the dashboard and is always visible. The five
tabs — Squad, Rival, AI, Matches, Draft — stay exactly as they are.

Every claim the verdict makes carries an `EvidenceLink` that switches to the tab
justifying it: a rival gap opens Rival, a named swap opens the player modal, a news
veto opens the AI tab's citation. Nothing is deleted; things are demoted to evidence.

The spine carries the same **Directional** badge introduced in A (`ModelTrustBadge`,
reading `shipGate.passes` through the shared `["model-report"]` query key), so the
trust signal travels with the recommendation instead of sitting elsewhere on the page.

## Error handling

- FPL unreachable: the existing failover and error shape surface as they do today; the
  spine renders the error rather than an empty verdict.
- No rivals resolvable: captain-only verdict, with the transfer section absent and a
  stated reason — not a silent omission.
- No transfer options generated: verdict is "hold", with the reason given.
- Redis or Gemini unavailable: vetoes absent, verdict still produced.
- Simulation degenerate (zero variance, empty squad): `rule.ts` returns "hold" with an
  explicit reason rather than a spurious recommendation. Following A's precedent, a
  degenerate input yields a stated non-answer, never a confident-looking default.

## Testing

- `rule.ts` is pure and gets exhaustive unit tests: no options; every option vetoed;
  best exactly at `ACT_THRESHOLD`; best and runner-up exactly `TIE_BAND` apart; a hit
  that clears its cost; a hit that does not; a captain switch beating every transfer;
  hold winning outright.
- `simulate.ts` is deterministic under a seeded RNG; a fixed seed produces a fixed
  `ActionOutcome`.
- `actions.ts` enumerates the right candidates for a squad with no bench, a squad with
  a flagged player, and a double-gameweek.
- `veto.ts` handles a missing analysis, a malformed analysis and an analysis with no
  citations, without throwing.
- Coverage threshold for `src/lib/decide/**` matches the existing bar: 80% lines.

## Success criteria

- A verdict renders for a real team in under a second with no `GEMINI_API_KEY` present.
- **"Roll it" is reachable and common.** A fixture-neutral gameweek that produces a
  confident recommendation means the threshold is set wrong. This is a behavioural
  check, to be exercised against real gameweeks before merge.
- Every branch of `rule.ts` listed above has a test.
- Simulation is reproducible under a fixed seed.
- Every claim rendered on the surface has a working evidence link.
- No new dependency, and no new Gemini call on the render path.

## Deferred, with reasons

- **The decision backtest.** Measuring whether following the spine's advice would
  historically have gained points is the most correct thing on this list, and the true
  continuation of A. It needs manager-squad simulation, which the player-level corpus
  cannot support without a synthetic-manager model. That is its own sub-project, and it
  is what should eventually calibrate `ROLL_OPTION_VALUE`, `ACT_THRESHOLD` and
  `TIE_BAND` out of judgement and into evidence.
- **Substituting FPL's `ep_next` when the ship gate fails.** Carried over from A. It
  would change the number driving every recommendation here, so it belongs in its own
  task with its own review rather than riding along inside B.
- **Chips and XI/bench ordering.** Chips are roughly five decisions per season and
  would dilute the surface for the other thirty-three weeks. Bench ordering is
  low-stakes most weeks. Both stay in their existing tabs.

## Open questions

- The initial values for `ACT_THRESHOLD`, `TIE_BAND` and `ROLL_OPTION_VALUE` are set by
  judgement at implementation time and sanity-checked against real gameweeks. The
  behavioural success criterion above is the guard; the decision backtest is the
  eventual answer.
- Whether the spine should collapse to a single line once a manager has acted on it
  within a gameweek is a liveness concern, and belongs to sub-project C.
