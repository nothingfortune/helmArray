import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hand } from '@helmarray/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHOOSE_PROMPT,
  PRESS_PROMPT,
  handsFor,
  jsonFileStorage,
  openHandStore,
  settleHands,
  type HandsStorage,
} from './hands';

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'helmarray-hands-'));
  file = join(dir, 'hands.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const LEFT = 49229;
const RIGHT = 49230;
const SPARE = 51000;

/** A store holding what it is given, saved in memory. */
async function storeWith(pairs: Record<number, Hand>) {
  const saves: Record<string, Hand>[] = [];
  const storage: HandsStorage = {
    load: () => Promise.resolve(pairs),
    save: (value) => {
      saves.push(value);
      return Promise.resolve();
    },
  };
  return { store: await openHandStore(storage), saves };
}

describe('the hand store', () => {
  it('knows nothing at first, with no file', async () => {
    const store = await openHandStore(jsonFileStorage(file));
    expect(store.get(LEFT)).toBeUndefined();
  });

  it('remembers an assignment across a restart, in a file', async () => {
    const first = await openHandStore(jsonFileStorage(file));
    await first.assign(LEFT, 'left');
    await first.assign(RIGHT, 'right');
    const second = await openHandStore(jsonFileStorage(file));
    expect(second.get(LEFT)).toBe('left');
    expect(second.get(RIGHT)).toBe('right');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ [LEFT]: 'left', [RIGHT]: 'right' });
  });

  it('leaves no temporary file behind', async () => {
    const store = await openHandStore(jsonFileStorage(file));
    await store.assign(LEFT, 'left');
    expect(await readdir(dir)).toEqual(['hands.json']);
  });

  it('gives a unit a new hand when it is assigned again', async () => {
    const { store } = await storeWith({ [LEFT]: 'left' });
    await store.assign(LEFT, 'right');
    expect(store.get(LEFT)).toBe('right');
  });

  it('takes the hand from the unit that held it (a replaced unit)', async () => {
    const { store, saves } = await storeWith({ [LEFT]: 'left', [RIGHT]: 'right' });
    await store.assign(SPARE, 'left');
    expect(store.get(SPARE)).toBe('left');
    expect(store.get(LEFT)).toBeUndefined();
    expect(store.get(RIGHT)).toBe('right');
    expect(saves.at(-1)).toEqual({ [SPARE]: 'left', [RIGHT]: 'right' });
  });

  it('never holds two ids on one hand, however many are assigned', async () => {
    const { store } = await storeWith({});
    for (const id of [1, 2, 3, 4]) await store.assign(id, 'left');
    expect([1, 2, 3, 4].filter((id) => store.get(id) === 'left')).toEqual([4]);
  });

  it('refuses what is not a unit id or a hand', async () => {
    const { store } = await storeWith({});
    await expect(store.assign(1.5, 'left')).rejects.toThrow(RangeError);
    await expect(store.assign(1, 'middle' as Hand)).rejects.toThrow(RangeError);
  });

  it('changes nothing when saving fails', async () => {
    const storage: HandsStorage = {
      load: () => Promise.resolve({ [LEFT]: 'left' }),
      save: () => Promise.reject(new Error('read-only')),
    };
    const store = await openHandStore(storage);
    await expect(store.assign(RIGHT, 'right')).rejects.toThrow('read-only');
    expect(store.get(RIGHT)).toBeUndefined();
    await expect(store.assign(SPARE, 'left')).rejects.toThrow('read-only');
    expect(store.get(LEFT)).toBe('left');
  });

  it('saves two quick assignments in order, neither overwriting the other', async () => {
    const saves: Record<string, Hand>[] = [];
    const store = await openHandStore({
      load: () => Promise.resolve(undefined),
      save: async (value) => {
        await new Promise((resolve) => setTimeout(resolve, saves.length === 0 ? 20 : 0));
        saves.push(value);
      },
    });
    await Promise.all([store.assign(LEFT, 'left'), store.assign(RIGHT, 'right')]);
    expect(saves).toEqual([{ [LEFT]: 'left' }, { [LEFT]: 'left', [RIGHT]: 'right' }]);
    expect(store.get(LEFT)).toBe('left');
    expect(store.get(RIGHT)).toBe('right');
  });

  it('ignores a saved file that is not what it expects', async () => {
    for (const saved of [
      null,
      'left',
      [1, 2],
      42,
      { abc: 'left', '12': 'middle', '1.5': 'left' },
    ]) {
      const store = await openHandStore({
        load: () => Promise.resolve(saved),
        save: () => Promise.resolve(),
      });
      expect(store.get(12)).toBeUndefined();
      expect(store.get(1)).toBeUndefined();
    }
  });

  it('asks again about two units a file put on one hand', async () => {
    const { store } = await storeWith({ 1: 'left', 2: 'left', 3: 'right' });
    expect(store.get(1)).toBeUndefined();
    expect(store.get(2)).toBeUndefined();
    expect(store.get(3)).toBe('right');
  });

  it('asks again, rather than failing, when the file was cut short', async () => {
    await writeFile(file, '{"49229": "le', 'utf8');
    const store = await openHandStore(jsonFileStorage(file));
    expect(store.get(LEFT)).toBeUndefined();
    await store.assign(LEFT, 'left');
    expect((await openHandStore(jsonFileStorage(file))).get(LEFT)).toBe('left');
  });

  it('still fails for an error that is not a missing or broken file', async () => {
    // A folder where the file should be: reading it is an error that must not be hidden.
    await expect(openHandStore(jsonFileStorage(dir))).rejects.toThrow();
  });

  it('reads a file written by hand', async () => {
    await writeFile(file, JSON.stringify({ [LEFT]: 'left' }), 'utf8');
    expect((await openHandStore(jsonFileStorage(file))).get(LEFT)).toBe('left');
  });
});

