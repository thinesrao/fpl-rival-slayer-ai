# Decision Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One surface, on landing, that names the single decision most worth making this week — transfer or captain — or says plainly that nothing clears the model's own noise.

**Architecture:** A deterministic, seeded Monte-Carlo engine compares each candidate action against doing nothing using *common random numbers*, so the delta between two nearly-identical squads is measured on identical draws rather than as the difference of two independently noisy estimates. Batching that simulation yields a distribution for the delta, and an action is recommended only when its 80% credible interval excludes zero. A new `/api/decision` route composes existing rival, projection and transfer-option machinery; a new `DecisionSpine` component renders the verdict above the tab bar with every claim linking to the tab that justifies it.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, vitest, TanStack Query, Tailwind + local shadcn-style primitives. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-29-decision-spine-design.md`

## Global Constraints

- Node 24.x. TypeScript strict mode. `@/*` maps to `./src/*`.
- **No new dependencies**, runtime or dev.
- No `console.log` anywhere in `src/`.
- Commits are SSH-signed via existing repo-local git config. Run `git commit` normally — never pass `-S`, never change git config.
- Coverage thresholds are enforced at 80% lines. `src/lib/decision/**` joins that list in Task 10.
- The decision engine makes **no AI call**. The Gemini coach keeps its own tab.
- Batch counts and draw counts are exact: **40 batches of 500 draws** (20,000 total).
- Captain candidates are exactly the **three** highest-xP starting-XI players who are not already captain.
- Deploys go via `git push` — `vercel deploy` from the CLI returns `Not authorized` on this account. Vercel Hobby allows at most 2 cron jobs; this plan adds none.
- `PlayerProjection`, `SquadProjection`, `OvertakeOdds`, `RivalContext`, `ManagerSquad` and `SquadSlot` in `src/lib/types.ts` are public interfaces consumed across the app. Do not change their existing fields.

---

### Task 1: Seeded random number generator

The engine must be reproducible: the same gameweek and squad must give the same verdict on refresh, on a second device, and after a redeploy. `Math.random()` cannot do that.

**Files:**
- Create: `src/lib/decision/rng.ts`
- Test: `src/lib/decision/rng.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `hashSeed(...parts: Array<string | number>): number`
  - `mulberry32(seed: number): () => number`
  - `normalSampler(rng: () => number): (mean: number, stdev: number) => number`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/decision/rng.test.ts
import { describe, expect, it } from "vitest";

import { hashSeed, mulberry32, normalSampler } from "@/lib/decision/rng";

describe("hashSeed", () => {
  it("is stable for the same parts", () => {
    expect(hashSeed(3, 4778037)).toBe(hashSeed(3, 4778037));
  });

  it("differs for different parts", () => {
    expect(hashSeed(3, 4778037)).not.toBe(hashSeed(4, 4778037));
    expect(hashSeed(3, 4778037)).not.toBe(hashSeed(3, 4778038));
  });

  it("returns a non-negative 32-bit integer", () => {
    const h = hashSeed("gw", 12, "entry", 999999);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});

describe("mulberry32", () => {
  it("produces the same sequence for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces a different sequence for a different seed", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("stays within [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("normalSampler", () => {
  it("recovers the mean and stdev to within sampling error", () => {
    const sample = normalSampler(mulberry32(42));
    const xs = Array.from({ length: 20000 }, () => sample(50, 10));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
    expect(mean).toBeCloseTo(50, 0);
    expect(Math.sqrt(variance)).toBeCloseTo(10, 0);
  });

  it("is deterministic for a given seed", () => {
    const a = normalSampler(mulberry32(9))(0, 1);
    const b = normalSampler(mulberry32(9))(0, 1);
    expect(a).toBe(b);
  });

  it("returns the mean exactly when stdev is zero", () => {
    expect(normalSampler(mulberry32(1))(7, 0)).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/decision/rng.test.ts`
Expected: FAIL — cannot resolve `@/lib/decision/rng`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/decision/rng.ts
// Seeded randomness for the decision engine.
//
// The verdict this engine produces is the strongest claim the app makes, so it
// must not change when the user hits refresh. Math.random() cannot give us
// that; a seeded generator keyed on (gameweek, entry) can, and it also lets
// two scenarios be compared on identical draws — see simulate.ts.

/** FNV-1a over the joined parts. Stable across processes and platforms. */
export function hashSeed(...parts: Array<string | number>): number {
  const s = parts.join(":");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small, fast, well-distributed PRNG. Returns values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller normal draws from a supplied uniform generator. */
export function normalSampler(rng: () => number): (mean: number, stdev: number) => number {
  return function sample(mean: number, stdev: number): number {
    if (stdev <= 0) return mean;
    const u1 = rng() || 1e-12;
    const u2 = rng() || 1e-12;
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + stdev * z;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/decision/rng.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/decision/rng.ts src/lib/decision/rng.test.ts
git commit -m "feat(decision): seeded RNG so a verdict survives a refresh"
```

---

### Task 2: Make the existing overtake simulation deterministic

`computeOvertakeOdds` calls `Math.random()` directly, so the headline overtake percentage on the dashboard visibly changes on every reload. Fix it in place before building on it.

**Files:**
- Modify: `src/lib/projections/overtake.ts`
- Modify: `src/lib/projections/index.ts`
- Test: `src/lib/projections/overtake.test.ts` (exists — extend it)

**Interfaces:**
- Consumes: `mulberry32`, `hashSeed`, `normalSampler` from `@/lib/decision/rng` (Task 1).
- Produces: `computeOvertakeOdds(ctx, userProj, rivalProjs, simulations?, rng?)` — a fifth optional parameter `rng: () => number` defaulting to `Math.random`. Existing four-argument callers keep working unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/projections/overtake.test.ts`:

```ts
describe("determinism", () => {
  it("returns identical odds for the same seed", () => {
    const a = computeOvertakeOdds(ctx, userProj, rivalProjs, 500, mulberry32(1));
    const b = computeOvertakeOdds(ctx, userProj, rivalProjs, 500, mulberry32(1));
    expect(a).toEqual(b);
  });

  it("returns different odds for a different seed", () => {
    const a = computeOvertakeOdds(ctx, userProj, rivalProjs, 500, mulberry32(1));
    const b = computeOvertakeOdds(ctx, userProj, rivalProjs, 500, mulberry32(2));
    expect(a[0].overtakeProbability).not.toBe(b[0].overtakeProbability);
  });

  it("still works without an explicit rng", () => {
    const odds = computeOvertakeOdds(ctx, userProj, rivalProjs, 100);
    expect(odds).toHaveLength(rivalProjs.length);
    expect(odds[0].overtakeProbability).toBeGreaterThanOrEqual(0);
    expect(odds[0].overtakeProbability).toBeLessThanOrEqual(1);
  });
});
```

Add the import at the top of the file: `import { mulberry32 } from "@/lib/decision/rng";`

If `src/lib/projections/overtake.test.ts` does not already define `ctx`, `userProj` and `rivalProjs` fixtures, add them:

```ts
const squad = (entryId: number, points: number, stdev: number): SquadProjection => ({
  entryId,
  startingXIPoints: points,
  benchPoints: 4,
  totalExpected: points + 0.4,
  stdev,
  perPlayer: [],
});

const managerSquad = (id: number, name: string, total: number, rank: number) =>
  ({
    entry: { id, name, player_name: name, total, rank },
    gw: 3,
    picks: [],
    starters: [],
    bench: [],
    captain: undefined,
    viceCaptain: undefined,
    activeChip: null,
  }) as unknown as ManagerSquad;

const ctx = {
  user: managerSquad(1, "Me", 100, 5),
  rivals: [managerSquad(2, "Rival", 105, 4)],
  leagueName: "Test",
} as RivalContext;
const userProj = squad(1, 50, 10);
const rivalProjs = [squad(2, 48, 10)];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/projections/overtake.test.ts`
Expected: FAIL — `computeOvertakeOdds` takes four arguments; the fifth is ignored so both seeded calls differ.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/projections/overtake.ts`, replace the local `normalSample` helper and the signature:

```ts
import { normalSampler } from "@/lib/decision/rng";
import type { OvertakeOdds, RivalContext, SquadProjection } from "@/lib/types";

export function computeOvertakeOdds(
  ctx: RivalContext,
  userProj: SquadProjection,
  rivalProjs: SquadProjection[],
  simulations = 2000,
  rng: () => number = Math.random,
): OvertakeOdds[] {
  const sample = normalSampler(rng);
  const odds: OvertakeOdds[] = [];
  // ... body unchanged, but every `normalSample(` call becomes `sample(`
```

Delete the file-local `function normalSample(...)`. Leave every other line of the function body as it is.

In `src/lib/projections/index.ts`, seed the call so the dashboard's headline number is stable:

```ts
import { hashSeed, mulberry32 } from "@/lib/decision/rng";
// ...
const overtake = computeOvertakeOdds(
  ctx,
  user,
  rivals,
  2000,
  mulberry32(hashSeed("overtake", gw, ctx.user.entry.id)),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run` — the whole suite, since `index.ts` changed.
Expected: PASS, all existing tests plus 3 new.

- [ ] **Step 5: Commit**

```bash
git add src/lib/projections/overtake.ts src/lib/projections/index.ts src/lib/projections/overtake.test.ts
git commit -m "fix(projections): seed the overtake simulation

The dashboard's headline overtake percentage was drawn from Math.random(),
so it changed on every refresh. Seed it on (gw, entry) instead."
```

---

### Task 3: Paired simulator with a delta distribution

The heart of the engine. Comparing a squad before and after a one-player change using independent draws measures a small effect as the difference of two noisy estimates. Evaluating both scenarios on *the same* draws isolates the change.

**Files:**
- Create: `src/lib/decision/simulate.ts`
- Test: `src/lib/decision/simulate.test.ts`

**Interfaces:**
- Consumes: `mulberry32`, `normalSampler` from `@/lib/decision/rng`; `SquadProjection` from `@/lib/types`.
- Produces:
  - `BATCHES = 40`, `DRAWS_PER_BATCH = 500`
  - `interface RivalTarget { entryId: number; name: string; expected: number; stdev: number; pointsBehind: number }`
  - `interface DeltaDistribution { mean: number; lower80: number; upper80: number; perRival: Array<{ rivalEntryId: number; rivalName: string; before: number; after: number }> }`
  - `simulateDelta(args: { baseline: SquadProjection; variant: SquadProjection; rivals: RivalTarget[]; seed: number }): DeltaDistribution`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/decision/simulate.test.ts
import { describe, expect, it } from "vitest";

import { type RivalTarget, simulateDelta } from "@/lib/decision/simulate";
import type { SquadProjection } from "@/lib/types";

const squad = (points: number, stdev = 12): SquadProjection => ({
  entryId: 1,
  startingXIPoints: points,
  benchPoints: 4,
  totalExpected: points + 0.4,
  stdev,
  perPlayer: [],
});

const rival = (over: Partial<RivalTarget> = {}): RivalTarget => ({
  entryId: 2,
  name: "Rival",
  expected: 50,
  stdev: 12,
  pointsBehind: 0,
  ...over,
});

describe("simulateDelta", () => {
  it("reports a positive mean delta when the variant scores more", () => {
    const d = simulateDelta({ baseline: squad(50), variant: squad(56), rivals: [rival()], seed: 1 });
    expect(d.mean).toBeGreaterThan(0);
  });

  it("reports a negative mean delta when the variant scores less", () => {
    const d = simulateDelta({ baseline: squad(50), variant: squad(44), rivals: [rival()], seed: 1 });
    expect(d.mean).toBeLessThan(0);
  });

  it("reports a delta of exactly zero when the scenarios are identical", () => {
    const d = simulateDelta({ baseline: squad(50), variant: squad(50), rivals: [rival()], seed: 1 });
    expect(d.mean).toBe(0);
    expect(d.lower80).toBe(0);
    expect(d.upper80).toBe(0);
  });

  it("brackets the mean with its 80% interval", () => {
    const d = simulateDelta({ baseline: squad(50), variant: squad(53), rivals: [rival()], seed: 3 });
    expect(d.lower80).toBeLessThanOrEqual(d.mean);
    expect(d.upper80).toBeGreaterThanOrEqual(d.mean);
  });

  it("is deterministic for a given seed", () => {
    const args = { baseline: squad(50), variant: squad(53), rivals: [rival()], seed: 11 };
    expect(simulateDelta(args)).toEqual(simulateDelta(args));
  });

  it("differs for a different seed", () => {
    const base = { baseline: squad(50), variant: squad(53), rivals: [rival()] };
    expect(simulateDelta({ ...base, seed: 1 }).mean).not.toBe(simulateDelta({ ...base, seed: 2 }).mean);
  });

  it("reports before and after probabilities per rival", () => {
    const d = simulateDelta({
      baseline: squad(50),
      variant: squad(56),
      rivals: [rival({ entryId: 2, name: "A" }), rival({ entryId: 3, name: "B", expected: 60 })],
      seed: 5,
    });
    expect(d.perRival).toHaveLength(2);
    expect(d.perRival[0].rivalName).toBe("A");
    expect(d.perRival[0].after).toBeGreaterThan(d.perRival[0].before);
    for (const r of d.perRival) {
      expect(r.before).toBeGreaterThanOrEqual(0);
      expect(r.before).toBeLessThanOrEqual(1);
      expect(r.after).toBeGreaterThanOrEqual(0);
      expect(r.after).toBeLessThanOrEqual(1);
    }
  });

  it("requires a bigger score gap to overtake a rival further ahead", () => {
    const near = simulateDelta({
      baseline: squad(50), variant: squad(56), rivals: [rival({ pointsBehind: 1 })], seed: 7,
    });
    const far = simulateDelta({
      baseline: squad(50), variant: squad(56), rivals: [rival({ pointsBehind: 40 })], seed: 7,
    });
    expect(near.perRival[0].after).toBeGreaterThan(far.perRival[0].after);
  });

  it("sums the delta across rivals", () => {
    const one = simulateDelta({ baseline: squad(50), variant: squad(56), rivals: [rival()], seed: 5 });
    const two = simulateDelta({
      baseline: squad(50), variant: squad(56),
      rivals: [rival({ entryId: 2 }), rival({ entryId: 3 })], seed: 5,
    });
    expect(two.mean).toBeCloseTo(one.mean * 2, 5);
  });

  it("has a smaller delta variance than independent sampling would", () => {
    // The claim that makes the decision rule usable: pairing must actually
    // reduce the spread of the estimated delta, not merely be implemented.
    const args = { baseline: squad(50), variant: squad(52), rivals: [rival()], seed: 21 };
    const paired = simulateDelta(args);
    const pairedWidth = paired.upper80 - paired.lower80;

    // Independent equivalent: simulate each scenario against its own draws by
    // giving the two scenarios different seeds and differencing the results.
    const a = simulateDelta({ ...args, variant: squad(50), seed: 21 });
    const b = simulateDelta({ ...args, baseline: squad(52), variant: squad(52), seed: 22 });
    const independentWidth = (a.upper80 - a.lower80) + (b.upper80 - b.lower80);

    expect(pairedWidth).toBeLessThan(independentWidth);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/decision/simulate.test.ts`
Expected: FAIL — cannot resolve `@/lib/decision/simulate`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/decision/simulate.ts
// Paired Monte-Carlo comparison of two versions of the same squad.
//
// A transfer changes one of fifteen players and a captain switch changes none
// of them — just a multiplier. Sampling the two scenarios independently would
// estimate that small effect as the difference of two much larger noisy
// quantities, and the interval the decision rule needs would almost never
// exclude zero, for reasons that have nothing to do with the football.
//
// So both scenarios are evaluated against the SAME draws (common random
// numbers). The rival's sampled score is shared too. What survives the
// subtraction is the effect of the change itself.
//
// Batching gives the delta a distribution: each batch is an independent
// estimate, and the 10th/90th percentiles across batches form the 80%
// interval that the decision rule tests against zero.

import { mulberry32, normalSampler } from "@/lib/decision/rng";
import type { SquadProjection } from "@/lib/types";

export const BATCHES = 40;
export const DRAWS_PER_BATCH = 500;

export interface RivalTarget {
  entryId: number;
  name: string;
  expected: number;
  stdev: number;
  /** Standings gap to close. 0 when the user is already level or ahead. */
  pointsBehind: number;
}

export interface DeltaDistribution {
  /** Mean change in summed overtake probability, variant minus baseline. */
  mean: number;
  lower80: number;
  upper80: number;
  perRival: Array<{ rivalEntryId: number; rivalName: string; before: number; after: number }>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

export function simulateDelta(args: {
  baseline: SquadProjection;
  variant: SquadProjection;
  rivals: RivalTarget[];
  seed: number;
}): DeltaDistribution {
  const { baseline, variant, rivals, seed } = args;

  const batchDeltas: number[] = [];
  const beforeHits = rivals.map(() => 0);
  const afterHits = rivals.map(() => 0);
  let totalDraws = 0;

  for (let b = 0; b < BATCHES; b++) {
    // Each batch gets its own stream, derived from the run seed so the whole
    // distribution is reproducible.
    const sample = normalSampler(mulberry32((seed + b * 0x9e3779b9) >>> 0));
    let batchDelta = 0;

    for (let d = 0; d < DRAWS_PER_BATCH; d++) {
      // One shared standard-normal draw per squad, reused across scenarios.
      const zUser = sample(0, 1);
      const baseScore = baseline.startingXIPoints + Math.max(1, baseline.stdev) * zUser;
      const varScore = variant.startingXIPoints + Math.max(1, variant.stdev) * zUser;

      for (let i = 0; i < rivals.length; i++) {
        const rival = rivals[i];
        const rivalScore = sample(rival.expected, Math.max(1, rival.stdev));
        const need = rival.pointsBehind;
        const before = baseScore - rivalScore > need ? 1 : 0;
        const after = varScore - rivalScore > need ? 1 : 0;
        beforeHits[i] += before;
        afterHits[i] += after;
        batchDelta += after - before;
      }
      totalDraws++;
    }

    batchDeltas.push(batchDelta / DRAWS_PER_BATCH);
  }

  const sorted = [...batchDeltas].sort((x, y) => x - y);
  const mean = batchDeltas.reduce((s, x) => s + x, 0) / batchDeltas.length;

  return {
    mean,
    lower80: percentile(sorted, 0.1),
    upper80: percentile(sorted, 0.9),
    perRival: rivals.map((r, i) => ({
      rivalEntryId: r.entryId,
      rivalName: r.name,
      before: beforeHits[i] / totalDraws,
      after: afterHits[i] / totalDraws,
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/decision/simulate.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/decision/simulate.ts src/lib/decision/simulate.test.ts
git commit -m "feat(decision): paired simulator with a delta distribution

Common random numbers so a one-player change is measured on identical draws
rather than as the difference of two noisy estimates, and batching so the
delta has an interval the decision rule can test against zero."
```

---

### Task 4: Decision types and the recommendation rule

The rule that keeps the surface honest: recommend only when the edge survives the model's own uncertainty.

**Files:**
- Create: `src/lib/decision/types.ts`
- Create: `src/lib/decision/rule.ts`
- Test: `src/lib/decision/rule.test.ts`

**Interfaces:**
- Consumes: `DeltaDistribution` from `@/lib/decision/simulate`.
- Produces, from `types.ts`:
  - `type ActionKind = "roll" | "transfer" | "captain"`
  - `type GateStatus = "recommend" | "too-close" | "locked" | "unavailable"`
  - `interface Evidence { label: string; tab: "squad" | "rival" | "ai" | "matches" | "draft"; params?: Record<string, string> }`
  - `interface Action { kind: ActionKind; headline: string; detail: string; overtakeDelta: DeltaDistribution; hitCost: number; evidence: Evidence[] }`
  - `interface Decision { verdict: Action; alternatives: Action[]; deadline: { gw: number; iso: string; hoursRemaining: number }; gateStatus: GateStatus; note?: string }`
- Produces, from `rule.ts`:
  - `clearsBar(action: Action): boolean`
  - `pickVerdict(roll: Action, candidates: Action[]): { verdict: Action; alternatives: Action[]; gateStatus: GateStatus }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/decision/rule.test.ts
import { describe, expect, it } from "vitest";

import { clearsBar, pickVerdict } from "@/lib/decision/rule";
import type { Action } from "@/lib/decision/types";

const action = (over: Partial<Action> & { mean: number; lower80: number; upper80: number }): Action => ({
  kind: over.kind ?? "transfer",
  headline: over.headline ?? "Do a thing",
  detail: over.detail ?? "",
  hitCost: over.hitCost ?? 0,
  evidence: over.evidence ?? [],
  overtakeDelta: {
    mean: over.mean,
    lower80: over.lower80,
    upper80: over.upper80,
    perRival: [],
  },
});

const roll = action({ kind: "roll", headline: "Roll your transfer", mean: 0, lower80: 0, upper80: 0 });

describe("clearsBar", () => {
  it("clears when the whole 80% interval is above zero", () => {
    expect(clearsBar(action({ mean: 0.05, lower80: 0.01, upper80: 0.09 }))).toBe(true);
  });

  it("does not clear when the interval straddles zero", () => {
    expect(clearsBar(action({ mean: 0.05, lower80: -0.02, upper80: 0.12 }))).toBe(false);
  });

  it("does not clear when the interval is entirely below zero", () => {
    expect(clearsBar(action({ mean: -0.04, lower80: -0.09, upper80: -0.01 }))).toBe(false);
  });

  it("does not clear when the lower bound sits exactly on zero", () => {
    // A boundary that touches zero has not demonstrated an edge.
    expect(clearsBar(action({ mean: 0.03, lower80: 0, upper80: 0.06 }))).toBe(false);
  });

  it("never clears for the roll action, whose delta is zero by definition", () => {
    expect(clearsBar(roll)).toBe(false);
  });
});

describe("pickVerdict", () => {
  it("recommends the best clearing candidate", () => {
    const weak = action({ headline: "Weak", mean: 0.02, lower80: 0.005, upper80: 0.03 });
    const strong = action({ headline: "Strong", mean: 0.08, lower80: 0.04, upper80: 0.12 });
    const out = pickVerdict(roll, [weak, strong]);
    expect(out.verdict.headline).toBe("Strong");
    expect(out.gateStatus).toBe("recommend");
  });

  it("rolls when nothing clears the bar", () => {
    const noisy = action({ headline: "Noisy", mean: 0.06, lower80: -0.01, upper80: 0.13 });
    const out = pickVerdict(roll, [noisy]);
    expect(out.verdict.kind).toBe("roll");
    expect(out.gateStatus).toBe("too-close");
  });

  it("rolls when there are no candidates at all", () => {
    const out = pickVerdict(roll, []);
    expect(out.verdict.kind).toBe("roll");
    expect(out.gateStatus).toBe("too-close");
  });

  it("ranks alternatives by mean delta, best first, excluding the verdict", () => {
    const a = action({ headline: "A", mean: 0.09, lower80: 0.05, upper80: 0.13 });
    const b = action({ headline: "B", mean: 0.04, lower80: 0.01, upper80: 0.07 });
    const c = action({ headline: "C", mean: 0.06, lower80: -0.02, upper80: 0.14 });
    const out = pickVerdict(roll, [b, c, a]);
    expect(out.verdict.headline).toBe("A");
    expect(out.alternatives.map((x) => x.headline)).toEqual(["C", "B", "Roll your transfer"]);
  });

  it("keeps the closest candidate visible when it rolls, so the user can overrule", () => {
    const near = action({ headline: "Near miss", mean: 0.05, lower80: -0.001, upper80: 0.1 });
    const out = pickVerdict(roll, [near]);
    expect(out.verdict.kind).toBe("roll");
    expect(out.alternatives[0].headline).toBe("Near miss");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/decision/rule.test.ts`
Expected: FAIL — cannot resolve `@/lib/decision/rule`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/decision/types.ts
import type { DeltaDistribution } from "@/lib/decision/simulate";

export type ActionKind = "roll" | "transfer" | "captain";

/**
 * "recommend" — an action's edge survived the model's own uncertainty.
 * "too-close" — nothing did; rolling is the honest answer.
 * "locked"    — the deadline has passed; there is nothing left to decide.
 * "unavailable" — we could not compute a verdict and will not guess.
 */
export type GateStatus = "recommend" | "too-close" | "locked" | "unavailable";

export interface Evidence {
  label: string;
  tab: "squad" | "rival" | "ai" | "matches" | "draft";
  params?: Record<string, string>;
}

export interface Action {
  kind: ActionKind;
  headline: string;
  detail: string;
  overtakeDelta: DeltaDistribution;
  /** 0, or a negative points cost such as -4 for an extra transfer. */
  hitCost: number;
  evidence: Evidence[];
}

export interface Decision {
  verdict: Action;
  alternatives: Action[];
  deadline: { gw: number; iso: string; hoursRemaining: number };
  gateStatus: GateStatus;
  /** Human-readable reason, set when the gate is not "recommend". */
  note?: string;
}
```

```ts
// src/lib/decision/rule.ts
// The rule that decides whether the app is allowed to tell you to do something.
//
// Sub-project A measured this model at Spearman 0.155 against FPL's own xP at
// 0.529. Issuing a confident weekly instruction off a model that weak would
// spend the trust that measurement bought. So an action is recommended only
// when its whole 80% credible interval sits above zero — when the edge is
// larger than the noise in our own estimate of it.
//
// Most real FPL weeks have no such action, and saying so is the point.

import type { Action, GateStatus } from "@/lib/decision/types";

/** True when the action's 80% interval lies entirely above zero. */
export function clearsBar(action: Action): boolean {
  if (action.kind === "roll") return false;
  return action.overtakeDelta.lower80 > 0;
}

export function pickVerdict(
  roll: Action,
  candidates: Action[],
): { verdict: Action; alternatives: Action[]; gateStatus: GateStatus } {
  const ranked = [...candidates].sort((a, b) => b.overtakeDelta.mean - a.overtakeDelta.mean);
  const winner = ranked.find(clearsBar);

  if (!winner) {
    // Rolling wins. Keep the near-misses visible so a user who disagrees can
    // see exactly what was weighed and how close it came.
    return { verdict: roll, alternatives: ranked, gateStatus: "too-close" };
  }

  return {
    verdict: winner,
    alternatives: [...ranked.filter((a) => a !== winner), roll],
    gateStatus: "recommend",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/decision/rule.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/decision/types.ts src/lib/decision/rule.ts src/lib/decision/rule.test.ts
git commit -m "feat(decision): recommend only when the edge beats our own noise"
```

---

### Task 5: Candidate enumeration

Turn the squad and its transfer options into the small set of actions worth simulating.

**Files:**
- Create: `src/lib/decision/candidates.ts`
- Test: `src/lib/decision/candidates.test.ts`

**Interfaces:**
- Consumes: `TransferOption` from `@/lib/optimizer/transfer-options`; `ManagerSquad`, `SquadProjection`, `PlayerProjection` from `@/lib/types`; `Evidence` from `@/lib/decision/types`.
- Produces:
  - `CAPTAIN_ALTERNATIVES = 3`
  - `interface Candidate { kind: "transfer" | "captain"; headline: string; detail: string; hitCost: number; variant: SquadProjection; evidence: Evidence[] }`
  - `captainCandidates(squad: ManagerSquad, projection: SquadProjection): Candidate[]`
  - `transferCandidates(options: TransferOption[], projection: SquadProjection, freeTransfers: number): Candidate[]`

The variant `SquadProjection` for a captain switch re-applies the multiplier: remove twice the old captain's xP and add twice the new one's, adjusting stdev accordingly. For a transfer, `netGainXi` already carries the change in starting-XI total, so the variant is the baseline shifted by it.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/decision/candidates.test.ts
import { describe, expect, it } from "vitest";

import { CAPTAIN_ALTERNATIVES, captainCandidates, transferCandidates } from "@/lib/decision/candidates";
import type { TransferOption } from "@/lib/optimizer/transfer-options";
import type { ManagerSquad, PlayerProjection, SquadProjection, SquadSlot } from "@/lib/types";

const proj = (playerId: number, webName: string, xPoints: number): PlayerProjection => ({
  playerId,
  webName,
  position: "MID",
  xPoints,
  variance: 9,
  injuryRisk: 0,
  fixtureDifficulty: 3,
  notes: [],
});

const slot = (id: number, name: string, multiplier: number): SquadSlot =>
  ({
    pick: { element: id, position: 1, multiplier, is_captain: multiplier === 2, is_vice_captain: false },
    player: { id, web_name: name },
    team: { id: 1, short_name: "AAA" },
    position: "MID",
  }) as unknown as SquadSlot;

const squad = (): ManagerSquad =>
  ({
    entry: { id: 1, name: "Me", player_name: "Me", total: 100, rank: 5 },
    gw: 3,
    picks: [slot(10, "Cap", 2), slot(11, "Alt", 1), slot(12, "Third", 1), slot(13, "Fourth", 1), slot(14, "Bench", 0)],
    starters: [slot(10, "Cap", 2), slot(11, "Alt", 1), slot(12, "Third", 1), slot(13, "Fourth", 1)],
    bench: [slot(14, "Bench", 0)],
    captain: slot(10, "Cap", 2),
    viceCaptain: slot(11, "Alt", 1),
    activeChip: null,
  }) as unknown as ManagerSquad;

const projection = (): SquadProjection => ({
  entryId: 1,
  startingXIPoints: 5 * 2 + 8 + 7 + 6, // Cap doubled, then Alt, Third, Fourth
  benchPoints: 2,
  totalExpected: 31.2,
  stdev: 12,
  perPlayer: [proj(10, "Cap", 5), proj(11, "Alt", 8), proj(12, "Third", 7), proj(13, "Fourth", 6), proj(14, "Bench", 2)],
});

const option = (over: Partial<TransferOption> = {}): TransferOption =>
  ({
    id: "OPT-01",
    category: "best-xp",
    outPlayerId: 13,
    outWebName: "Fourth",
    outTeamShort: "AAA",
    outCost: 50,
    outXp: 6,
    outPosition: "MID",
    inPlayerId: 20,
    inWebName: "Newman",
    inTeamShort: "BBB",
    inCost: 55,
    inXp: 9,
    netGainXi: 3,
    postBank: 5,
    overtakeImpact: [],
    overtakeSum: 0.04,
    notes: [],
    ...over,
  }) as TransferOption;

describe("captainCandidates", () => {
  it("returns exactly CAPTAIN_ALTERNATIVES candidates", () => {
    expect(captainCandidates(squad(), projection())).toHaveLength(CAPTAIN_ALTERNATIVES);
  });

  it("never proposes the current captain", () => {
    const names = captainCandidates(squad(), projection()).map((c) => c.headline);
    expect(names.some((n) => n.includes("Cap"))).toBe(false);
  });

  it("orders alternatives by expected points, highest first", () => {
    const cs = captainCandidates(squad(), projection());
    expect(cs[0].headline).toContain("Alt");
  });

  it("raises the projected total when the new captain outscores the old", () => {
    const base = projection();
    const cs = captainCandidates(squad(), base);
    expect(cs[0].variant.startingXIPoints).toBeGreaterThan(base.startingXIPoints);
  });

  it("never charges a hit for a captain change", () => {
    for (const c of captainCandidates(squad(), projection())) expect(c.hitCost).toBe(0);
  });

  it("returns nothing when there is no captain set", () => {
    const s = squad();
    (s as { captain: SquadSlot | undefined }).captain = undefined;
    expect(captainCandidates(s, projection())).toEqual([]);
  });

  it("links to the squad tab as evidence", () => {
    expect(captainCandidates(squad(), projection())[0].evidence[0].tab).toBe("squad");
  });
});

describe("transferCandidates", () => {
  it("shifts the projected total by netGainXi", () => {
    const base = projection();
    const [c] = transferCandidates([option()], base, 1);
    expect(c.variant.startingXIPoints).toBeCloseTo(base.startingXIPoints + 3, 5);
  });

  it("charges no hit while free transfers remain", () => {
    const [c] = transferCandidates([option()], projection(), 1);
    expect(c.hitCost).toBe(0);
  });

  it("charges -4 when no free transfer remains, and deducts it from the variant", () => {
    const base = projection();
    const [c] = transferCandidates([option()], base, 0);
    expect(c.hitCost).toBe(-4);
    expect(c.variant.startingXIPoints).toBeCloseTo(base.startingXIPoints + 3 - 4, 5);
  });

  it("names both players in the headline", () => {
    const [c] = transferCandidates([option()], projection(), 1);
    expect(c.headline).toContain("Newman");
    expect(c.detail).toContain("Fourth");
  });

  it("links to the rival tab as evidence", () => {
    const [c] = transferCandidates([option()], projection(), 1);
    expect(c.evidence.some((e) => e.tab === "rival")).toBe(true);
  });

  it("returns nothing for an empty option list", () => {
    expect(transferCandidates([], projection(), 1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/decision/candidates.test.ts`
Expected: FAIL — cannot resolve `@/lib/decision/candidates`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/decision/candidates.ts
// Enumerates the small set of actions worth simulating.
//
// Deliberately small: every candidate costs a full paired simulation, and a
// surface that has to be readable in one glance cannot rank forty options.

import type { Evidence } from "@/lib/decision/types";
import type { TransferOption } from "@/lib/optimizer/transfer-options";
import type { ManagerSquad, SquadProjection } from "@/lib/types";

/** How many captain alternatives to weigh, beyond the current pick. */
export const CAPTAIN_ALTERNATIVES = 3;

/** Points deducted for a transfer beyond the free allowance. */
const HIT_COST = -4;

export interface Candidate {
  kind: "transfer" | "captain";
  headline: string;
  detail: string;
  hitCost: number;
  variant: SquadProjection;
  evidence: Evidence[];
}

/** Baseline projection shifted by a change to the starting-XI total. */
function shifted(base: SquadProjection, delta: number): SquadProjection {
  return {
    ...base,
    startingXIPoints: Number((base.startingXIPoints + delta).toFixed(2)),
    totalExpected: Number((base.totalExpected + delta).toFixed(2)),
  };
}

export function captainCandidates(squad: ManagerSquad, projection: SquadProjection): Candidate[] {
  const current = squad.captain;
  if (!current) return [];

  const byId = new Map(projection.perPlayer.map((p) => [p.playerId, p]));
  const currentXp = byId.get(current.player.id)?.xPoints ?? 0;

  const alternatives = squad.starters
    .filter((s) => s.player.id !== current.player.id)
    .map((s) => ({ slot: s, xPoints: byId.get(s.player.id)?.xPoints ?? 0 }))
    .sort((a, b) => b.xPoints - a.xPoints)
    .slice(0, CAPTAIN_ALTERNATIVES);

  return alternatives.map(({ slot, xPoints }) => ({
    kind: "captain" as const,
    headline: `Captain ${slot.player.web_name}`,
    detail: `Instead of ${current.player.web_name}. Armband doubles this pick.`,
    hitCost: 0,
    // Swapping the armband removes one copy of the old captain's points and
    // adds one copy of the new one's.
    variant: shifted(projection, xPoints - currentXp),
    evidence: [
      { label: `${slot.player.web_name} vs ${current.player.web_name}`, tab: "squad" },
    ],
  }));
}

export function transferCandidates(
  options: TransferOption[],
  projection: SquadProjection,
  freeTransfers: number,
): Candidate[] {
  return options.map((option) => {
    const hitCost = freeTransfers > 0 ? 0 : HIT_COST;
    return {
      kind: "transfer" as const,
      headline: `Bring in ${option.inWebName}`,
      detail: `Sell ${option.outWebName} (${option.outTeamShort}) for ${option.inWebName} (${option.inTeamShort}).`,
      hitCost,
      variant: shifted(projection, option.netGainXi + hitCost),
      evidence: [
        { label: `${option.outWebName} → ${option.inWebName}`, tab: "squad" },
        { label: "Effect on your rivals", tab: "rival" },
      ],
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/decision/candidates.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/decision/candidates.ts src/lib/decision/candidates.test.ts
git commit -m "feat(decision): enumerate transfer and captain candidates"
```

---

### Task 6: The orchestrator

Wire enumeration, simulation and the rule into one `Decision`, including every failure mode from the spec.

**Files:**
- Create: `src/lib/decision/decide.ts`
- Test: `src/lib/decision/decide.test.ts`

**Interfaces:**
- Consumes: `captainCandidates`, `transferCandidates` (Task 5); `simulateDelta`, `RivalTarget` (Task 3); `pickVerdict` (Task 4); `hashSeed` (Task 1).
- Produces: `decide(args: DecideArgs): Decision` where

```ts
interface DecideArgs {
  squad: ManagerSquad;
  userProjection: SquadProjection;
  rivals: Array<{ entryId: number; name: string; projection: SquadProjection; pointsBehind: number }>;
  transferOptions: TransferOption[];
  freeTransfers: number;
  deadline: { gw: number; iso: string };
  now: number;
  minHistoryMet: boolean;
}
```

`now` is injected rather than read from the clock so the tests are deterministic.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/decision/decide.test.ts
import { describe, expect, it } from "vitest";

import { decide } from "@/lib/decision/decide";
import type { ManagerSquad, SquadProjection, SquadSlot } from "@/lib/types";
import type { TransferOption } from "@/lib/optimizer/transfer-options";

const slot = (id: number, name: string, multiplier: number): SquadSlot =>
  ({
    pick: { element: id, position: 1, multiplier, is_captain: multiplier === 2, is_vice_captain: false },
    player: { id, web_name: name },
    team: { id: 1, short_name: "AAA" },
    position: "MID",
  }) as unknown as SquadSlot;

const squad = (): ManagerSquad =>
  ({
    entry: { id: 1, name: "Me", player_name: "Me", total: 100, rank: 5 },
    gw: 3,
    picks: [slot(10, "Cap", 2), slot(11, "Alt", 1)],
    starters: [slot(10, "Cap", 2), slot(11, "Alt", 1)],
    bench: [],
    captain: slot(10, "Cap", 2),
    viceCaptain: slot(11, "Alt", 1),
    activeChip: null,
  }) as unknown as ManagerSquad;

const projection = (points = 50): SquadProjection => ({
  entryId: 1,
  startingXIPoints: points,
  benchPoints: 4,
  totalExpected: points + 0.4,
  stdev: 12,
  perPlayer: [
    { playerId: 10, webName: "Cap", position: "MID", xPoints: 5, variance: 9, injuryRisk: 0, fixtureDifficulty: 3, notes: [] },
    { playerId: 11, webName: "Alt", position: "MID", xPoints: 9, variance: 9, injuryRisk: 0, fixtureDifficulty: 3, notes: [] },
  ],
});

const rival = (points = 50, behind = 0) => ({
  entryId: 2,
  name: "Rival",
  projection: { ...projection(points), entryId: 2 },
  pointsBehind: behind,
});

const bigOption = (): TransferOption =>
  ({
    id: "OPT-01", category: "best-xp",
    outPlayerId: 11, outWebName: "Alt", outTeamShort: "AAA", outCost: 50, outXp: 4, outPosition: "MID",
    inPlayerId: 20, inWebName: "Newman", inTeamShort: "BBB", inCost: 55, inXp: 30,
    netGainXi: 26, postBank: 5, overtakeImpact: [], overtakeSum: 0.4, notes: [],
  }) as TransferOption;

const base = {
  squad: squad(),
  userProjection: projection(),
  rivals: [rival()],
  transferOptions: [],
  freeTransfers: 1,
  deadline: { gw: 3, iso: "2026-09-04T17:30:00Z" },
  now: Date.parse("2026-09-01T00:00:00Z"),
  minHistoryMet: true,
};

describe("decide", () => {
  it("recommends a transfer with an overwhelming edge", () => {
    const d = decide({ ...base, transferOptions: [bigOption()] });
    expect(d.gateStatus).toBe("recommend");
    expect(d.verdict.kind).toBe("transfer");
    expect(d.verdict.headline).toContain("Newman");
  });

  it("rolls when the only option is marginal", () => {
    const tiny = { ...bigOption(), netGainXi: 0.05, inWebName: "Marginal" } as TransferOption;
    const d = decide({ ...base, transferOptions: [tiny] });
    expect(d.gateStatus).toBe("too-close");
    expect(d.verdict.kind).toBe("roll");
  });

  it("always offers roll as a candidate, even with no options at all", () => {
    const d = decide(base);
    expect(d.verdict.kind).toBe("roll");
    expect(d.gateStatus).toBe("too-close");
  });

  it("is deterministic across repeated calls", () => {
    const args = { ...base, transferOptions: [bigOption()] };
    expect(decide(args)).toEqual(decide(args));
  });

  it("reports locked once the deadline has passed", () => {
    const d = decide({ ...base, now: Date.parse("2026-09-05T00:00:00Z"), transferOptions: [bigOption()] });
    expect(d.gateStatus).toBe("locked");
    expect(d.note).toBeTruthy();
  });

  it("reports unavailable when the model lacks history", () => {
    const d = decide({ ...base, minHistoryMet: false, transferOptions: [bigOption()] });
    expect(d.gateStatus).toBe("unavailable");
    expect(d.note).toContain("history");
  });

  it("falls back to overall rank when there are no rivals", () => {
    const d = decide({ ...base, rivals: [], transferOptions: [bigOption()] });
    expect(d.gateStatus).not.toBe("unavailable");
    expect(d.verdict).toBeTruthy();
  });

  it("computes hours remaining to the deadline", () => {
    const d = decide(base);
    expect(d.deadline.hoursRemaining).toBeCloseTo(89.5, 0);
    expect(d.deadline.gw).toBe(3);
  });

  it("considers captain changes alongside transfers", () => {
    const d = decide({ ...base, transferOptions: [] });
    const headlines = [d.verdict, ...d.alternatives].map((a) => a.headline);
    expect(headlines.some((h) => h.includes("Captain Alt"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/decision/decide.test.ts`
Expected: FAIL — cannot resolve `@/lib/decision/decide`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/decision/decide.ts
// Composes candidate enumeration, the paired simulation and the rule into a
// single Decision. No AI call, no network — everything it needs is passed in,
// which is what makes it deterministic and cheap enough to run on every view.

import { captainCandidates, transferCandidates, type Candidate } from "@/lib/decision/candidates";
import { hashSeed } from "@/lib/decision/rng";
import { pickVerdict } from "@/lib/decision/rule";
import { type RivalTarget, simulateDelta } from "@/lib/decision/simulate";
import type { Action, Decision } from "@/lib/decision/types";
import type { TransferOption } from "@/lib/optimizer/transfer-options";
import type { ManagerSquad, SquadProjection } from "@/lib/types";

export interface DecideArgs {
  squad: ManagerSquad;
  userProjection: SquadProjection;
  rivals: Array<{ entryId: number; name: string; projection: SquadProjection; pointsBehind: number }>;
  transferOptions: TransferOption[];
  freeTransfers: number;
  deadline: { gw: number; iso: string };
  /** Injected so the verdict is a pure function of its inputs. */
  now: number;
  /** False when the model has too little history to project honestly. */
  minHistoryMet: boolean;
}

const MS_PER_HOUR = 3_600_000;

function rollAction(): Action {
  return {
    kind: "roll",
    headline: "Roll your transfer",
    detail: "Nothing available this week clears the noise in our own projections.",
    overtakeDelta: { mean: 0, lower80: 0, upper80: 0, perRival: [] },
    hitCost: 0,
    evidence: [{ label: "How your rivals are tracking", tab: "rival" }],
  };
}

export function decide(args: DecideArgs): Decision {
  const { squad, userProjection, rivals, transferOptions, freeTransfers, deadline, now, minHistoryMet } = args;

  const hoursRemaining = Number(((Date.parse(deadline.iso) - now) / MS_PER_HOUR).toFixed(1));
  const deadlineInfo = { gw: deadline.gw, iso: deadline.iso, hoursRemaining };
  const roll = rollAction();

  if (hoursRemaining <= 0) {
    return {
      verdict: roll,
      alternatives: [],
      deadline: deadlineInfo,
      gateStatus: "locked",
      note: `GW${deadline.gw} is locked in. Nothing left to decide until the next deadline.`,
    };
  }

  if (!minHistoryMet) {
    return {
      verdict: roll,
      alternatives: [],
      deadline: deadlineInfo,
      gateStatus: "unavailable",
      note: "Too little history this season for the model to project honestly yet.",
    };
  }

  // With no tracked rivals there is nobody to overtake, so fall back to a
  // single synthetic opponent at the user's own projected level: the delta
  // then measures whether an action raises the score at all.
  const targets: RivalTarget[] =
    rivals.length > 0
      ? rivals.map((r) => ({
          entryId: r.entryId,
          name: r.name,
          expected: r.projection.startingXIPoints,
          stdev: r.projection.stdev,
          pointsBehind: r.pointsBehind,
        }))
      : [
          {
            entryId: 0,
            name: "the field",
            expected: userProjection.startingXIPoints,
            stdev: userProjection.stdev,
            pointsBehind: 0,
          },
        ];

  const candidates: Candidate[] = [
    ...transferCandidates(transferOptions, userProjection, freeTransfers),
    ...captainCandidates(squad, userProjection),
  ];

  const seed = hashSeed("decision", deadline.gw, squad.entry.id);

  const actions: Action[] = candidates.map((c, i) => ({
    kind: c.kind,
    headline: c.headline,
    detail: c.detail,
    hitCost: c.hitCost,
    evidence: c.evidence,
    // Each candidate gets its own stream, but one derived from the shared run
    // seed, so the whole decision is reproducible.
    overtakeDelta: simulateDelta({
      baseline: userProjection,
      variant: c.variant,
      rivals: targets,
      seed: hashSeed(seed, i),
    }),
  }));

  const { verdict, alternatives, gateStatus } = pickVerdict(roll, actions);

  return {
    verdict,
    alternatives,
    deadline: deadlineInfo,
    gateStatus,
    note:
      gateStatus === "too-close"
        ? "No move this week beats doing nothing by more than our own margin of error."
        : undefined,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/decision/decide.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/decision/decide.ts src/lib/decision/decide.test.ts
git commit -m "feat(decision): orchestrate candidates, simulation and the rule"
```

---

### Task 7: The `/api/decision` route

**Files:**
- Create: `src/app/api/decision/route.ts`
- Test: `src/app/api/decision/route.test.ts`

**Interfaces:**
- Consumes: `decide` (Task 6); `buildRivalContext` from `@/lib/fpl/rivals`; `buildProjections` from `@/lib/projections`; `generateTransferOptions` from `@/lib/optimizer/transfer-options`; `getFixtures`, `targetEvent`, `getBootstrap` from `@/lib/fpl/client`.
- Produces: `GET /api/decision?teamId=&leagueId=&n=` returning `Decision` as JSON.

Mirror `src/app/api/projections/route.ts` exactly for query parsing, `runtime`, `dynamic` and error handling — including its `FplError` branch. Read that file before writing this one.

Two values come from code that already exists; do not invent second ways of computing them. `src/app/api/analysis/route.ts:102-103` derives both:

```ts
const bank = entry?.last_deadline_bank ?? 0;
const freeTransfers = entryHistory ? computeFreeTransfers(entryHistory).freeTransfers : 1;
```

`entry` and `entryHistory` come from `getEntry(teamId)` and `getEntryHistory(teamId)`, both already exported from `@/lib/fpl/client` and both called with `.catch(() => null)` so a failure degrades rather than throws. `computeFreeTransfers` is exported from `@/lib/fpl/free-transfers`.

`minHistoryMet` is `targetGw >= 4`, the live-path equivalent of the backtest's `MIN_HISTORY_ROUNDS` of 3 prior rounds.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/decision/route.test.ts
import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/decision/route";

function request(url: string): Request {
  return new Request(url);
}

describe("GET /api/decision", () => {
  it("rejects a missing teamId", async () => {
    const res = await GET(request("http://localhost/api/decision?leagueId=123") as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_query");
  });

  it("rejects a non-numeric teamId", async () => {
    const res = await GET(request("http://localhost/api/decision?teamId=abc&leagueId=123") as never);
    expect(res.status).toBe(400);
  });

  it("rejects a negative leagueId", async () => {
    const res = await GET(request("http://localhost/api/decision?teamId=1&leagueId=-5") as never);
    expect(res.status).toBe(400);
  });
});
```

These three cover the validation branch without touching the network. The happy path is exercised by the manual smoke test in Step 6.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/decision/route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/decision/route`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/api/decision/route.ts
// The decision spine's data source. Deterministic and AI-free: it composes the
// rival context, projections and transfer options the app already builds, then
// runs the paired simulation and the recommendation rule over them.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { decide } from "@/lib/decision/decide";
import { FplError, getEntry, getEntryHistory, getFixtures, targetEvent } from "@/lib/fpl/client";
import { computeFreeTransfers } from "@/lib/fpl/free-transfers";
import { buildRivalContext } from "@/lib/fpl/rivals";
import { generateTransferOptions } from "@/lib/optimizer/transfer-options";
import { buildProjections } from "@/lib/projections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Below this gameweek the rolling window has too little history to trust. */
const MIN_GW_FOR_HISTORY = 4;

const Query = z.object({
  teamId: z.coerce.number().int().positive(),
  leagueId: z.coerce.number().int().positive(),
  n: z.coerce.number().int().min(1).max(5).default(3),
});

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query", detail: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { context, bs, targetGw } = await buildRivalContext(
      parsed.data.leagueId,
      parsed.data.teamId,
      parsed.data.n,
    );
    const [projections, fixtures, entry, entryHistory] = await Promise.all([
      buildProjections(context, bs, targetGw),
      getFixtures(targetGw),
      getEntry(parsed.data.teamId).catch(() => null),
      getEntryHistory(parsed.data.teamId).catch(() => null),
    ]);

    const bank = entry?.last_deadline_bank ?? 0;
    const freeTransfers = entryHistory ? computeFreeTransfers(entryHistory).freeTransfers : 1;

    const transferOptions = generateTransferOptions({
      ctx: context,
      userProjection: projections.user,
      rivalProjections: projections.rivals,
      baselineOvertake: projections.overtake,
      bank,
      bs,
      fixtures,
      gw: targetGw,
    });

    const event = targetEvent(bs);
    const decision = decide({
      squad: context.user,
      userProjection: projections.user,
      rivals: context.rivals.map((r, i) => ({
        entryId: r.entry.id,
        name: r.entry.name,
        projection: projections.rivals[i],
        pointsBehind: Math.max(0, r.entry.total - context.user.entry.total),
      })),
      transferOptions,
      freeTransfers,
      deadline: { gw: targetGw, iso: event.deadline_time },
      now: Date.now(),
      minHistoryMet: targetGw >= MIN_GW_FOR_HISTORY,
    });

    return NextResponse.json(decision, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof FplError) {
      return NextResponse.json({ error: "fpl_error", message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "decision_failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/decision/route.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify against the live API**

```bash
npm run dev
curl -s "http://localhost:3000/api/decision?teamId=4778037&leagueId=218144" | head -c 800
```

Expected: JSON with `verdict`, `alternatives`, `deadline` and `gateStatus`. Record the actual `gateStatus` and verdict headline in your report. Any of `recommend`, `too-close` or `locked` is a correct outcome depending on the week — a 500 is not.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/decision src/app/api/decision/route.test.ts
git commit -m "feat(decision): serve the weekly verdict from /api/decision"
```

---

### Task 8: The DecisionSpine component

**Files:**
- Create: `src/components/DecisionSpine.tsx`
- Test: `src/components/DecisionSpine.test.ts`

**Interfaces:**
- Consumes: `Decision`, `Action` from `@/lib/decision/types`; `ModelTrustBadge` from `@/components/ModelTrustBadge`.
- Produces: `DecisionSpine({ teamId, leagueId, onNavigate }: { teamId: number; leagueId: number; onNavigate: (tab: string, params?: Record<string, string>) => void })`, plus the pure helpers `verdictTone(status: GateStatus): "amber" | "green" | "muted"` and `formatDelta(action: Action): string`.

The repo has no DOM testing library and adding one would breach the no-new-dependencies constraint, so the component's decision logic lives in exported pure helpers that the tests exercise directly — the same approach `ModelTrustBadge` already uses.

Use the existing `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` primitives; read `src/components/PlanPanel.tsx` first and match its visual language.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/DecisionSpine.test.ts
import { describe, expect, it } from "vitest";

import { formatDelta, verdictTone } from "@/components/DecisionSpine";
import type { Action } from "@/lib/decision/types";

const action = (mean: number, lower80: number, upper80: number, hitCost = 0): Action => ({
  kind: "transfer",
  headline: "Bring in Semenyo",
  detail: "",
  hitCost,
  evidence: [],
  overtakeDelta: { mean, lower80, upper80, perRival: [] },
});

describe("verdictTone", () => {
  it("is green when an action is recommended", () => {
    expect(verdictTone("recommend")).toBe("green");
  });

  it("is amber when nothing clears the bar", () => {
    expect(verdictTone("too-close")).toBe("amber");
  });

  it("is muted once locked", () => {
    expect(verdictTone("locked")).toBe("muted");
  });

  it("is muted when unavailable", () => {
    expect(verdictTone("unavailable")).toBe("muted");
  });
});

describe("formatDelta", () => {
  it("renders a positive delta as a signed percentage", () => {
    expect(formatDelta(action(0.042, 0.01, 0.07))).toContain("+4.2%");
  });

  it("renders a negative delta with a minus sign", () => {
    expect(formatDelta(action(-0.031, -0.06, -0.01))).toContain("-3.1%");
  });

  it("includes the 80% interval", () => {
    expect(formatDelta(action(0.042, 0.01, 0.07))).toContain("1.0%");
    expect(formatDelta(action(0.042, 0.01, 0.07))).toContain("7.0%");
  });

  it("names the hit when one applies", () => {
    expect(formatDelta(action(0.05, 0.02, 0.08, -4))).toContain("-4");
  });

  it("says nothing about a hit when there is none", () => {
    expect(formatDelta(action(0.05, 0.02, 0.08, 0))).not.toContain("-4");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/DecisionSpine.test.ts`
Expected: FAIL — cannot resolve `@/components/DecisionSpine`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/DecisionSpine.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ModelTrustBadge } from "@/components/ModelTrustBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Action, Decision, GateStatus } from "@/lib/decision/types";

export function verdictTone(status: GateStatus): "amber" | "green" | "muted" {
  if (status === "recommend") return "green";
  if (status === "too-close") return "amber";
  return "muted";
}

export function formatDelta(action: Action): string {
  const pct = (v: number) => `${v >= 0 ? "+" : "-"}${Math.abs(v * 100).toFixed(1)}%`;
  const band = `${Math.abs(action.overtakeDelta.lower80 * 100).toFixed(1)}% to ${Math.abs(
    action.overtakeDelta.upper80 * 100,
  ).toFixed(1)}%`;
  const hit = action.hitCost !== 0 ? ` after a ${action.hitCost} hit` : "";
  return `${pct(action.overtakeDelta.mean)} overtake odds (80% range ${band})${hit}`;
}

const TONE_CLASS: Record<ReturnType<typeof verdictTone>, string> = {
  green: "border-emerald-500/40 bg-emerald-500/5",
  amber: "border-amber-500/40 bg-amber-500/5",
  muted: "border-border bg-card/40",
};

async function fetchDecision(teamId: number, leagueId: number): Promise<Decision> {
  const res = await fetch(`/api/decision?teamId=${teamId}&leagueId=${leagueId}`);
  if (!res.ok) throw new Error(`decision ${res.status}`);
  return (await res.json()) as Decision;
}

export function DecisionSpine({
  teamId,
  leagueId,
  onNavigate,
}: {
  teamId: number;
  leagueId: number;
  onNavigate: (tab: string, params?: Record<string, string>) => void;
}) {
  const [showAlternatives, setShowAlternatives] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["decision", teamId, leagueId],
    queryFn: () => fetchDecision(teamId, leagueId),
  });

  if (isLoading) {
    return (
      <Card className="border-border bg-card/40">
        <CardContent className="py-4 text-sm text-muted-foreground">Working out your week…</CardContent>
      </Card>
    );
  }
  if (isError || !data) return null;

  const tone = verdictTone(data.gateStatus);

  return (
    <Card className={TONE_CLASS[tone]}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{data.verdict.headline}</CardTitle>
          <span className="text-xs text-muted-foreground">
            GW{data.deadline.gw} · {Math.max(0, Math.round(data.deadline.hoursRemaining))}h left
          </span>
        </div>
        <CardDescription>{data.note ?? data.verdict.detail}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {data.verdict.kind !== "roll" && (
          <p className="text-sm font-medium">{formatDelta(data.verdict)}</p>
        )}

        <ModelTrustBadge />

        {data.verdict.evidence.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {data.verdict.evidence.map((e) => (
              <button
                key={`${e.tab}:${e.label}`}
                type="button"
                onClick={() => onNavigate(e.tab, e.params)}
                className="rounded-full border px-3 py-1 text-xs hover:bg-accent"
              >
                {e.label} →
              </button>
            ))}
          </div>
        )}

        {data.alternatives.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowAlternatives((v) => !v)}
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              {showAlternatives ? "Hide" : "What else was considered"} ({data.alternatives.length})
            </button>
            {showAlternatives && (
              <ul className="mt-2 space-y-1">
                {data.alternatives.map((a) => (
                  <li key={a.headline} className="flex justify-between gap-3 text-xs">
                    <span>{a.headline}</span>
                    <span className="text-muted-foreground">{formatDelta(a)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/DecisionSpine.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/DecisionSpine.tsx src/components/DecisionSpine.test.ts
git commit -m "feat(decision): render the weekly verdict"
```

---

### Task 9: Mount the spine and wire evidence navigation

The spine renders above the tab bar and its evidence chips switch tabs.

**Files:**
- Modify: `src/components/Dashboard.tsx`
- Test: covered by Task 8's helpers plus the manual check below.

**Interfaces:**
- Consumes: `DecisionSpine` (Task 8).
- Produces: nothing new.

Read `src/components/Dashboard.tsx` first. It holds `const [activeTab, setActiveTab] = useState<TabId>("squad")` around line 209 and renders `<Tabs value={activeTab} …>` around line 319. `ModelTrustBadge` was added at line 333 in the previous sub-project; the spine goes **above** the `<Tabs>` element so it is visible on every tab, not only Squad.

- [ ] **Step 1: Insert the component**

Immediately before the `<Tabs value={activeTab} …>` element, add:

```tsx
<div className="mb-3">
  <DecisionSpine
    teamId={teamId}
    leagueId={leagueId}
    onNavigate={(tab) => setActiveTab(tab as TabId)}
  />
</div>
```

Add the import alongside the other component imports:

```tsx
import { DecisionSpine } from "@/components/DecisionSpine";
```

`teamId` and `leagueId` are already in scope in this component — confirm the exact prop or variable names before using them rather than assuming.

- [ ] **Step 2: Verify types and tests still pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0, all tests passing.

- [ ] **Step 3: Verify in the browser**

```bash
npm run dev
```

Open `http://localhost:3000/dashboard/4778037/218144`. Confirm:
- the spine renders above the tabs, without expanding anything
- its headline states either a recommendation or that you should roll
- clicking an evidence chip switches to the named tab
- the "what else was considered" list expands and collapses

Record what the verdict actually said in your report.

- [ ] **Step 4: Commit**

```bash
git add src/components/Dashboard.tsx
git commit -m "feat(decision): mount the spine above the tab bar

The tabs stop being peers and become evidence: every claim the spine makes
links to the panel that justifies it."
```

---

### Task 10: Coverage threshold and documentation

**Files:**
- Modify: `vitest.config.ts`
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Extend the coverage include list**

In `vitest.config.ts`, add `"src/lib/decision/**"` to the coverage `include` array alongside the existing `src/lib/backtest/**` and `src/lib/projections/**` entries. Leave the thresholds themselves unchanged.

- [ ] **Step 2: Run coverage and confirm the threshold holds**

Run: `npx vitest run --coverage`
Expected: exit 0. Report the actual line coverage for `src/lib/decision/**`. If it is below 80%, add tests for the uncovered lines the report names — do not lower the threshold.

- [ ] **Step 3: Document the spine in the README**

Add a section after "Troubleshooting network access":

```markdown
## The decision spine

The dashboard opens with one verdict: the single change most worth making this
week, or an explicit "roll it" when nothing is worth making.

Actions are compared on one scale — the change in probability of finishing
above each tracked rival — so a captain switch and a transfer can be ranked
against each other. The comparison uses paired Monte-Carlo draws: both
scenarios are evaluated against the same random numbers, so what survives the
subtraction is the effect of the change rather than sampling noise.

An action is recommended **only when its 80% credible interval excludes zero**.
Most weeks nothing clears that bar, and the app says so. That is deliberate:
the model behind these numbers does not yet beat FPL's own expected points
(see Limitations), so manufacturing a weekly pick would be dishonest.

`GET /api/decision?teamId=&leagueId=` returns the verdict. It is deterministic
— seeded on the gameweek and entry — so the same week gives the same answer on
refresh and on a second device. It makes no AI call.
```

- [ ] **Step 4: Verify the whole suite one last time**

Run: `npx tsc --noEmit && npx vitest run && npx vitest run --coverage`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts README.md
git commit -m "docs(decision): cover the decision spine and its threshold"
```

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task: determinism → Tasks 1–2; common random numbers → Task 3; the delta distribution → Task 3; the decision rule and the hit baseline → Tasks 4–5; the candidate set including the three captain alternatives → Task 5; data flow and the `Decision` shape → Tasks 4, 6, 7; the UI with verdict, why and considered → Task 8; placement above the tab bar with evidence links → Task 9; every failure-mode row → Task 6's tests; testing and the coverage threshold → Task 10.

**Deliberate deviations from the spec, both improvements found while planning:**
- The spec seeds the run on `(gameweek, userEntryId)`. Task 6 derives a per-candidate seed from that run seed so two candidates cannot share a draw sequence and appear correlated. The run remains reproducible.
- The spec does not say what happens with no tracked rivals. Task 6 substitutes a synthetic opponent at the user's own projected level, so the delta still measures whether an action raises the score. The spec's failure-mode table called for "overall-rank delta"; this is the same intent with a concrete mechanism.

**Two placeholders found and removed during self-review.** Task 7 originally
carried a stub `bank` and a hardcoded free-transfer count on the assumption that
FPL does not expose one. Both were wrong: `src/app/api/analysis/route.ts:102-103`
already derives `bank` from `entry.last_deadline_bank` and free transfers from
`computeFreeTransfers(entryHistory)` in `src/lib/fpl/free-transfers.ts`. The
real derivations are now inlined. This matters beyond tidiness — Task 5's hit
logic keys off the free-transfer count, so a hardcoded 1 would have charged a
-4 hit against managers who had two saved, and skipped it for managers who had
none.

**Verified against the real code while planning:** `Dashboard` is declared as
`Dashboard({ teamId, leagueId, aiEnabled })`, so Task 9's props are in scope.
`vitest.config.ts` has `include: ["src/**/*.test.ts"]` — `.ts` only, no `.tsx` —
which is why Task 8's component test is named `DecisionSpine.test.ts` and tests
exported helpers rather than JSX.

**Known limitation carried forward.** `formatDelta` and `verdictTone` are unit-tested but the JSX is not, because the repo has no DOM testing library and adding one would breach the no-new-dependencies constraint. Task 9's browser check covers the rendering.
