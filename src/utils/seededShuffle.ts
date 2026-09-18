/**
 * Deterministic seeded shuffle utility using Mulberry32 PRNG and FNV-1a string hashing.
 *
 * Requirements:
 * - Deterministic: same array + same seed string => exact same permutation.
 * - Pure: does not mutate the source array (returns a new array).
 * - Safe: handles empty, single-element, or undefined inputs gracefully.
 *
 * Mirrors MockTestApp/src/utils/seededShuffle.ts for identical cross-platform permutations.
 *
 * @module utils/seededShuffle
 */

/**
 * 32-bit FNV-1a hash function to convert any string seed into an integer seed.
 */
function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Mulberry32 32-bit PRNG generator.
 */
function createMulberry32(seed: number): () => number {
  let a = seed;
  return function nextRandom(): number {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns a new array with elements deterministically shuffled using Fisher-Yates
 * algorithm seeded by the provided string.
 *
 * @param array - The source array to shuffle.
 * @param seed - Seed string (e.g. attemptId or attemptId:options:questionId).
 * @returns A new shuffled array.
 */
export function seededShuffle<T>(array: readonly T[] | null | undefined, seed: string): T[] {
  if (!array || array.length <= 1) {
    return array ? [...array] : [];
  }

  const result = [...array];
  const rng = createMulberry32(hashString(seed || 'default-seed'));

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }

  return result;
}