describe('handsFor', () => {
  it('gives remembered units their hands without asking', async () => {
    const { store } = await storeWith({ [LEFT]: 'left', [RIGHT]: 'right' });
    expect(handsFor([RIGHT, LEFT], store)).toEqual({
      units: [
        { id: RIGHT, hand: 'right', how: 'remembered' },
        { id: LEFT, hand: 'left', how: 'remembered' },
      ],
      ask: null,
    });
  });

  it('works out the other unit from the one it knows, without asking', async () => {
    const { store } = await storeWith({ [LEFT]: 'left' });
    expect(handsFor([LEFT, RIGHT], store)).toEqual({
      units: [
        { id: LEFT, hand: 'left', how: 'remembered' },
        { id: RIGHT, hand: 'right', how: 'derived' },
      ],
      ask: null,
    });
    const { store: other } = await storeWith({ [RIGHT]: 'right' });
    expect(handsFor([LEFT, RIGHT], other)).toMatchObject({
      units: [
        { id: LEFT, hand: 'left', how: 'derived' },
        { id: RIGHT, hand: 'right', how: 'remembered' },
      ],
      ask: null,
    });
  });

  it('asks about exactly one of two unknown units: the left one', async () => {
    const { store } = await storeWith({});
    expect(handsFor([LEFT, RIGHT], store)).toEqual({
      units: [
        { id: LEFT, hand: 'unknown', how: 'unknown' },
        { id: RIGHT, hand: 'unknown', how: 'unknown' },
      ],
      ask: {
        kind: 'press',
        hand: 'left',
        ids: [LEFT, RIGHT],
        prompt: 'Press any key on your left Azeron.',
      },
    });
    expect(PRESS_PROMPT).toBe('Press any key on your left Azeron.');
  });

  it('settles both units from one answer', async () => {
    const { store } = await storeWith({});
    await store.assign(RIGHT, 'left'); // the press came from the unit with this id
    expect(handsFor([LEFT, RIGHT], store)).toMatchObject({
      units: [
        { id: LEFT, hand: 'right', how: 'derived' },
        { id: RIGHT, hand: 'left', how: 'remembered' },
      ],
      ask: null,
    });
  });

  it('asks outright about a unit that is alone and unknown', async () => {
    const { store } = await storeWith({});
    expect(handsFor([LEFT], store)).toEqual({
      units: [{ id: LEFT, hand: 'unknown', how: 'unknown' }],
      ask: { kind: 'choose', id: LEFT, prompt: CHOOSE_PROMPT },
    });
  });

  it('does not ask about a unit that is alone and known', async () => {
    const { store } = await storeWith({ [LEFT]: 'left' });
    expect(handsFor([LEFT], store)).toMatchObject({ units: [{ hand: 'left' }], ask: null });
  });

  it('has nothing to say with no units', async () => {
    const { store } = await storeWith({ [LEFT]: 'left' });
    expect(handsFor([], store)).toEqual({ units: [], ask: null });
  });

  it('counts a unit listed twice once', async () => {
    const { store } = await storeWith({});
    expect(handsFor([LEFT, LEFT], store).ask).toMatchObject({ kind: 'choose', id: LEFT });
  });

  it('treats a replaced unit as the old hand once it is assigned', async () => {
    const { store } = await storeWith({ [LEFT]: 'left', [RIGHT]: 'right' });
    // The right unit is replaced by a new one: the left one is known, so the new one is right.
    const result = handsFor([LEFT, SPARE], store);
    expect(result.units).toEqual([
      { id: LEFT, hand: 'left', how: 'remembered' },
      { id: SPARE, hand: 'right', how: 'derived' },
    ]);
    expect(result.ask).toBeNull();
  });

  it('never puts two connected units on one hand', async () => {
    const { store } = await storeWith({ [LEFT]: 'left' });
    for (const ids of [
      [LEFT, RIGHT],
      [RIGHT, LEFT],
      [LEFT, SPARE],
    ]) {
      const hands = handsFor(ids, store).units.map((unit) => unit.hand);
      expect(new Set(hands).size).toBe(hands.length);
    }
  });

  it('keeps known hands and asks outright about the first unknown among more than two', async () => {
    const { store } = await storeWith({ [LEFT]: 'left' });
    const result = handsFor([LEFT, RIGHT, SPARE], store);
    expect(result.units.map((unit) => unit.hand)).toEqual(['left', 'unknown', 'unknown']);
    expect(result.ask).toEqual({ kind: 'choose', id: RIGHT, prompt: CHOOSE_PROMPT });
  });
});

