import { describe, expect, it } from 'vitest';
import { gameProblem } from './game-data';
import { mergeHarvest } from './harvest';
import type { KeyCode } from './keys';
import type { Action, Game, Signal } from './model';
import type { GameBinding } from './plan';

const key = (code: KeyCode, mods?: ('ctrl' | 'shift' | 'alt')[]): Signal =>
  mods === undefined ? { kind: 'key', code } : { kind: 'key', code, mods };

const act = (over: Partial<Action> & Pick<Action, 'id'>): Action => ({
  name: over.id,
  mode: 'flight',
  role: 'combat',
  required: false,
  ...over,
});

/** What the adapter harvests: the file's modes and actions, and its format. */
const fileGame = (actions: Action[], modes = [{ id: 'flight', name: 'Flight' }]): Game => ({
  id: 'es2',
  name: 'Everspace 2',
  modes,
  actions,
  file: { format: 'unreal-ini' },
});

const BOOST = act({ id: 'Boost', name: 'Boost', native: { key: key('LShift'), pad: 'LB' } });
const FIRE = act({ id: 'Fire', name: 'Fire primary', native: { pad: 'RT' } });
const FILE = fileGame([BOOST, FIRE]);

/** The data as a first read leaves it. */
const first = mergeHarvest(null, FILE).game;

/** The data after the person changed one action. */
const edited = (id: string, change: (a: Action) => Action): Game => ({
  ...first,
  actions: first.actions.map((a) => (a.id === id ? change(a) : a)),
});

const boostOf = (game: Game) => game.actions.find((a) => a.id === 'Boost');

describe('mergeHarvest: the first read', () => {
  it("takes the file's game whole, and keeps what the file had as the base", () => {
    expect(first).toEqual({ ...FILE, fromFile: { modes: FILE.modes, actions: FILE.actions } });
  });

  it('lists the format, each mode and each action as new', () => {
    expect(mergeHarvest(null, FILE).changes).toEqual([
      { kind: 'format' },
      { kind: 'mode-added', mode: 'flight', name: 'Flight' },
      { kind: 'added', action: 'Boost', name: 'Boost', mode: 'flight' },
      { kind: 'added', action: 'Fire', name: 'Fire primary', mode: 'flight' },
    ]);
  });

  it('is a game that can be saved', () => {
    expect(gameProblem(first)).toBeNull();
  });

  it('lists no format for a file that has none', () => {
    const noFormat = { ...FILE };
    delete noFormat.file;
    expect(mergeHarvest(null, noFormat).changes.map((c) => c.kind)).not.toContain('format');
  });
});

