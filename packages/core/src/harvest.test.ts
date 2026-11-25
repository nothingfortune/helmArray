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
    expect(mergeHarvest(first, FILE)).toEqual({ game: first, changes: [], moves: [] });
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

describe('mergeHarvest: an action typed in by hand that the file has too, by name, in the same mode', () => {
  /** A game typed in by hand before its file was read: never read, its actions its own ids. */
  const typed = (actions: Action[], modes = [{ id: 'flight', name: 'Flight' }]): Game => ({
    id: 'es2',
    name: 'Everspace 2',
    steamAppId: 1128920,
    modes,
    actions,
  });
  const MY_BOOST = act({ id: 'boost', name: 'boost', role: 'movement', native: { key: key('G') } });

  it("takes the file's id, keeps what you typed, fills what you left empty, and doesn't add the file's beside it", () => {
    const { game } = mergeHarvest(typed([MY_BOOST]), FILE);
    expect(game.actions).toEqual([
      {
        id: 'Boost',
        name: 'boost',
        mode: 'flight',
        role: 'movement',
        required: false,
        native: { key: key('G'), pad: 'LB' },
      },
      FIRE,
    ]);
  });

  it('says so, naming yours, the one in the file, and what of yours stays', () => {
    expect(mergeHarvest(typed([MY_BOOST]), FILE).changes).toEqual([
      {
        kind: 'same-name',
        action: 'boost',
        name: 'boost',
        file: 'Boost',
        from: 'flight',
        mode: 'flight',
        kept: ['name', 'role', 'key'],
      },
      { kind: 'added', action: 'Fire', name: 'Fire primary', mode: 'flight' },
      { kind: 'format' },
    ]);
  });

  it('gives the move from your id to the file’s, for everything that names yours', () => {
    expect(mergeHarvest(typed([MY_BOOST]), FILE).moves).toEqual([
      { action: 'boost', mode: 'flight', to: 'Boost', toMode: 'flight' },
    ]);
  });

  it('matches a name in any case and with any spaces, and keeps yours where it is', () => {
    const mine = act({ id: 'fire', name: ' FIRE  pri mary ', mode: 'flight' });
    expect(mergeHarvest(typed([mine]), FILE).game.actions.map((a) => a.id)).toEqual([
      'Fire',
      'Boost',
    ]);
  });

  it('matches only within that mode when the file has your mode: the same name in another is another action', () => {
    const modes = [
      { id: 'flight', name: 'Flight' },
      { id: 'menus', name: 'Menus' },
    ];
    const file = fileGame([BOOST, FIRE, act({ id: 'Map', mode: 'menus' })], modes);
    const mine = act({ id: 'boost', name: 'Boost', mode: 'menus' });
    expect(
      mergeHarvest(typed([mine], modes), file).game.actions.map((a) => `${a.mode}/${a.id}`),
    ).toEqual(['flight/Boost', 'flight/Fire', 'menus/boost', 'menus/Map']);
  });

  it('matches each of yours once: a second action of that name in the file is added', () => {
    const file = fileGame([BOOST, act({ id: 'Boost2', name: 'Boost' })]);
    const { game, changes } = mergeHarvest(typed([MY_BOOST]), file);
    expect([
      game.actions.map((a) => a.id),
      changes.filter((c) => c.kind === 'same-name').length,
    ]).toEqual([['Boost', 'Boost2'], 1]);
  });

  it("doesn't match an action the file had at the last read: it is the file's, not typed in", () => {
    const read = mergeHarvest(null, fileGame([act({ id: 'OldBoost', name: 'Boost' })])).game;
    const { game } = mergeHarvest(read, FILE);
    expect(game.actions.map((a) => a.id)).toEqual(['OldBoost', 'Boost', 'Fire']);
  });

  it("finds nothing more on the next read: yours is the file's now, and what you typed stays", () => {
    const once = mergeHarvest(typed([MY_BOOST]), FILE).game;
    const again = mergeHarvest(once, FILE);
    expect([again.game, again.moves, again.changes.map((c) => c.kind)]).toEqual([
      once,
      [],
      ['kept', 'kept', 'kept'],
    ]);
  });

  it("leaves an action of yours whose id is the file's to the field rule, not the name rule", () => {
    const mine = typed([{ ...BOOST, native: { key: key('G') } }]);
    expect(mergeHarvest(mine, FILE).changes.map((c) => c.kind)).not.toContain('same-name');
  });

  it("doesn't match a file action whose id you retired: yours stays, and the file's stays out", () => {
    const mine = { ...typed([MY_BOOST]), retired: { modes: [], actions: ['Boost'] } };
    const { game, moves } = mergeHarvest(mine, FILE);
    expect([game.actions.map((a) => a.id), moves]).toEqual([['boost', 'Fire'], []]);
  });
});