describe('settleHands', () => {
  it('remembers a hand worked out from the other unit, so the unit is known on its own later', async () => {
    const { store, saves } = await storeWith({ [LEFT]: 'left' });
    const result = await settleHands([LEFT, RIGHT], store);
    expect(result.units[1]).toMatchObject({ id: RIGHT, hand: 'right', how: 'derived' });
    expect(saves).toEqual([{ [LEFT]: 'left', [RIGHT]: 'right' }]);
    expect(handsFor([RIGHT], store)).toMatchObject({ units: [{ hand: 'right' }], ask: null });
  });

  it('forgets the unit that was replaced when it remembers its successor', async () => {
    const { store } = await storeWith({ [LEFT]: 'left', [RIGHT]: 'right' });
    await settleHands([LEFT, SPARE], store);
    expect(store.get(SPARE)).toBe('right');
    expect(store.get(RIGHT)).toBeUndefined();
  });

  it('saves nothing when there is nothing to remember, or only a question', async () => {
    const known = await storeWith({ [LEFT]: 'left', [RIGHT]: 'right' });
    await settleHands([LEFT, RIGHT], known.store);
    const unknown = await storeWith({});
    const result = await settleHands([LEFT, RIGHT], unknown.store);
    expect(result.ask).not.toBeNull();
    expect(known.saves).toEqual([]);
    expect(unknown.saves).toEqual([]);
  });
});
