/**
 * Stable checksum for an expectation payload.
 *
 * Used by the manifest -> expectations sync to detect whether a derived
 * expectation actually changed, so an unchanged row is not rewritten on every
 * run (idempotent sync).
 *
 * Canonicalization rules (checksum input only -- the stored payload is never
 * reordered):
 *   - Object keys are sorted, so key order never affects the hash.
 *   - Arrays are sorted by the canonical JSON of their elements, so incidental
 *     reordering of order-insensitive lists (e.g. cta.mustNotContain) does not
 *     produce a false "changed" result.
 */

import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(canonicalize);
    items.sort((a, b) => {
      const sa = JSON.stringify(a);
      const sb = JSON.stringify(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    return items;
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = canonicalize(source[key]);
    }
    return out;
  }
  return value;
}

/** Deterministic JSON string for a value (sorted keys + sorted arrays). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Short, stable hex checksum of a value's canonical form. */
export function checksumOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16);
}