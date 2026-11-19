// Tells the hands apart without listening to the keyboard. While two new units are waiting to be
// told apart, the person is asked to press the profile button on the left Azeron. That button
// moves the unit's running slot, and a unit's running slot can be asked about (the Azeron app
// asks it too), so the unit whose slot moves is the left one. It is then put back on the slot it
// was running, so the person's layout is as they left it.
//
// Pure: the units, the clock and the hand store are handed in. Only `runningSlot()` and
// `switchTo()` of a unit's session are used: nothing is sent that the session doesn't already.
// It never asks a unit anything while the Azeron app runs.

import type { HandQuestion } from './hands';

/** What the finder needs of a unit's session. */
export interface FindableUnit {
  runningSlot(): Promise<number>;
  switchTo(slot: number): Promise<void>;
}

export interface HandFinderDeps {
  /** The session of a ready unit by its id; undefined when it isn't plugged in or ready. */
  session(unitId: number): FindableUnit | undefined;
  /** Remembers a unit as a hand. The other unit follows by `settleHands`. */
  assign(unitId: number, hand: 'left'): Promise<void>;
  /** What the finder did or couldn't do, for the log. */
  trace?(line: string): void;
  /** Runs `fn` once after `ms` and returns a way to cancel it. Defaults to `setTimeout`. */
  schedule?(fn: () => void, ms: number): () => void;
  /** Time between the end of one look and the start of the next. Defaults to `POLL_MS`. */
  pollMs?: number;
}

export const FINDER_POLL_MS = 300;

export interface HandFinder {
  /**
   * Says what is being asked and whether the Azeron app is open. Polls only while a `press`
   * question stands and nothing is blocked; anything else stops it. Call it on every change:
   * the same question again changes nothing.
   */
  update(ask: HandQuestion | null, blocked: boolean): void;
  stop(): void;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export function createHandFinder(deps: HandFinderDeps): HandFinder {
  const schedule = deps.schedule ?? defaultSchedule;
  const pollMs = deps.pollMs ?? FINDER_POLL_MS;
  const trace = (line: string) => {
    try {
      deps.trace?.(line);
    } catch {
      // The log must never take the finder down.
    }
  };

  /** Bumped whenever polling starts or stops, so a look in flight across one is ignored. */
  let generation = 0;
  let cancelNext: (() => void) | null = null;
  let activeKey: string | null = null;
  let blockedNow = true;

  const halt = () => {
    generation++;
    cancelNext?.();
    cancelNext = null;
    activeKey = null;
  };

  const run = (ids: readonly [number, number], mine: number) => {
    /** The slot each unit ran when its first look succeeded. */
    const baseline = new Map<number, number>();

    const look = async (id: number): Promise<{ id: number; slot: number } | undefined> => {
      const unit = deps.session(id);
      if (!unit) {
        // Gone, or not ready: what it ran before says nothing about it when it is back.
        baseline.delete(id);
        return undefined;
      }
      try {
        return { id, slot: await unit.runningSlot() };
      } catch (error) {
        trace(`asking unit ${id} which slot it runs failed: ${messageOf(error)}`);
        return undefined;
      }
    };

    const restore = async (id: number, slot: number) => {
      // The Azeron app may have opened while the answer was being saved: then it is left be.
      if (blockedNow) return;
      try {
        await deps.session(id)?.switchTo(slot);
        trace(`put unit ${id} back on slot ${slot}`);
      } catch (error) {
        trace(`putting unit ${id} back on slot ${slot} failed: ${messageOf(error)}`);
      }
    };

    const tick = async () => {
      const looks = await Promise.all(ids.map(look));
      if (mine !== generation) return;
      const moved: { id: number; from: number }[] = [];
      for (const seen of looks) {
        if (!seen) continue;
        const from = baseline.get(seen.id);
        if (from === undefined) baseline.set(seen.id, seen.slot);
        else if (from !== seen.slot) moved.push({ id: seen.id, from });
      }
      const [only] = moved;
      if (moved.length > 1) {
        // Both moved at once: which was pressed first can't be told. Put both back and look on.
        trace('both units changed slot at once; putting them back and looking again');
        for (const unit of moved) await restore(unit.id, unit.from);
      } else if (only) {
        trace(`unit ${only.id} changed slot: it is the left one`);
        try {
          await deps.assign(only.id, 'left');
        } catch (error) {
          trace(`remembering unit ${only.id} as left failed: ${messageOf(error)}`);
        }
        await restore(only.id, only.from);
      }
      if (mine !== generation) return;
      cancelNext = schedule(() => {
        cancelNext = null;
        void tick().catch((error: unknown) => trace(`looking failed: ${messageOf(error)}`));
      }, pollMs);
    };

    void tick().catch((error: unknown) => trace(`looking failed: ${messageOf(error)}`));
  };

  return {
    update(ask, blocked) {
      blockedNow = blocked;
      if (blocked || ask?.kind !== 'press') return halt();
      const key = ask.ids.join(',');
      if (key === activeKey) return;
      halt();
      activeKey = key;
      run(ask.ids, generation);
    },
    stop: halt,
  };
}
