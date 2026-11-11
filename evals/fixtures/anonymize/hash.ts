/**
 * Deterministic, seedable hashing for the anonymizer. No randomness and no clock: the same
 * parts always give the same number, so `anonymize(label, seed)` is reproducible byte for byte.
 */

/** 32-bit FNV-1a over the parts (with a separator between them), then a murmur-style finalizer. */
export function hash32(...parts: readonly string[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h ^= part.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A deterministic sequence of 32-bit numbers keyed by the parts. */
export function hashStream(...parts: readonly string[]): () => number {
  let i = 0;
  return () => hash32(...parts, String(i++));
}