describe("mergeHarvest: an action typed in by hand in a mode the file doesn't have", () => {
  const MODES = [
    { id: 'flight', name: 'Flight' },
    { id: 'menus', name: 'Menus' },
  ];
  const MAP = act({ id: 'Map', name: 'Galaxy map', mode: 'menus', native: { key: key('M') } });
  const FILE2 = fileGame([BOOST, FIRE, MAP], MODES);
  /** A game typed in on the Game screen: one mode, `default`, which no file has. */
  const typed = (actions: Action[]): Game => ({
    id: 'es2',
    name: 'Everspace 2',
    steamAppId: 1128920,
    modes: [{ id: 'default', name: 'Default' }],
    actions: actions.map((a) => ({ ...a, mode: 'default' })),
  });
  const MY_BOOST: Action = {
    id: 'boost',
    name: 'Boost',
    mode: 'default',
    required: false,
    native: { key: key('G') },
  };
  const WAVE: Action = { id: 'wave', name: 'Wave', mode: 'default', required: false };

  it("takes the id and the mode of the one file action of that name, in whichever of the file's modes", () => {
    const { game } = mergeHarvest(typed([MY_BOOST, WAVE]), FILE2);
    expect(game.actions.find((a) => a.name === 'Boost')).toEqual({
      id: 'Boost',
      name: 'Boost',
      mode: 'flight',
      role: 'combat',
      required: false,
      native: { key: key('G'), pad: 'LB' },
    });
  });

  it("goes where the file's would, at the end of its mode in the file's order; what is left of yours stays", () => {
    const { game } = mergeHarvest(typed([MY_BOOST, WAVE]), FILE2);
    expect(game.actions.map((a) => `${a.mode}/${a.id}`)).toEqual([
      'menus/Map',
      'flight/Boost',
      'flight/Fire',
      'default/wave',
    ]);
  });

  it('says it moves, from where to where, and what of yours stays; and gives the move', () => {
    const { changes, moves } = mergeHarvest(typed([MY_BOOST, WAVE]), FILE2);
    expect([changes.filter((c) => c.kind === 'same-name'), moves]).toEqual([
      [
        {
          kind: 'same-name',
          action: 'boost',
          name: 'Boost',
          file: 'Boost',
          from: 'default',
          mode: 'flight',
          kept: ['key'],
        },
      ],
      [{ action: 'boost', mode: 'default', to: 'Boost', toMode: 'flight' }],
    ]);
  });

  it('keeps nothing of yours over the file when you typed only the name', () => {
    const mine: Action = { id: 'boost', name: 'Boost', mode: 'default', required: false };
    const change = mergeHarvest(typed([mine]), FILE2).changes.find((c) => c.kind === 'same-name');
    expect(change && 'kept' in change ? change.kept : null).toEqual([]);
  });

  it('removes the mode it leaves empty, and says so', () => {
    const { game, changes } = mergeHarvest(typed([MY_BOOST]), FILE2);
    expect([game.modes.map((m) => m.id), changes.filter((c) => c.kind === 'mode-removed')]).toEqual(
      [['flight', 'menus'], [{ kind: 'mode-removed', mode: 'default', name: 'Default' }]],
    );
  });

  it('keeps that mode while a setup still places something else in it', () => {
    const uses = [
      { mode: 'default', action: 'boost' },
      { mode: 'default', action: 'gone' },
    ];
    const { game, changes } = mergeHarvest(typed([MY_BOOST]), FILE2, null, uses);
    expect([game.modes.map((m) => m.id), changes.map((c) => c.kind)]).toEqual([
      ['default', 'flight', 'menus'],
      ['mode-added', 'mode-added', 'same-name', 'added', 'added', 'format'],
    ]);
  });

  it('removes it when the only thing a setup places in it is what moves', () => {
    const uses = [{ mode: 'default', action: 'boost' }];
    const { game } = mergeHarvest(typed([MY_BOOST]), FILE2, null, uses);
    expect(game.modes.map((m) => m.id)).toEqual(['flight', 'menus']);
  });

  it('keeps a mode of yours that was empty before the read', () => {
    const mine = {
      ...typed([MY_BOOST, WAVE]),
      modes: [
        { id: 'default', name: 'Default' },
        { id: 'spare', name: 'Spare' },
      ],
    };
    expect(mergeHarvest(mine, FILE2).game.modes.map((m) => m.id)).toEqual([
      'default',
      'spare',
      'flight',
      'menus',
    ]);
  });

  it('matches nothing when the file has the name more than once, keeps them all, and says so', () => {
    const twice = fileGame([BOOST, FIRE, { ...MAP, id: 'MenuBoost', name: 'boost ' }], MODES);
    const { game, changes, moves } = mergeHarvest(typed([MY_BOOST]), twice);
    expect({
      ids: game.actions.map((a) => a.id),
      several: changes.filter((c) => c.kind === 'same-name-several'),
      moves,
    }).toEqual({
      ids: ['MenuBoost', 'Boost', 'Fire', 'boost'],
      several: [
        {
          kind: 'same-name-several',
          action: 'boost',
          name: 'Boost',
          modes: ['flight', 'menus'],
        },
      ],
      moves: [],
    });
  });

  it('names a mode once when the file has the name twice in it', () => {
    const twice = fileGame([BOOST, FIRE, MAP, { ...BOOST, id: 'Boost2' }], MODES);
    const change = mergeHarvest(typed([MY_BOOST]), twice).changes.find(
      (c) => c.kind === 'same-name-several',
    );
    expect(change && 'modes' in change ? change.modes : null).toEqual(['flight']);
  });

  it('gives one file action to one of yours: a second of that name stays in your mode', () => {
    const second = { ...MY_BOOST, id: 'boost_2', native: { key: key('H') } };
    const { game, moves } = mergeHarvest(typed([MY_BOOST, second]), FILE2);
    expect([game.actions.map((a) => `${a.mode}/${a.id}`), moves.map((m) => m.action)]).toEqual([
      ['menus/Map', 'flight/Boost', 'flight/Fire', 'default/boost_2'],
      ['boost'],
    ]);
  });

  it('lets one of yours in the same mode take it first', () => {
    const mine: Game = {
      ...typed([MY_BOOST]),
      modes: [
        { id: 'default', name: 'Default' },
        { id: 'flight', name: 'Flight' },
      ],
      actions: [MY_BOOST, { ...MY_BOOST, id: 'flight_boost', mode: 'flight' }],
    };
    expect(mergeHarvest(mine, FILE2).moves).toEqual([
      { action: 'flight_boost', mode: 'flight', to: 'Boost', toMode: 'flight' },
    ]);
  });

  it('matches no file action whose mode you deleted', () => {
    const mine = { ...typed([MY_BOOST]), retired: { modes: ['flight'], actions: [] } };
    const { game, moves } = mergeHarvest(mine, FILE2);
    expect([game.actions.map((a) => `${a.mode}/${a.id}`), moves]).toEqual([
      ['menus/Map', 'default/boost'],
      [],
    ]);
  });

  it('matches no file action that is already in your data', () => {
    const mine: Game = {
      ...typed([MY_BOOST]),
      modes: [
        { id: 'default', name: 'Default' },
        { id: 'flight', name: 'Flight' },
      ],
      actions: [MY_BOOST, BOOST],
    };
    expect(mergeHarvest(mine, FILE2).moves).toEqual([]);
  });

  it('leaves a game that can be saved, and a second read that changes nothing', () => {
    const once = mergeHarvest(typed([MY_BOOST, WAVE]), FILE2).game;
    const again = mergeHarvest(once, FILE2);
    expect([gameProblem(once), again.game, again.moves]).toEqual([null, once, []]);
  });
});

