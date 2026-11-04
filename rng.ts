/**
 * Seeded pseudorandom numbers.
 *
 * - `hashString` (cyrb128) turns any text seed into 128 bits.
 * - `sfc32` is a small, well-tested generator with a long period that passes
 *   PractRand/BigCrush-style statistical tests; it is not cryptographic, which
 *   is fine because the numbers only drive a simulated display.
 *
 * The same seed text always produces the same sequence, on any machine.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Float in [min, max] (inclusive at both ends after rounding by callers). */
  float(min: number, max: number): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** Picks one element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

export function hashString(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function createRng(seed: string): Rng {
  const [a, b, c, d] = hashString(seed);
  const raw = sfc32(a, b, c, d);
  // Warm up so similar seeds diverge quickly.
  for (let i = 0; i < 15; i++) raw();
  const rng: Rng = {
    next: raw,
    float(min, max) {
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
        throw new Error(`Invalid range [${min}, ${max}]`);
      }
      if (min === max) return min;
      return min + raw() * (max - min);
    },
    int(min, max) {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
        throw new Error(`Invalid integer range [${min}, ${max}]`);
      }
      return lo + Math.floor(raw() * (hi - lo + 1));
    },
    pick(items) {
      if (items.length === 0) throw new Error('Cannot pick from an empty list');
      return items[Math.floor(raw() * items.length)]!;
    },
  };
  return rng;
}

/**
 * Independent named streams from one base seed, e.g. "selection", "metrics",
 * "graph". Changing how many numbers one stream draws never shifts another.
 */
export function streamRng(baseSeed: string, stream: string): Rng {
  return createRng(`${baseSeed}::${stream}`);
}
