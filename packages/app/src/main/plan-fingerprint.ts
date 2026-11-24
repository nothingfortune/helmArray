// A plan, as a short stable text: the same plan gives the same text however its keys happen to be
// ordered, whether it was just resolved or read back from disk. Apply uses it to write exactly
// what was previewed. Pure.

import { createHash } from 'node:crypto';
import type { Plan } from '@helmarray/core';

/** Key order and missing-versus-undefined must not matter: a plan read back from disk is compared. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record: Record<string, unknown> = { ...value };
    // The default sort is by UTF-16 code unit, which is the order `<` gives strings; a key is
    // never compared with itself, so no comparator is needed.
    const entries = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A hash of everything the plan says: the units, the bindings, the checks. */
export function planFingerprint(plan: Plan): string {
  return createHash('sha256').update(canonical(plan)).digest('hex').slice(0, 32);
}
