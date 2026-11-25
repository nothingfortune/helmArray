import type { Action, Game, HarvestChange } from '@helmarray/core';
import { mergeHarvest } from '@helmarray/core';
import { describe, expect, it } from 'vitest';
import { fileReadView, readLines } from './file-read';

const act = (over: Partial<Action> & Pick<Action, 'id'>): Action => ({
  name: over.id,
  mode: 'flight',
  role: 'movement',
  required: false,
  ...over,
});

const FILE: Game = {
  id: 'es2',
  name: 'Everspace 2',
  modes: [
    { id: 'flight', name: 'Flight' },
    { id: 'menu', name: 'Menus' },
  ],
  actions: [
    act({
      id: 'Boost',
      name: 'Boost',
      native: { key: { kind: 'key', code: 'LShift' }, pad: 'LB' },
    }),
    act({
      id: 'Map',
      name: 'Map',
      mode: 'menu',
      role: 'menu',
      native: { key: { kind: 'key', code: 'M' } },
    }),
  ],
  file: { format: 'unreal-ini' },
};
const FIRST = mergeHarvest(null, FILE).game;

const changed = (over: Partial<Extract<HarvestChange, { kind: 'changed' }>>): HarvestChange => ({
  kind: 'changed',
  action: 'Boost',
  name: 'Boost',
  field: 'key',
  from: undefined,
  to: undefined,
  ...over,
});

describe('the words for what a read of the file changes', () => {
  it.each<[string, HarvestChange, string]>([
    ['the format', { kind: 'format' }, "Apply can write the game's controls file from now on."],
    ['a new mode', { kind: 'mode-added', mode: 'menu', name: 'Menus' }, 'New mode: Menus.'],
    [
      'a mode renamed',
      { kind: 'mode-renamed', mode: 'menu', from: 'Menus', to: 'Menu' },
      'The mode Menus is now called Menu.',
    ],
    [
      'a default key',
      changed({ from: { kind: 'key', code: 'LShift' }, to: { kind: 'key', code: 'F13' } }),
      'Boost: default key Left Shift → F13.',
    ],
    [
      'a default key taken off',
      changed({ from: { kind: 'key', code: 'LShift' }, to: undefined }),
      'Boost: default key Left Shift → none.',
    ],
    [
      'a default controller button',
      changed({ field: 'pad', from: 'LB', to: 'RB' }),
      'Boost: default controller button Xbox LB → Xbox RB.',
    ],
    [
      'a role',
      changed({ field: 'role', from: 'movement', to: 'travel' }),
      'Boost: role Movement → Travel.',
    ],
    [
      'a name',
      changed({ field: 'name', from: 'Boost', to: 'Boost [HOLD]' }),
      'Boost is now called Boost [HOLD].',
    ],
    ['a mode', changed({ field: 'mode', from: 'flight', to: 'menu' }), 'Boost moves to Menus.'],
    ['required', changed({ field: 'required', from: false, to: true }), 'Boost is now required.'],
    [
      'not required',
      changed({ field: 'required', from: true, to: false }),
      'Boost is no longer required.',
    ],
  ])('says %s in one line', (_what, change, line) => {
    expect(readLines([change], FIRST)).toEqual([line]);
  });

  it('names the new actions by mode, and counts past five', () => {
    const added = (name: string, mode = 'flight'): HarvestChange => ({
      kind: 'added',
      action: name,
      name,
      mode,
    });
    expect(
      readLines(
        [
          ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => added(n)),
          added('Map', 'menu'),
          added('Log', 'menu'),
        ],
        FIRST,
      ),
    ).toEqual([
      '7 new actions in Flight: A, B, C, D, E and 2 more.',
      '2 new actions in Menus: Map and Log.',
    ]);
  });

  it('names five new actions with no count of more', () => {
    const five = ['A', 'B', 'C', 'D', 'E'].map((name): HarvestChange => ({
      kind: 'added',
      action: name,
      name,
      mode: 'flight',
    }));
    expect(readLines(five, FIRST)).toEqual(['5 new actions in Flight: A, B, C, D and E.']);
  });

  it('names three gone, the last with and', () => {
    const gone = ['A', 'B', 'C'].map((name): HarvestChange => ({
      kind: 'gone',
      action: name,
      name,
    }));
    expect(readLines(gone, FIRST)).toEqual(["A, B and C aren't in the file any more, and stay."]);
  });

  it.each<[string, HarvestChange, string]>([
    [
      'a name',
      {
        kind: 'kept',
        action: 'Boost',
        name: 'Afterburner',
        field: 'name',
        yours: 'Afterburner',
        file: 'Boost',
      },
      'Afterburner keeps the name you gave it (the file calls it Boost).',
    ],
    [
      'a mode',
      {
        kind: 'kept',
        action: 'Boost',
        name: 'Boost',
        field: 'mode',
        yours: 'flight',
        file: 'menu',
      },
      'Boost keeps your mode, Flight (the file has Menus).',
    ],
    [
      'required',
      { kind: 'kept', action: 'Boost', name: 'Boost', field: 'required', yours: true, file: false },
      'Boost stays required, as you set it (the file says not required).',
    ],
    [
      'a role',
      {
        kind: 'kept',
        action: 'Boost',
        name: 'Boost',
        field: 'role',
        yours: 'travel',
        file: 'movement',
      },
      'Boost keeps your role, Travel (the file has Movement).',
    ],
    [
      'a controller button taken off',
      { kind: 'kept', action: 'Boost', name: 'Boost', field: 'pad', yours: undefined, file: 'LB' },
      'Boost keeps your default controller button, none (the file has Xbox LB).',
    ],
  ])('says what of yours stays: %s', (_what, change, line) => {
    expect(readLines([change], FIRST)).toEqual([line]);
  });

  it('says one new action as one', () => {
    expect(
      readLines([{ kind: 'added', action: 'Scan', name: 'Scan', mode: 'flight' }], FIRST),
    ).toEqual(['1 new action in Flight: Scan.']);
  });

  it('says what the file no longer has stays, after the changes, and what of yours stays last', () => {
    expect(
      readLines(
        [
          {
            kind: 'kept',
            action: 'Boost',
            name: 'Boost',
            field: 'key',
            yours: { kind: 'key', code: 'G' },
            file: { kind: 'key', code: 'LShift' },
          },
          { kind: 'gone', action: 'Map', name: 'Map' },
          { kind: 'gone', action: 'Log', name: 'Log' },
          { kind: 'format' },
        ],
        FIRST,
      ),
    ).toEqual([
      "Apply can write the game's controls file from now on.",
      "Map and Log aren't in the file any more, and stay.",
      'Boost keeps your default key, G (the file has Left Shift).',
    ]);
  });

  it('says one gone action as one', () => {
    expect(readLines([{ kind: 'gone', action: 'Map', name: 'Map' }], FIRST)).toEqual([
      "Map isn't in the file any more, and stays.",
    ]);
  });
});

