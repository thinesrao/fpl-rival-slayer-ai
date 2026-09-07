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