describe('mergeHarvest: a re-read', () => {
  it('changes nothing when neither the file nor the data changed', () => {
    expect(mergeHarvest(first, FILE)).toEqual({ game: first, changes: [] });
  });

  it("takes a default the file changed, where the data still has the file's old one", () => {
    const now = fileGame([{ ...BOOST, native: { key: key('F13'), pad: 'LB' } }, FIRE]);
    const merged = mergeHarvest(first, now);
    expect([boostOf(merged.game)?.native, merged.changes]).toEqual([
      { key: key('F13'), pad: 'LB' },
      [
        {
          kind: 'changed',
          action: 'Boost',
          name: 'Boost',
          field: 'key',
          from: key('LShift'),
          to: key('F13'),
        },
      ],
    ]);
  });

  it('keeps a default you changed, and says the file has another', () => {
    const mine = edited('Boost', (a) => ({ ...a, native: { key: key('G'), pad: 'LB' } }));
    const merged = mergeHarvest(mine, FILE);
    expect([boostOf(merged.game)?.native?.key, merged.changes]).toEqual([
      key('G'),
      [
        {
          kind: 'kept',
          action: 'Boost',
          name: 'Boost',
          field: 'key',
          yours: key('G'),
          file: key('LShift'),
        },
      ],
    ]);
  });

  it('keeps a default you changed when the file changed it too', () => {
    const mine = edited('Boost', (a) => ({ ...a, native: { key: key('G'), pad: 'LB' } }));
    const now = fileGame([{ ...BOOST, native: { key: key('F13'), pad: 'LB' } }, FIRE]);
    expect(boostOf(mergeHarvest(mine, now).game)?.native?.key).toEqual(key('G'));
  });

  it('keeps a default you cleared', () => {
    const mine = edited('Boost', (a) => ({ ...a, native: { pad: 'LB' } }));
    expect(boostOf(mergeHarvest(mine, FILE).game)?.native).toEqual({ pad: 'LB' });
  });

  it('keeps a name, a role and required you changed, and takes the ones you left', () => {
    const mine = edited('Boost', (a) => ({ ...a, name: 'Afterburner', role: 'travel' }));
    const now = fileGame([
      { ...BOOST, name: 'Boost [HOLD]', role: 'movement', required: true },
      FIRE,
    ]);
    expect(boostOf(mergeHarvest(mine, now).game)).toEqual({
      ...BOOST,
      name: 'Afterburner',
      role: 'travel',
      required: true,
    });
  });

  it('keeps a role you took off', () => {
    const mine = edited('Boost', (a) => {
      const rest = { ...a };
      delete rest.role;
      return rest;
    });
    expect(boostOf(mergeHarvest(mine, FILE).game)?.role).toBeUndefined();
  });

  it('counts a key with its modifiers in another order as the same key', () => {
    const file = fileGame([{ ...BOOST, native: { key: key('K', ['ctrl', 'shift']) } }]);
    const mine = mergeHarvest(null, file).game;
    const again = fileGame([
      { ...BOOST, native: { key: { mods: ['shift', 'ctrl'], code: 'K', kind: 'key' } } },
    ]);
    expect(mergeHarvest(mine, again).changes).toEqual([]);
  });

  it('counts a key with other modifiers as another key', () => {
    const file = fileGame([{ ...BOOST, native: { key: key('K', ['ctrl']) } }]);
    const mine = mergeHarvest(null, file).game;
    const again = fileGame([{ ...BOOST, native: { key: key('K', ['shift']) } }]);
    expect(mergeHarvest(mine, again).changes.map((c) => c.kind)).toEqual(['changed']);
  });

  it('puts an action new in the file after the last of its own mode, not at the very end', () => {
    const modes = [
      { id: 'flight', name: 'Flight' },
      { id: 'menu', name: 'Menus' },
    ];
    const mine = mergeHarvest(
      null,
      fileGame([BOOST, act({ id: 'Open', mode: 'menu' })], modes),
    ).game;
    const later = fileGame([BOOST, act({ id: 'Open', mode: 'menu' }), act({ id: 'Scan' })], modes);
    expect(mergeHarvest(mine, later).game.actions.map((a) => a.id)).toEqual([
      'Boost',
      'Scan',
      'Open',
    ]);
  });

  it('adds an action new in the file at the end of its mode', () => {
    const modes = [
      { id: 'flight', name: 'Flight' },
      { id: 'menu', name: 'Menus' },
    ];
    const open = act({ id: 'Open', mode: 'menu' });
    const mine = mergeHarvest(null, fileGame([BOOST, open, FIRE], modes)).game;
    const scan = act({ id: 'Scan' });
    const merged = mergeHarvest(mine, fileGame([BOOST, open, FIRE, scan], modes));
    expect([merged.game.actions.map((a) => a.id), merged.changes]).toEqual([
      ['Boost', 'Open', 'Fire', 'Scan'],
      [{ kind: 'added', action: 'Scan', name: 'Scan', mode: 'flight' }],
    ]);
  });

  it('keeps an action you added by hand, and says nothing of it', () => {
    const mine = { ...first, actions: [...first.actions, act({ id: 'wave', name: 'Wave' })] };
    const merged = mergeHarvest(mine, FILE);
    expect([merged.game.actions.map((a) => a.id), merged.changes]).toEqual([
      ['Boost', 'Fire', 'wave'],
      [],
    ]);
  });

  it('keeps an action the file no longer has, and says it is gone from the file', () => {
    const merged = mergeHarvest(first, fileGame([BOOST]));
    expect([merged.game.actions.map((a) => a.id), merged.changes]).toEqual([
      ['Boost', 'Fire'],
      [{ kind: 'gone', action: 'Fire', name: 'Fire primary' }],
    ]);
  });

  it('never brings back an action you deleted: its id is retired', () => {
    const mine: Game = {
      ...first,
      actions: first.actions.filter((a) => a.id !== 'Fire'),
      retired: { modes: [], actions: ['Fire'] },
    };
    const merged = mergeHarvest(mine, FILE);
    expect([
      merged.game.actions.map((a) => a.id),
      merged.changes,
      gameProblem(merged.game),
    ]).toEqual([['Boost'], [], null]);
  });

  it('never brings back a mode you deleted, nor its actions', () => {
    const modes = [
      { id: 'flight', name: 'Flight' },
      { id: 'menu', name: 'Menus' },
    ];
    const open = act({ id: 'Open', mode: 'menu' });
    const read = mergeHarvest(null, fileGame([BOOST, open], modes)).game;
    const mine: Game = {
      ...read,
      modes: [{ id: 'flight', name: 'Flight' }],
      actions: [read.actions[0] as Action],
      retired: { modes: ['menu'], actions: ['Open'] },
    };
    const later = fileGame([BOOST, open, act({ id: 'Close', mode: 'menu' })], modes);
    const merged = mergeHarvest(mine, later);
    expect([merged.game.modes.map((m) => m.id), merged.game.actions.map((a) => a.id)]).toEqual([
      ['flight'],
      ['Boost'],
    ]);
  });

  it('adds a mode new in the file, and renames one only where you had not', () => {
    const modes = [
      { id: 'flight', name: 'Flight' },
      { id: 'menu', name: 'Menus' },
    ];
    const mine = mergeHarvest(null, fileGame([BOOST], modes)).game;
    const renamed = {
      ...mine,
      modes: [
        { id: 'flight', name: 'Ship' },
        { id: 'menu', name: 'Menus' },
      ],
    };
    const later = fileGame(
      [BOOST],
      [
        { id: 'flight', name: 'Flying' },
        { id: 'menu', name: 'Menu' },
        { id: 'photo', name: 'Photo mode' },
      ],
    );
    const merged = mergeHarvest(renamed, later);
    expect([merged.game.modes, merged.changes]).toEqual([
      [
        { id: 'flight', name: 'Ship' },
        { id: 'menu', name: 'Menu' },
        { id: 'photo', name: 'Photo mode' },
      ],
      [
        { kind: 'mode-renamed', mode: 'menu', from: 'Menus', to: 'Menu' },
        { kind: 'mode-added', mode: 'photo', name: 'Photo mode' },
      ],
    ]);
  });

  it('moves an action to the mode the file moved it to, unless you moved it', () => {
    const modes = [
      { id: 'flight', name: 'Flight' },
      { id: 'menu', name: 'Menus' },
      { id: 'photo', name: 'Photo mode' },
    ];
    const read = mergeHarvest(null, fileGame([BOOST, FIRE], modes)).game;
    const mine = {
      ...read,
      actions: read.actions.map((a) => (a.id === 'Fire' ? { ...a, mode: 'photo' } : a)),
    };
    const later = fileGame(
      [
        { ...BOOST, mode: 'menu' },
        { ...FIRE, mode: 'menu' },
      ],
      modes,
    );
    expect(mergeHarvest(mine, later).game.actions.map((a) => [a.id, a.mode])).toEqual([
      ['Boost', 'menu'],
      ['Fire', 'photo'],
    ]);
  });

  it('never moves an action into a mode you deleted', () => {
    const modes = [
      { id: 'flight', name: 'Flight' },
      { id: 'menu', name: 'Menus' },
    ];
    const read = mergeHarvest(
      null,
      fileGame([BOOST, act({ id: 'Open', mode: 'menu' })], modes),
    ).game;
    const mine: Game = {
      ...read,
      modes: [{ id: 'flight', name: 'Flight' }],
      actions: read.actions.filter((a) => a.mode === 'flight'),
      retired: { modes: ['menu'], actions: ['Open'] },
    };
    const later = fileGame([{ ...BOOST, mode: 'menu' }], modes);
    const merged = mergeHarvest(mine, later);
    expect([boostOf(merged.game)?.mode, gameProblem(merged.game)]).toEqual(['flight', null]);
  });

  it("keeps the data's own: its name, Steam id, retired ids and whether the sticks send keys", () => {
    const mine: Game = {
      ...first,
      name: 'ES2',
      steamAppId: 1128920,
      needsKeyStick: true,
      retired: { modes: [], actions: ['Old'] },
    };
    const { game } = mergeHarvest(mine, FILE);
    expect([game.name, game.steamAppId, game.needsKeyStick, game.retired]).toEqual([
      'ES2',
      1128920,
      true,
      { modes: [], actions: ['Old'] },
    ]);
  });

  it("takes the file's format into a game set up by hand, and fills only what it lacks", () => {
    const mine: Game = {
      id: 'es2',
      name: 'Everspace 2',
      modes: [{ id: 'flight', name: 'Flight' }],
      actions: [
        { id: 'Boost', name: 'Boost', mode: 'flight', required: false, native: { key: key('B') } },
      ],
    };
    const merged = mergeHarvest(mine, FILE);
    expect([merged.game.file, boostOf(merged.game)]).toEqual([
      { format: 'unreal-ini' },
      { ...BOOST, native: { key: key('B'), pad: 'LB' } },
    ]);
  });
});

