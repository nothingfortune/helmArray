// A unit session that cannot talk to a unit while the Azeron app runs. Every operation the app
// does to a unit (identify, read the slots, ask the running slot, write, switch, delete) goes
// through this, and each one asks, afresh and right before it starts, whether the Azeron app is
// running. Anything but a plain "no" (it is running, or the look failed) and the operation is
// refused with one sentence before a single report is sent, and the unit's cached slots are
// marked stale. So no step of a longer flow can be forgotten: the check is not at the call
// sites, it is in the only object a call site is given.
//
// Operations on one gated session run one at a time, each look and its operation together, so
// the look is never older than the queue ahead of its own operation.
//
// Pure: the session and the look are handed in.

import type { UnitSession } from '@helmarray/azeron';
import { UnitError } from '@helmarray/azeron';

/** What the app does to a unit. A `UnitSession` is one; so is its gated form. */
export type UnitOps = Pick<
  UnitSession,
  'identify' | 'readSlots' | 'runningSlot' | 'write' | 'switchTo' | 'deleteSlot'
>;

export const AZERON_OPEN_SENTENCE = 'Close the Azeron app first: it talks to the units too.';

export interface Gate {
  /** A fresh look, every call: whether the Azeron app is running. A look that fails throws. */
  look(): Promise<boolean>;
  /** Called when an operation was refused: what is cached of the unit is no longer to be trusted. */
  stale?(): void;
  trace?(line: string): void;
}

/** Whether an error is the gate's refusal (and not the unit's). */
export function isGateRefusal(error: unknown): boolean {
  return (
    error instanceof UnitError && error.kind === 'refused' && error.message === AZERON_OPEN_SENTENCE
  );
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function gatedSession(session: UnitOps, gate: Gate): UnitOps {
  let tail: Promise<unknown> = Promise.resolve();

  const gated = <A extends unknown[], R>(
    name: string,
    operation: (...args: A) => Promise<R>,
  ): ((...args: A) => Promise<R>) => {
    return (...args) => {
      const run = tail.then(async () => {
        let open: boolean;
        try {
          open = await gate.look();
        } catch (error) {
          gate.trace?.(
            `${name} refused: couldn't tell whether the Azeron app is open (${messageOf(error)})`,
          );
          open = true;
        }
        if (open) {
          gate.trace?.(`${name} refused: the Azeron app is open`);
          try {
            gate.stale?.();
          } catch {
            // Marking a unit stale must not hide the refusal.
          }
          throw new UnitError('refused', AZERON_OPEN_SENTENCE);
        }
        return operation(...args);
      });
      tail = run.catch(() => undefined);
      return run;
    };
  };

  return {
    identify: gated('identify', () => session.identify()),
    readSlots: gated('readSlots', () => session.readSlots()),
    runningSlot: gated('runningSlot', () => session.runningSlot()),
    write: gated('write', (...args: Parameters<UnitSession['write']>) => session.write(...args)),
    switchTo: gated('switchTo', (slot: number) => session.switchTo(slot)),
    deleteSlot: gated('deleteSlot', (slot: number) => session.deleteSlot(slot)),
  };
}