describe("mergeHarvest: the sticks must send keys, from the game's head start", () => {
  const keysOnly: Game = { ...FILE, needsKeyStick: true };
  const handGame: Game = {
    id: 'es2',
    name: 'Everspace 2',
    modes: [{ id: 'default', name: 'Default' }],
    actions: [{ id: 'wave', name: 'Wave', mode: 'default', required: false }],
  };

  it('is set on a game typed in by hand when its file is first read into it, and said', () => {
    const { game, changes } = mergeHarvest(handGame, keysOnly);
    expect([game.needsKeyStick, changes.filter((c) => c.kind === 'key-stick')]).toEqual([
      true,
      [{ kind: 'key-stick' }],
    ]);
  });

  it('is set on a first read with no data', () => {
    expect(mergeHarvest(null, keysOnly).game.needsKeyStick).toBe(true);
  });

  it("is yours once the game was read: a later read doesn't set it", () => {
    const { game, changes } = mergeHarvest(first, keysOnly);
    expect([game.needsKeyStick, changes]).toEqual([undefined, []]);
  });

  it('is yours when you set it either way', () => {
    const { game, changes } = mergeHarvest({ ...handGame, needsKeyStick: false }, keysOnly);
    expect([game.needsKeyStick, changes.some((c) => c.kind === 'key-stick')]).toEqual([
      false,
      false,
    ]);
  });

  it("isn't set from a file that doesn't say it", () => {
    const { game, changes } = mergeHarvest(handGame, FILE);
    expect([game.needsKeyStick, changes.map((c) => c.kind).includes('key-stick')]).toEqual([
      undefined,
      false,
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