describe('mergeHarvest: what helmArray put in the file itself', () => {
  const heldOf = (rows: Partial<GameBinding>[]): GameBinding[] =>
    rows.map((r) => ({
      set: 'keyboard',
      mode: 'flight',
      action: 'Boost',
      signal: null,
      native: key('LShift'),
      ...r,
    }));

  it('is not read as a default: an apply that moved Boost to F13, read back, changes nothing', () => {
    const now = fileGame([{ ...BOOST, native: { key: key('F13'), pad: 'LB' } }, FIRE]);
    const held = heldOf([{ signal: key('F13') }]);
    const merged = mergeHarvest(first, now, held);
    expect([merged.changes, boostOf(merged.game)?.native?.key, merged.game.fromFile]).toEqual([
      [],
      key('LShift'),
      first.fromFile,
    ]);
  });

  it('is not read as a default when helmArray took the action off every key', () => {
    const now = fileGame([{ ...BOOST, native: { pad: 'LB' } }, FIRE]);
    expect(mergeHarvest(first, now, heldOf([{ signal: null }])).changes).toEqual([]);
  });

  it('nor on the controller', () => {
    const now = fileGame([{ ...BOOST, native: { key: key('LShift'), pad: 'RB' } }, FIRE]);
    const held = heldOf([{ set: 'controller', signal: { kind: 'pad', control: 'RB' } }]);
    expect(mergeHarvest(first, now, held).changes).toEqual([]);
  });

  it('is news once the game was rebound since: a key other than the one helmArray put there', () => {
    const now = fileGame([{ ...BOOST, native: { key: key('G'), pad: 'LB' } }, FIRE]);
    const held = heldOf([{ signal: key('F13') }]);
    expect(boostOf(mergeHarvest(first, now, held).game)?.native?.key).toEqual(key('G'));
  });

  it('is only for the action it was written for: another action cleared in the file is news', () => {
    const now = fileGame([{ ...BOOST, native: { pad: 'LB' } }, FIRE]);
    const held = heldOf([{ action: 'Fire', signal: key('F13') }]);
    expect(boostOf(mergeHarvest(first, now, held).game)?.native).toEqual({ pad: 'LB' });
  });

  it('is news when the player took a key off that helmArray had put there', () => {
    const now = fileGame([{ ...BOOST, native: { pad: 'LB' } }, FIRE]);
    const held = heldOf([{ signal: key('F13') }, { signal: null }]);
    expect(boostOf(mergeHarvest(first, now, held).game)?.native).toEqual({ pad: 'LB' });
  });

  it('is news when the player bound a key where helmArray had put nothing', () => {
    const now = fileGame([{ ...BOOST, native: { key: key('G'), pad: 'LB' } }, FIRE]);
    expect(boostOf(mergeHarvest(first, now, heldOf([{ signal: null }])).game)?.native?.key).toEqual(
      key('G'),
    );
  });

  it('is either of two keys helmArray put there', () => {
    const now = fileGame([{ ...BOOST, native: { key: key('G'), pad: 'LB' } }, FIRE]);
    const held = heldOf([{ signal: key('F13') }, { signal: key('G') }]);
    expect(mergeHarvest(first, now, held).changes).toEqual([]);
  });

  it('reads each binding set on its own: a controller set cleared says nothing of the keys', () => {
    const now = fileGame([{ ...BOOST, native: { pad: 'LB' } }, FIRE]);
    const held = heldOf([{ set: 'controller', signal: null }]);
    expect(boostOf(mergeHarvest(first, now, held).game)?.native).toEqual({ pad: 'LB' });
  });

  it('reads each binding set on its own: keys cleared say nothing of the controller', () => {
    const now = fileGame([{ ...BOOST, native: { key: key('LShift') } }, FIRE]);
    const held = heldOf([{ set: 'keyboard', signal: null }]);
    expect(boostOf(mergeHarvest(first, now, held).game)?.native).toEqual({ key: key('LShift') });
  });

  it('is nothing for an action helmArray put on nothing new, on a game never read before', () => {
    const mine: Game = { ...first, actions: [{ ...BOOST, native: { pad: 'LB' } }, FIRE] };
    delete mine.fromFile;
    const now = fileGame([{ ...BOOST, native: { key: key('F13'), pad: 'LB' } }, FIRE]);
    expect(boostOf(mergeHarvest(mine, now, heldOf([{ signal: key('F13') }])).game)?.native).toEqual(
      { pad: 'LB' },
    );
  });
});

