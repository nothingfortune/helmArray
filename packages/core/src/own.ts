/**
 * Lookups and writes on plain-object records keyed by data (mode ids, control ids, key codes,
 * file extensions). A key such as `constructor`, `toString` or `__proto__` must be an ordinary
 * key: never an inherited property to read back, and never the prototype to write onto.
 */

/** The value the record holds under `key` itself, or undefined: inherited properties don't count. */
export function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** A copy of the record with `key` set as an own property, `__proto__` included. */
export function withOwn<T>(
  record: Readonly<Record<string, T>>,
  key: string,
  value: T,
): Record<string, T> {
  return Object.fromEntries([...Object.entries(record).filter(([k]) => k !== key), [key, value]]);
}
