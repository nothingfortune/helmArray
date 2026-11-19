// Which unit is the left one. A unit's id (the number `identify` reports, e.g. 49229) is
// permanent, but nothing a unit reports says which hand it is. So the app remembers id -> hand,
// and asks only when it must. This is the state logic and the prompt text; what listens for the
// answer (a key press attributed to a device) waits on spike 1 and is not here.

import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import type { Hand } from '@helmarray/core';

const OTHER: Record<Hand, Hand> = { left: 'right', right: 'left' };
const isHand = (value: unknown): value is Hand => value === 'left' || value === 'right';

/** Where the id -> hand pairs live: a JSON value in settings or a file. */
export interface HandsStorage {
  /** The saved value, or undefined when nothing was saved yet. */
  load(): Promise<unknown>;
  save(value: Record<string, Hand>): Promise<void>;
}

/** A JSON file as storage. Written beside itself and renamed, so a crash can't leave half. */
export function jsonFileStorage(path: string): HandsStorage {
  return {
    load: async () => {
      try {
        return JSON.parse(await readFile(path, 'utf8')) as unknown;
      } catch (error) {
        // No file, or one cut short by a crash: either way nothing is remembered, so ask again.
        if ((error as { code?: string }).code === 'ENOENT' || error instanceof SyntaxError) {
          return undefined;
        }
        throw error;
      }
    },
    save: async (value) => {
      const temp = `${path}.${randomUUID()}.tmp`;
      await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await rename(temp, path);
    },
  };
}

export interface HandStore {
  get(id: number): Hand | undefined;
  /**
   * Remembers that this unit is that hand, and forgets any other unit that held it (a unit
   * that was replaced). Resolves once it is saved; if saving fails nothing changes.
   */
  assign(id: number, hand: Hand): Promise<void>;
}

/** Reads what was saved. Anything in it that isn't a whole id -> hand pair is ignored. */
export async function openHandStore(storage: HandsStorage): Promise<HandStore> {
  let pairs = new Map<number, Hand>();
  const saved = await storage.load();
  if (typeof saved === 'object' && saved !== null && !Array.isArray(saved)) {
    for (const [key, hand] of Object.entries(saved)) {
      const id = Number(key);
      if (Number.isInteger(id) && isHand(hand)) pairs.set(id, hand);
    }
    // A file that puts two units on one hand can't be trusted for either: ask again.
    for (const hand of ['left', 'right'] as const) {
      const holders = [...pairs].filter(([, held]) => held === hand);
      if (holders.length > 1) for (const [id] of holders) pairs.delete(id);
    }
  }

  // Assignments wait for the one before, so two quick ones can't save over each other.
  let queue: Promise<void> = Promise.resolve();
  return {
    get: (id) => pairs.get(id),
    assign: (id, hand) => {
      if (!Number.isInteger(id)) return Promise.reject(new RangeError(`not a unit id: ${id}`));
      if (!isHand(hand)) return Promise.reject(new RangeError(`not a hand: ${String(hand)}`));
      const run = async () => {
        const next = new Map([...pairs].filter(([other, held]) => held !== hand && other !== id));
        next.set(id, hand);
        await storage.save(Object.fromEntries(next));
        pairs = next;
      };
      const result = queue.then(run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}

export interface UnitHand {
  id: number;
  hand: Hand | 'unknown';
  /** Remembered from before, or worked out now as the opposite of the other unit. */
  how: 'remembered' | 'derived' | 'unknown';
}

/** What to ask the person, when the units alone can't settle it. */
export type HandQuestion =
  /**
   * Two units, neither known. The press says which of `ids` is `hand`; the other follows.
   * Answer with `assign(<the id the press came from>, hand)`.
   */
  | { kind: 'press'; hand: Hand; ids: [number, number]; prompt: string }
  /**
   * A press can't say which unit it came from when only one is there, so ask outright.
   * Answer with `assign(id, <the hand chosen>)`.
   */
  | { kind: 'choose'; id: number; prompt: string };

export interface HandsResult {
  /** One per connected unit, in the order given. */
  units: UnitHand[];
  /** At most one question. Nothing to ask means every unit has a hand. */
  ask: HandQuestion | null;
}

export const PRESS_PROMPT = 'Press any key on your left Azeron.';
export const CHOOSE_PROMPT = 'Is this your left or right Azeron?';

/**
 * Which hand each connected unit is, and what to ask if that isn't settled.
 *   - A remembered unit keeps its hand.
 *   - With two units and one known, the other is the opposite hand, without asking.
 *   - With two unknown, ask about exactly one ("left"); the other follows from the answer.
 *   - A single unknown unit is asked outright.
 * Never two units on one hand. More than two units isn't something an Azeron setup has: the
 * known ones keep their hands and the first unknown one is asked outright.
 */
export function handsFor(
  connectedIds: readonly number[],
  store: Pick<HandStore, 'get'>,
): HandsResult {
  const ids = [...new Set(connectedIds)];
  const units: UnitHand[] = ids.map((id) => {
    const hand = store.get(id);
    return hand ? { id, hand, how: 'remembered' } : { id, hand: 'unknown', how: 'unknown' };
  });

  const [first, second] = units;
  if (units.length === 2 && first && second) {
    if (first.hand !== 'unknown' && second.hand === 'unknown') {
      second.hand = OTHER[first.hand];
      second.how = 'derived';
    } else if (second.hand !== 'unknown' && first.hand === 'unknown') {
      first.hand = OTHER[second.hand];
      first.how = 'derived';
    } else if (first.hand === 'unknown' && second.hand === 'unknown') {
      const ask: HandQuestion = {
        kind: 'press',
        hand: 'left',
        ids: [first.id, second.id],
        prompt: PRESS_PROMPT,
      };
      return { units, ask };
    }
    return { units, ask: null };
  }

  const unknown = units.find((unit) => unit.hand === 'unknown');
  return {
    units,
    ask: unknown ? { kind: 'choose', id: unknown.id, prompt: CHOOSE_PROMPT } : null,
  };
}

/**
 * `handsFor`, and a hand worked out from the other unit is remembered too, so that unit is
 * never asked about on its own later.
 */
export async function settleHands(
  connectedIds: readonly number[],
  store: HandStore,
): Promise<HandsResult> {
  const result = handsFor(connectedIds, store);
  for (const unit of result.units) {
    if (unit.how === 'derived' && unit.hand !== 'unknown') await store.assign(unit.id, unit.hand);
  }
  return result;
}
