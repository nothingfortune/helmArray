// Tells the hands apart without listening to the keyboard and without sending a unit anything.
// With two new units the person is asked to unplug their left Azeron for a moment. The first of
// the two to disappear from the devices snapshot is the left one, and the other is the right
// one. When the unit is plugged back in it is identified afresh and its chip shows Left.
//
// Pure, and it has no way to reach a unit: it is told which ids are there and what is being
// asked, nothing else. Units vanishing because the Azeron app opened (the devices service lets
// every unit go) are not a press: that case arrives as `blocked`, and decides nothing.

import type { HandQuestion } from './hands';

export interface HandFinderDeps {
  /**
   * Remembers `leftId` as the left unit and `rightId` as the right one. Resolves when saved
   * (and the state recomputed); a rejection is traced and the person is asked again later.
   */
  decide(leftId: number, rightId: number): Promise<void>;
  /** What the finder did or couldn't do, for the log. */
  trace?(line: string): void;
}

export interface HandFinder {
  /**
   * Called on every change with the question now standing, whether the devices service is held
   * off (the Azeron app is open, or nothing is known yet), and the ids of the units in the
   * snapshot. Returns true when it just decided: the state is about to change, so the caller
   * should not announce the one it holds.
   */
  update(ask: HandQuestion | null, blocked: boolean, presentIds: readonly number[]): boolean;
  stop(): void;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createHandFinder(deps: HandFinderDeps): HandFinder {
  const trace = (line: string) => {
    try {
      deps.trace?.(line);
    } catch {
      // The log must never take the finder down.
    }
  };

  /** The two units a `press` question was last standing about, while nothing was blocked. */
  let watching: readonly [number, number] | null = null;

  return {
    update(ask, blocked, presentIds) {
      const before = watching;
      watching = null;
      if (blocked) return false;

      if (before) {
        const [first, second] = before;
        const firstGone = !presentIds.includes(first);
        const secondGone = !presentIds.includes(second);
        if (firstGone !== secondGone) {
          const [left, right] = firstGone ? [first, second] : [second, first];
          trace(`unit ${left} was unplugged: it is the left one, and unit ${right} the right`);
          void deps.decide(left, right).catch((error: unknown) => {
            trace(`remembering the hands failed: ${messageOf(error)}`);
          });
          return true;
        }
        if (firstGone && secondGone) trace('both units vanished at once: nothing decided');
      }

      if (ask?.kind === 'press') watching = ask.ids;
      return false;
    },
    stop() {
      watching = null;
    },
  };
}
