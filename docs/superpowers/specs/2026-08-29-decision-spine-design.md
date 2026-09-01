# Decision spine — design

Sub-project B of four. Status: proposed, 2026-08-29.

Depends on sub-project A (trust foundation), merged 2026-08-29.

## The problem

The app has plenty to say and no opinion. Five tabs, forty components,
twenty-four API routes, two independent recommendation engines — and no answer
to the only question a manager actually opens it with: **what do I do this
week?**

Both engines already exist and both are buried:

- `generateTransferOptions` returns `TransferOption[]`, each carrying
  `overtakeImpact` — a per-rival before/after overtake probability — and
  `overtakeSum` as its ranking key. This is already rival-relative, which is
  the app's premise.
- The Gemini coach returns `AiRecommendation` with transfers, captain, XI,
  bench, chip and a multi-gameweek plan.

Neither is authoritative. They sit in different tabs and can disagree, and the
user is left to arbitrate between two machines.

## What the spine is

One surface, rendered on landing, that names **the single decision most worth
making this week** — or says plainly that there isn't one.

It owns two decision types: **transfers** and **captain**. Within those it
leads with whichever moves the user's league position most, compared on a
common scale. "Do nothing" is a first-class candidate and will frequently win.

Every claim it makes is evidence-linked: tapping a claim opens the existing
panel that justifies it. Nothing is deleted; the existing tabs are demoted
from peers to evidence.

## The rule that makes it trustworthy

Sub-project A measured this model at Spearman 0.155 against FPL's own xP at
0.529, and put a "Directional" badge on the dashboard. A surface that then
issues confident weekly instructions off that model would spend the trust A
just built.

So the spine recommends an action **only when the action's edge survives the
model's own uncertainty**. Concretely:

> Recommend an action only when the 80% batch-spread interval on its overtake-
> probability delta, versus doing nothing, excludes zero.

That interval — the 10th/90th percentile spread across forty batch means — is
a deliberately conservative noise floor, not a credible interval on the true
delta: it carries no parameter uncertainty from the projections themselves.

When no action clears that bar the verdict is "roll it" — stated as a
positive finding, not an absence. This is the correct answer in most real FPL
weeks, and no competing tool says it, because manufacturing a weekly pick is
what drives re-engagement.

A hit shifts the baseline rather than the bar: a −4 action is compared against
doing nothing with four points already deducted, so it must clear a
substantially higher hurdle to be recommended at all.

## Engine

Three defects in the current simulator have to be fixed first, because the
decision rule cannot be built on top of them.

### 1. Determinism

`computeOvertakeOdds` calls `Math.random()` directly. The same squad in the
same gameweek produces different odds on every request, so the headline
overtake percentage visibly jitters on refresh — and a verdict that changes
when you reload is not a verdict.

Replace with a seeded PRNG, seeded from `(gameweek, userEntryId)`. Identical
inputs must produce an identical verdict, and the seed must be stable across
processes so two devices agree.

### 2. Common random numbers

The simulator draws independent samples per scenario. Comparing a squad before
and after a one-player transfer that way estimates a small difference as the
difference of two independently noisy quantities — the sampling noise is far
larger than the effect being measured, and the batch-spread interval in the
decision rule would almost never exclude zero for the wrong reason.

Every scenario in a comparison must therefore be evaluated on **the same
underlying draws**. Fourteen of fifteen players are unchanged by a transfer;
holding their sampled scores fixed isolates the effect of the one change. This
is the standard variance-reduction technique for exactly this comparison, and
it is what makes the honest decision rule usable rather than permanently
inconclusive.

### 3. The delta needs a distribution, not a point

Today `overtakeImpact.delta` is a single number. The rule needs its spread.

Run the paired simulation as **40 independent batches of 500 draws** — 20,000
total, an order of magnitude above today's 2,000, which the pairing makes
affordable because the variance per draw is far lower. Each batch yields one
delta estimate; the 10th and 90th percentiles across the 40 give the 80%
interval. Batch seeds derive from the run seed, so the interval is as
reproducible as the point estimate.

### Candidate set

Deliberately small:

- **Roll** — the baseline, always present.
- **Each `TransferOption`** already produced by `generateTransferOptions`.
- **Each plausible captain change** — the current captain versus the **three**
  highest-xP starting-XI players who are not already captain. Three keeps the
  candidate set small enough to simulate cheaply while covering every captain
  pick a manager would realistically weigh.

Transfers and captain changes are commensurable because both are scored the
same way: the change in probability of finishing above each tracked rival,
summed. That is what lets the spine lead with a captain switch in a week where
no transfer is worth making.

## Data flow

A new route, `GET /api/decision`, composes what already exists rather than
recomputing it:

```
rivals + squads          (existing)
        ↓
projectSquad             (existing, now via the shared scorer)
        ↓
generateTransferOptions  (existing)
        ↓
enumerate candidates  →  paired Monte Carlo  →  rank by delta
        ↓
Decision { verdict, alternatives, evidence }
```

