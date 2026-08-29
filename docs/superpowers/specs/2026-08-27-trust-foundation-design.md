# Trust Foundation — design

**Status:** approved, not yet implemented
**Date:** 2026-08-27
**Scope:** sub-project A of four (see [Context](#context))

## Problem

The app publishes numbers it cannot justify. Per-player xPts feeds a Monte-Carlo
simulation that produces a headline "overtake probability", and both are shown to
the user as decisive figures. Neither has ever been measured against a real outcome.

The model in `src/lib/projections/model.ts` has five defects plus a missing scoring
category, all confirmed against live FPL data and the historical archive on 2026-08-27:

1. **Minutes probability is applied twice.** `expectedMinutes()` returns
   `minProb × 90`, so `minutesFactor = xMin / 90 = minProb`. Every scoring term is
   multiplied by `minutesFactor`, and then the whole sum is multiplied by `minProb`
   again. A player with a 50% chance of playing is priced as a 25% player; a 75%
   player is priced at 56%.

2. **The form term double-counts realised output.** FPL's `form` field is average
   points per game — already the sum of goals, assists, clean sheets and bonus. The
   model adds `formBoost(form)` on top of separate xG, xA, clean-sheet and bonus
   terms. One gameweek into 2026/27, `form` is literally just the GW1 score, so the
   players receiving the maximum `+2.00` boost were De Cuyper (17), Hinshelwood (16),
   Mendy (15) and Palmer (13) — the model applies its largest boost to one-week flukes.

3. **The bonus term degrades across the season.** `bonusExpectation` is
   `min(1.5, ict_index / 100)`, but `ict_index` is a season cumulative, not a per-90
   rate. Measured after GW1 the median player scores 0.03 from this term. A regular
   starter accrues roughly 8–10 ICT per gameweek, so by approximately GW15 most
   starters pin at the 1.5 cap and the term stops discriminating between players
   entirely. The model's behaviour therefore drifts systematically as the season runs,
   and nothing would surface it.

4. **Fixture difficulty is applied three times** — `fdrAttackMultiplier` scales the
   attacking terms, `teamCleanSheetProb` maps FDR to a clean-sheet probability, and a
   flat `fdrPenalty` is then subtracted. The code comments acknowledge the third is
   there "to keep tough fixtures pulled down even after attMult", which is tuning by
   feel rather than modelling.

5. **The model has no defensive-contribution term at all.** FPL introduced
   defensive-contribution (DC) points in 2025-26. Evidence from the archive — defenders
   playing 60+ minutes with no clean sheet, no goal, no assist, no bonus and no cards:

   | Season | n | scoring > 2 pts |
   | --- | ---: | ---: |
   | 2023-24 | 46 | 0 |
   | 2024-25 | 42 | 0 |
   | 2025-26 | 42 | 14 |

   Examples from 2025-26 gw12: Toti Gomes 3 pts (DC=11), Thiaw 4 pts (DC=10). The
   current model cannot produce those points, so it systematically under-rates
   defenders and defensive midfielders under the rules in force for 2026-27.

Separately, `variance` — the entire uncertainty structure the Monte Carlo runs on — is
a hand-picked positional constant scaled by xPoints. The published overtake percentage
inherits that invented spread.

None of this would ever be caught: the repository contains no tests of any kind across
19,309 lines.

## Context

"Boost the app to the next level" decomposes into four sub-projects. This spec covers
**A** only.

| | Sub-project | Rationale |
|---|---|---|
| **A** | Trust foundation | Precondition for publishing any number to strangers |
| **B** | Decision spine | One surface answering "what do I do this week" |
| **C** | Liveness — the gameweek clock (Decide / Watch / Review modes) | The app currently looks identical whether the deadline is in six days or six hours |
| **D** | Product plumbing — onboarding, Gemini cost control, caching | Only matters once A–C are real |

The organising idea behind B and C is that **the app should know what time it is**.
A is what makes the numbers on those surfaces worth showing.

## What the measurement is worth

FPL publishes its own expected-points figure — `ep_next` in the live API, and the
`xP` column in the historical archive. That makes it a free benchmark, and the honest
bar is not "is our model good" but "does our model beat the number FPL already gives
every manager for nothing".

Measured on season **2025-26**, the most recent season under the **current scoring
rules**, across the 11 gameweeks where `xP` is populated:

| Segment | n | RMSE | MAE | Spearman | predict-the-mean RMSE |
| --- | ---: | ---: | ---: | ---: | ---: |
| All rows | 8302 | 1.636 | 0.874 | 0.765 | 2.385 |
| **Starters (`starts == 1`)** | **2422** | **2.691** | **1.933** | **0.507** | **3.176** |

The all-rows figure is flattered: most rows are players who did not play and scored
near zero, which is trivially predictable. The decision-relevant number is the second
row — among players who actually started, FPL's own xP reaches Spearman 0.507 and
improves on a constant prediction by only about 15% of RMSE.

(The equivalent 2024-25 figures under the *old* rules were RMSE 2.640 and Spearman
0.522 — statistically indistinguishable. The difficulty is a property of the game,
not of the rule change.)

This is not a flaw in FPL's model. Single-gameweek FPL scoring is genuinely dominated
by variance. Two consequences follow, and they shape the whole product:

- Any single-gameweek point estimate is weak, including whatever we build. Presenting
  one as authoritative is misleading regardless of whose model produced it.
- The defensible position is therefore not accuracy but **honesty**: publish the
  distribution, publish how often we are right, and recommend the decision that
  survives the uncertainty. No competing FPL tool shows its error bars.

## Goals

1. Make every published number measurable against real outcomes.
2. Fix the six defects, each guarded by a named regression test.
3. Derive variance from historical residuals so the Monte Carlo means something.
4. Establish whether our model beats FPL's own xP, and behave honestly if it does not.
5. Give the repository its first tests, on the code where silent regression is
   most expensive.

## Non-goals

UI redesign, tab restructuring, Gemini prompt or cost changes, and the outstanding
Cloudflare-Worker-to-Render proxy migration. Those belong to sub-projects B, C and D.

## Architecture

Everything below is pure and framework-free. Nothing imports from `next`.

```
scripts/backtest.ts              CLI entry point
src/lib/backtest/
  csv.ts        RFC4180 parser; rejects rows whose field count differs from header
  corpus.ts     download, cache and manifest the vaastav gameweek CSVs
  panel.ts      assemble the player-gameweek panel, ordered by round
  features.ts   build features from rounds < t   ← leak-free by construction
  evaluate.ts   RMSE / MAE / Spearman / calibration / interval coverage
  report.ts     JSON artefact plus human-readable summary
src/lib/projections/
  model.ts      the corrected closed-form model (pure)
  variance.ts   variance fitted from historical residuals
```

`src/lib/projections/model.ts` is currently 226 lines doing feature derivation,
scoring and variance together. Splitting it is part of the work, not incidental to it:
the feature/scoring boundary is what makes the leakage guarantee expressible.

### Guarding the evaluator against degenerate inputs

An early measurement pass reported `NaN` rank correlations and a pooled RMSE *worse*
than predicting the mean. The cause was not parsing, as first assumed: it was that the
`xP` column is entirely zero in some gameweek files, so the predictor has zero
variance and Spearman's denominator collapses. The metric was undefined, not bad.

(The "commas in player names break a naive parser" theory was checked and rejected —
across fifteen files spanning 2023-24 to 2025-26 there are **zero** quoted fields and
**zero** rows whose field count disagrees with the header. `csv.ts` still validates
field counts, because the upstream format is not contractual, but it is a guard rather
than a fix for an observed bug.)

The real requirement this produces: `evaluate.ts` must detect degenerate inputs —
constant predictions, constant actuals, or an empty set — and return an explicit
"undefined" result with a reason, never a `NaN` that flows into a report and reads as
a number. This has its own test.

## Data

Two sources, used for different purposes.

### Source 1 — historical archive

[`vaastav/Fantasy-Premier-League`](https://github.com/vaastav/Fantasy-Premier-League),
`data/{season}/gws/gw{n}.csv` — 45 columns per player per gameweek, ten complete
seasons, actively maintained (last push 2026-08-21).

**The scoring rules changed in 2025-26** (defensive contribution). This constrains
the corpus more than it first appears, and splits it into two tiers:

| Tier | Seasons | Usable for |
| --- | --- | --- |
| **Rule-correct** | 2025-26 (38 gws, 29,757 rows) | Fitting and validating the **points mapping**, calibration, and the ship gate |
| **Rule-independent** | 2023-24, 2024-25 | Only sub-models the rule change does not touch: minutes modelling, xG→goal conversion, BPS/bonus behaviour |

Tier-2 seasons must never be used to fit or validate the points mapping. Seasons
before 2022-23 are excluded entirely — per-match `expected_goals`/`expected_assists`
are not populated.

`data/2026-27/` exists but has no `gws/` directory; the current season is not yet
archived.

### Source 2 — forward collection (this season)

The archive cannot be relied on for the benchmark. `xP` coverage per season:

| Season | gameweeks with `xP` | rows |
| --- | ---: | ---: |
| 2023-24 | 37 / 38 | 16,943 |
| 2024-25 | 35 / 38 | 15,857 |
| **2025-26** | **11 / 38** | **5,099** |

So we collect our own, which is cheap and makes the calibration claim sustainable
rather than a one-off:

- **Pre-deadline snapshot** of `bootstrap-static` — captures the features *and* FPL's
  `ep_next` (verified populated for 514 / 614 players).
- **Post-settlement pull** of `event/{gw}/live/` — full actuals including
  `defensive_contribution`, `bps`, `starts`, `minutes`.

That yields a rule-correct, leak-free, benchmark-complete panel from GW2 of 2026-27
onwards. The archive backfills history; forward collection secures the future.

### Feature derivation

Rolling features are rebuilt from per-match values rather than consuming FPL's live
`expected_goals_per_90`, `form` and `ict_index` fields:

- Leak-free by construction, since only rounds `< t` are visible.
- Reproducible historically, whereas the live fields are a snapshot the API will not
  serve retroactively.
- Eliminates defect 3 structurally — we control the window instead of inheriting a
  season cumulative.

### Splits

The 11 gameweeks of 2025-26 carrying `xP` are `1,2,3,4,5,6,8,9,24,29,38` — heavily
front-loaded, so a naive "hold out the last third" split would leave only two
gameweeks with a benchmark. Instead:

- **Benchmark/holdout set:** gameweeks `4,5,6,8,9,24,29,38`. These carry `xP` *and*
  have at least three prior rounds of history, which the rolling features require.
  Gameweeks 1–3 are excluded as feature-poor.
- **Fit/tune set:** the remaining 2025-26 gameweeks (`7,10–23,25–28,30–37`), disjoint
  from the benchmark set.
- **Rule-independent sub-models** may additionally draw on 2023-24 and 2024-25.

This is a genuinely disjoint split, so the gate is honest.

### Caching and reproducibility

Downloaded CSVs cache under `.backtest/` (gitignored — upstream is 178 MB). A manifest
committed to the repository records season, round, row count and content hash per file,
so a run can be verified as reproducing a previous one. Downloads are resumable;
failures are loud. Gaps are recorded explicitly and never silently skipped.

## The leakage guarantee

`buildFeatures(history, round)` throws if handed any row with `round >= t`.

This makes leakage a bug the harness structurally cannot express, rather than one a
reviewer has to notice. It is asserted by test.

## Model changes

Each defect gets a named regression test, so the specific failure cannot recur.

| # | Defect | Fix | Test name |
|---|---|---|---|
| 1 | Minutes probability squared | Split into `pStart`, `p60`, `xMinutes`; apply once | `minutes probability is applied exactly once` |
| 2 | `formBoost` double-counts | Remove it; the signal already lives in rolling xG/xA/bonus | `form is not added on top of component terms` |
| 3 | Bonus from season-cumulative ICT | Rolling BPS per 90 over the last *k* starts | `bonus expectation does not drift with season progress` |
| 4 | FDR applied three times | Once, via opponent strength; drop the flat penalty | `fixture difficulty is applied exactly once` |
| 5 | Variance is an invented constant | Fit from historical residuals by position and xP bucket | `variance is derived from residuals, not constants` |
| 6 | No defensive-contribution term | Model P(DC ≥ threshold) from rolling CBIT/recoveries; award 2 pts | `defensive contribution points are modelled` |

Defect 3's test is worth stating precisely, since it is the subtle one: feeding the
model an identical player at GW5 and at GW30 must produce the same bonus term. Today
it does not.

The defensive-contribution thresholds in defect 6 were derived from the data, not from
the rulebook. Decomposing actual points into their components across six 2025-26
gameweeks and bucketing by the `defensive_contribution` count gives a step function
with no exceptions:

| Position group | DC below threshold | DC at or above threshold |
| --- | --- | --- |
| DEF | 0 awarded / 420 | 135 awarded / 135 — threshold **10** |
| MID, FWD | 0 awarded / 951 | 106 awarded / 106 — threshold **12** |

The points-decomposition function used to establish this is itself a deliverable: the
evaluator needs it to attribute error to a scoring component rather than only
reporting an aggregate residual.

## Evaluation

Every run reports against three baselines:

1. **Predict-the-mean** — the floor. A model that does not beat this is noise.
2. **FPL's own expected points** (`xP` historically, `ep_next` going forward) — the
   bar (2025-26 starters: RMSE 2.691, Spearman 0.507).
3. **The current model** — what we are replacing, so the improvement is quantified.

Segmented by: all rows, starters only, by position, and by price band. Starters is the
headline segment; all-rows is reported for completeness but is not the decision metric.

Reported metrics: RMSE, MAE, Spearman rank correlation, a calibration curve (bucket
predictions, compare predicted against realised), and Monte-Carlo interval coverage —
an 80% interval must contain the truth close to 80% of the time.

`evaluate.ts` refuses to emit a report when the holdout set falls below a minimum row
count, rather than producing a confident-looking figure from thin data.

## Ship gate

**We publish our own xP in the UI only if it beats FPL's expected-points figure on the
held-out benchmark set, on both RMSE and Spearman. Otherwise we display FPL's number
and say so.**

The gate runs in two stages, because the archive benchmark is thin and partially
front-loaded:

- **Stage 1 — now.** Beat FPL's `xP` on 2025-26 gameweeks `4,5,6,8,9,24,29,38`, with
  the model fitted only on the disjoint remainder. Targets: RMSE < 2.691 and
  Spearman > 0.507 on starters. Roughly 2,400 starter rows, under current scoring rules.
- **Stage 2 — ongoing.** Once six or more gameweeks of forward-collected 2026-27 data
  exist, re-run the gate against FPL's `ep_next` on genuinely out-of-sample,
  rule-correct, benchmark-complete rows. Stage 2 supersedes Stage 1 as the published
  figure.

This is the mechanism that makes the calibration claim honest rather than marketing,
and it is deliberately automatic: the report determines what ships, not a judgement
call made after reading the report.

## Error handling

- Corpus downloads are resumable, checksummed per file, and fail loudly.
- Missing seasons or gameweeks are recorded as explicit gaps in the manifest and
  reported in the run summary. Never silently skipped.
- `buildFeatures` throws on any future-round row.
- `evaluate` refuses to report below a minimum holdout size.
- The CSV parser rejects rows whose field count does not match the header, rather
  than producing a misaligned record.
- `evaluate` returns an explicit undefined-with-reason result for degenerate inputs
  (zero-variance predictions or actuals, empty sets) instead of emitting `NaN`.

## Testing

Runner: **vitest** — ESM-native, works with the existing TypeScript path aliases,
one dev dependency.

- Unit tests per model term.
- The five named regression tests above.
- Property tests: xP is monotonic in xG90; never negative; never NaN.
- A frozen golden fixture of roughly 20 players with expected xP, so refactoring is
  safe.
- The leakage test.
- CSV parser tests: header/field-count mismatch is rejected; quoted fields and
  escaped quotes parse correctly (defensive — not observed upstream, but the format
  is not contractual).
- Evaluator degeneracy tests: constant predictions, constant actuals, and empty input
  each return an explicit undefined-with-reason result rather than `NaN`.

Coverage target ≥80% on `src/lib/projections/` and `src/lib/backtest/`.

## Deliverables

1. `src/lib/backtest/` — corpus, parser, panel, features, evaluate, report, plus a
   points-decomposition function that splits actual points into scoring components.
2. `src/lib/projections/` — corrected model, residual-fitted variance.
3. `scripts/backtest.ts` plus an `npm run backtest` script.
4. Vitest configured, with the test suite above.
5. A gameweek snapshot collector — pre-deadline `bootstrap-static` (features +
   `ep_next`) and post-settlement `event/{gw}/live/` (actuals), persisted to Upstash.
   Small, and it is what keeps calibration honest beyond a single run.
6. A committed evaluation summary and a `/api/model-report` endpoint serving it.
7. A small calibration panel — "we said X%, it happened Y%" — as the first piece of
   sub-project C's Review mode.

## Success criteria

- Corrected model beats FPL's `xP` on the held-out 2025-26 benchmark gameweeks for
  starters, on both RMSE (< 2.691) and Spearman (> 0.507), **or** the ship gate
  correctly withholds our numbers.
- A defensive-contribution term exists and measurably improves DEF/MID accuracy
  against the 2025-26 holdout.
- 80% Monte-Carlo intervals achieve 78–82% empirical coverage (in-sample — variance
  is fitted on the same predictions this coverage is measured over, so this is a
  self-consistency check, not independent validation; a held-out split for variance
  fitting is out of scope here).
- A named regression test exists for each of the six defects.
- Coverage ≥80% on both new directories.
- `npm run backtest` reproduces a committed report from the manifest.

## Open questions

- Rolling-window length *k* for the BPS and xG/xA features is a tuning parameter to
  be fitted, not chosen up front.
- Whether team strength comes from FPL's `strength_*` fields or is derived from
  rolling `expected_goals_conceded` in the panel. Derived is likely better and costs
  little; to be settled by measurement during implementation.
- Where snapshots are persisted. Upstash Redis is already wired in for AI caching and
  is the default assumption, but a full-season panel may outgrow a free tier; blob
  storage is the fallback. To be sized during implementation.