describe('what the Game screen shows of a read', () => {
  it("says why, when the file couldn't be read", () => {
    expect(fileReadView(FIRST, { ok: false, message: "helmArray can't find it." })).toEqual({
      kind: 'failed',
      message: "helmArray can't find it.",
    });
  });

  it.each([
    ['nothing in it', { ...FILE, modes: [], actions: [] }],
    ['actions in no mode it has', { ...FILE, modes: [] }],
  ])('says the file had nothing helmArray could read, for a read with %s', (_what, file) => {
    expect(fileReadView(FIRST, { ok: true, file, held: null })).toEqual({
      kind: 'failed',
      message: "Everspace 2's controls file has nothing helmArray can read.",
    });
  });

  it('has nothing to save when the file has nothing new', () => {
    expect(fileReadView(FIRST, { ok: true, file: FILE, held: null })).toEqual({
      kind: 'same',
      message: "Nothing to change from Everspace 2's file.",
      lines: [],
    });
  });

  it('has nothing to save, but says what of yours stays, when only you changed something', () => {
    const mine: Game = {
      ...FIRST,
      actions: FIRST.actions.map((a) =>
        a.id === 'Boost' ? { ...a, native: { key: { kind: 'key', code: 'G' }, pad: 'LB' } } : a,
      ),
    };
    expect(fileReadView(mine, { ok: true, file: FILE, held: null })).toEqual({
      kind: 'same',
      message: "Nothing to change from Everspace 2's file.",
      lines: ['Boost keeps your default key, G (the file has Left Shift).'],
    });
  });

  it('lists the changes, with the game as saving them leaves it', () => {
    const later: Game = {
      ...FILE,
      actions: FILE.actions.map((a) =>
        a.id === 'Map' ? { ...a, native: { key: { kind: 'key', code: 'N' } } } : a,
      ),
    };
    const view = fileReadView(FIRST, { ok: true, file: later, held: null });
    expect(view).toEqual({
      kind: 'changes',
      game: mergeHarvest(FIRST, later).game,
      lines: ['Map: default key M → N.'],
    });
  });

  it('says nothing you see changes when only what the file had moves', () => {
    const mine: Game = {
      ...FIRST,
      actions: FIRST.actions.filter((a) => a.id !== 'Map'),
      retired: { modes: [], actions: ['Map'] },
    };
    const later: Game = {
      ...FILE,
      actions: FILE.actions.map((a) =>
        a.id === 'Map' ? { ...a, native: { key: { kind: 'key', code: 'N' } } } : a,
      ),
    };
    expect(fileReadView(mine, { ok: true, file: later, held: null })).toMatchObject({
      kind: 'changes',
      lines: ['Nothing you see changes: helmArray notes what the file has now.'],
    });
  });

  it('counts the same data in another key order as nothing to save', () => {
    const reordered: Game = JSON.parse(
      JSON.stringify(FIRST, (_k, v: unknown) =>
        typeof v === 'object' && v !== null && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).reverse())
          : v,
      ),
    ) as Game;
    expect(fileReadView(reordered, { ok: true, file: FILE, held: null }).kind).toBe('same');
  });
});