The route is deterministic and makes no AI call. The Gemini coach stays in its
own tab. This keeps the spine free to render on every landing without a
per-view model cost, and keeps its reasoning inspectable — a self-reported
`confidence: "high"` from a language model is not a measurement, and the whole
point of this surface is that its claims are measured.

### Shape

```ts
interface Decision {
  verdict: Action;            // may be the roll action
  alternatives: Action[];     // ranked, for "what else did you consider"
  deadline: { gw: number; iso: string; hoursRemaining: number };
  gateStatus: "recommend" | "too-close" | "locked";
}

interface Action {
  kind: "roll" | "transfer" | "captain";
  headline: string;           // "Roll your transfer" / "Bring in Semenyo"
  overtakeDelta: {
    mean: number;
    lower80: number;
    upper80: number;
    perRival: Array<{ rivalName: string; before: number; after: number }>;
  };
  hitCost: number;            // 0 or -4, -8 …
  evidence: Evidence[];
}

interface Evidence {
  label: string;              // "Szoboszlai vs Semenyo"
  tab: "squad" | "rival" | "ai" | "matches" | "draft";
  params?: Record<string, string>;
}
```

`gateStatus: "locked"` covers the post-deadline case: the decision is made, so
the spine states what was locked in rather than pretending a choice remains.
Richer gameweek-phase behaviour belongs to sub-project C; B only needs to not
lie once the deadline passes.

## UI

One component, `DecisionSpine`, rendered above the tab bar on the dashboard and
composed of three small pieces:

- **Verdict** — the headline, the overtake delta with its interval, and the
  deadline countdown.
- **Why** — two or three evidence chips, each navigating to the tab that
  justifies it.
- **Considered** — a collapsed list of ranked alternatives, so a user who
  disagrees can see what was weighed and why it lost.

When `gateStatus` is `"too-close"` the verdict reads as a finding — *"Nothing
this week clears the noise. Roll your transfer."* — with the closest candidate
and its interval shown underneath, so the user can see how close it was and
overrule if they want.

The existing `ModelTrustBadge` from sub-project A sits inside the verdict
rather than beside it: the spine is the strongest claim the app makes, so it
carries the caveat about the model that produced it.

## Failure modes

| Condition | Behaviour |
|---|---|
| No rivals (user is top, or a one-entry league) | Fall back to overall-rank delta; never render an empty spine |
| No transfer options (no bank, no legal move) | Roll is the only candidate; say so |
| Projections unavailable (FPL down) | Render the deadline and an explicit unavailable state, not a stale verdict |
| Deadline passed | `gateStatus: "locked"`, no recommendation |
| Fewer than 3 prior rounds of history (GW1–3) | Say the model has too little history; do not recommend |

The last one matters: it is the same `MIN_HISTORY_ROUNDS` honesty already in
the backtest, applied to the live path.

## Testing

- The decision rule as a pure function, given synthetic deltas: recommends when
  the interval excludes zero, rolls when it does not, and requires a larger
  edge when a hit is involved.
- Determinism: identical inputs produce an identical verdict across repeated
  calls and fresh processes.
- Common random numbers: the paired delta's variance is demonstrably smaller
  than the unpaired equivalent on the same scenario. This is the claim that
  makes the rule workable, so it is asserted, not assumed.
- Candidate enumeration: roll is always present; captain alternatives exclude
  the current captain; a transfer that breaks squad legality never appears.
- Every failure-mode row above.

The repo now has vitest and an 80% line threshold from sub-project A. New code
under `src/lib/decision/**` joins that threshold.

## Success criteria

1. Landing on the dashboard answers "what do I do this week" without a tap.
2. The verdict is stable — the same gameweek and squad give the same answer on
   refresh, on a second device, and after a redeploy.
3. In a week where nothing clears the bar, the app says so rather than
   inventing a pick.
4. Every claim reaches its supporting evidence in one tap.
5. No new per-view AI cost.
6. The paired simulator's delta variance is measurably below the unpaired
   baseline.

## Out of scope

- **Chips and XI/bench ordering.** Roughly five chip decisions a season and a
  low-stakes weekly bench order would dilute a surface that has to be readable
  in one glance. They stay where they are.
- **Multi-gameweek planning.** `PlanPanel` keeps it.
- **Gameweek-phase behaviour** beyond not lying after the deadline — that is
  sub-project C.
- **Improving the projection model.** B makes the app honest about the model it
  has. Sub-project A's follow-ups list the model work.
- **Replacing the AI coach.** It keeps its tab, and it sees live news the model
  structurally cannot.

## Open question

Placement was not settled before this was written. The spec assumes the spine
renders on landing above the tab bar, with tabs demoted to evidence. The two
lighter alternatives — a persistent card that leaves the tabs as peers, or a
sixth tab keeping the spine strictly optional — change the UI section and
nothing else. The engine, route and decision rule are identical either way.
