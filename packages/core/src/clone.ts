/** A deep copy of plain JSON data (schemes, ledgers). Core has no structuredClone. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
