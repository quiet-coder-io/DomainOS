// Duplicated intentionally — core and renderer have separate dependency boundaries.

/**
 * FNV-1a 32-bit hash → 8-char hex string.
 * Deterministic, dependency-free, non-cryptographic.
 */
export function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