describe("gameProblem: what was last read from the game's file", () => {
  it('takes what a read leaves', () => {
    expect(gameProblem(first)).toBeNull();
  });

  it.each([
    ['not an object', 'x'],
    ['no actions', { modes: [] }],
    ['no modes', { actions: [] }],
    ['a mode with no name', { modes: [{ id: 'flight', name: '' }], actions: [] }],
    [
      'a mode with an id that cannot be used',
      { modes: [{ id: '__proto__', name: 'F' }], actions: [] },
    ],
    ['a mode that is not an object', { modes: [3], actions: [] }],
    [
      'an action in a mode it does not have',
      { modes: [{ id: 'flight', name: 'F' }], actions: [act({ id: 'a', mode: 'menu' })] },
    ],
  ])('refuses one with %s', (_what, fromFile) => {
    expect(gameProblem({ ...first, fromFile })).toBe(
      "What helmArray last read from the game's file can't be read.",
    );
  });
});

describe('mergeHarvest: a file with nothing usable in it', () => {
  const empty: Game = {
    id: 'es2',
    name: 'Everspace 2',
    modes: [],
    actions: [],
    file: { format: 'unreal-ini' },
  };
  const noModes: Game = { ...empty, actions: [act({ id: 'Boost' })] };
  const noActions: Game = { ...empty, modes: [{ id: 'flight', name: 'Flight' }] };
  const REFUSED = "There is nothing in the game's file helmArray can use.";

  it.each([
    ['no modes and no actions', empty],
    ['actions in no mode it has', noModes],
    ['modes and no action', noActions],
  ])('is refused, as a first read and into data you have, for a file with %s', (_what, file) => {
    expect([
      thrown(() => mergeHarvest(null, file)),
      thrown(() => mergeHarvest(first, file)),
    ]).toEqual([REFUSED, REFUSED]);
  });
});

/** The message of what `fn` throws, or null when it throws nothing. */
function thrown(fn: () => unknown): string | null {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
}
