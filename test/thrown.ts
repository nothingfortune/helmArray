import { expect } from 'vitest';

/**
 * Runs `fn`, requires it to throw, and hands back the error to assert on.
 *
 * It replaces the try/catch blocks tests used to spell out. Those pass when nothing throws
 * unless someone remembers a guard line before the catch. Here there is no way out of the
 * function that does not involve a throw, and no `expect` is left inside a catch, which is
 * what lets `vitest/no-conditional-expect` be an error.
 */
// The type parameter is only in the return type on purpose: `thrown<StoreError>(...)` states the
// expected error once, where the test reads.
export function thrown<E = unknown>(fn: () => unknown): E {
  try {
    fn();
  } catch (error) {
    return error as E;
  }
  return expect.unreachable('expected the call to throw, and it returned normally');
}

/**
 * The awaited form: runs `fn`, requires the promise to reject, returns the reason. Prefer
 * `await expect(...).rejects.toThrow(<message>)` when the message alone is the assertion. This
 * is for when the error's shape (a `code`, its class) is what the test is about.
 */
export async function thrownAsync<E = unknown>(fn: () => Promise<unknown>): Promise<E> {
  try {
    await fn();
  } catch (error) {
    return error as E;
  }
  return expect.unreachable('expected the call to reject, and it resolved');
}
