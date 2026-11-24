import { describe, expect, it } from 'vitest';
import { helldivers2 } from './games/helldivers2';
import { KEY_CODES } from './keys';
import type { Action, Game } from './model';
import { PAD_CONTROLS } from './model';
import { ROLES, gameProblem, idFromName, isDataId } from './game-data';

const action = (over: Partial<Action> & Pick<Action, 'id' | 'name'>): Action => ({
  mode: 'default',
  role: 'combat',
  required: false,
  ...over,
});

const game = (over: Partial<Game> = {}): Game => ({
  id: 'arena',
  name: 'Arena',
  modes: [{ id: 'default', name: 'Default' }],
  actions: [action({ id: 'fire', name: 'Fire', native: { key: { kind: 'key', code: 'F' } } })],
  ...over,
});

/** A game as a window could send it: any shape at all. */
const raw = (over: Record<string, unknown>): unknown => ({ ...game(), ...over });

describe('gameProblem: a game that can be saved', () => {
  it('finds nothing wrong with Helldivers 2', () => {
    expect(gameProblem(helldivers2)).toBeNull();
  });

  it('finds nothing wrong with a game that has no actions yet', () => {
    expect(gameProblem(game({ actions: [] }))).toBeNull();
  });

  it('takes every key code, every mouse button and every Xbox control as a default', () => {
    const actions: Action[] = [
      ...KEY_CODES.map((code, i) =>
        action({ id: `k${i}`, name: `Key ${code}`, native: { key: { kind: 'key', code } } }),
      ),
      ...(['left', 'middle', 'right', 'back', 'forward'] as const).map((button) =>
        action({ id: `m_${button}`, name: button, native: { key: { kind: 'mouse', button } } }),
      ),
      ...PAD_CONTROLS.map((pad) => action({ id: `p_${pad}`, name: pad, native: { pad } })),
      action({
        id: 'scroll',
        name: 'Next weapon',
        native: { key: { kind: 'scroll', dir: 'up', speed: 1 } },
      }),
      action({
        id: 'combo',
        name: 'Quick save',
        native: { key: { kind: 'key', code: 'S', mods: ['ctrl', 'shift'] } },
      }),
    ];
    expect(gameProblem(game({ actions }))).toBeNull();
  });

  it('takes every role', () => {
    const actions = ROLES.map((role) => action({ id: role, name: role, role }));
    expect(gameProblem(game({ actions }))).toBeNull();
  });
});

describe('gameProblem: one plain sentence for what is wrong', () => {
  it.each<[string, unknown, string]>([
    ['not an object', 'Arena', "This isn't a game helmArray can read."],
    ['an array', [], "This isn't a game helmArray can read."],
    ['no name', raw({ name: '  ' }), 'The game needs a name.'],
    ['a name that is not text', raw({ name: 3 }), 'The game needs a name.'],
    [
      'a Steam id that is not a whole number',
      raw({ steamAppId: 1.5 }),
      "The game's Steam id must be a whole number.",
    ],
    ['a negative Steam id', raw({ steamAppId: -4 }), "The game's Steam id must be a whole number."],
    ['no modes', raw({ modes: [] }), 'The game needs at least one mode.'],
    ['modes that are not a list', raw({ modes: {} }), 'The game needs at least one mode.'],
    ['actions that are not a list', raw({ actions: {} }), "The game's actions can't be read."],
    [
      'a mode with no name',
      raw({ modes: [{ id: 'default', name: '' }] }),
      'Every mode needs a name.',
    ],
    ['a mode that is not an object', raw({ modes: [null] }), 'Every mode needs a name.'],
    [
      'two modes with one id',
      raw({
        modes: [
          { id: 'default', name: 'Ship' },
          { id: 'default', name: 'Foot' },
        ],
      }),
      'Two modes have the same id, "default".',
    ],
    [
      'a mode id an object inherits',
      raw({ modes: [{ id: 'constructor', name: 'Ship' }], actions: [] }),
      "The mode Ship has an id helmArray can't use.",
    ],
    [
      'a mode id with a space',
      raw({ modes: [{ id: 'on foot', name: 'On foot' }], actions: [] }),
      "The mode On foot has an id helmArray can't use.",
    ],
    ['an action that is not an object', raw({ actions: [7] }), 'Every action needs a name.'],
    [
      'an action with no name',
      raw({ actions: [action({ id: 'fire', name: ' ' })] }),
      'Every action needs a name.',
    ],
    [
      'an action id an object inherits',
      raw({ actions: [action({ id: 'toString', name: 'Fire' })] }),
      "Fire has an id helmArray can't use.",
    ],
    [
      'an action id of __proto__',
      raw({ actions: [action({ id: '__proto__', name: 'Fire' })] }),
      "Fire has an id helmArray can't use.",
    ],
    [
      'two actions with one id',
      raw({
        actions: [action({ id: 'fire', name: 'Fire' }), action({ id: 'fire', name: 'Shoot' })],
      }),
      'Two actions have the same id, "fire".',
    ],
    [
      'an action in a mode the game does not have',
      raw({ actions: [action({ id: 'fire', name: 'Fire', mode: 'ship' })] }),
      "Fire is in a mode the game doesn't have.",
    ],
    [
      'an action in a mode named like an inherited property',
      raw({ actions: [action({ id: 'fire', name: 'Fire', mode: 'constructor' })] }),
      "Fire is in a mode the game doesn't have.",
    ],
    [
      'an action with a role helmArray does not have',
      raw({ actions: [{ ...action({ id: 'fire', name: 'Fire' }), role: 'stealth' }] }),
      'Fire needs a role: combat, movement, ability, travel or menu.',
    ],
    [
      'an action whose required is not yes or no',
      raw({ actions: [{ ...action({ id: 'fire', name: 'Fire' }), required: 'yes' }] }),
      'Fire must be required or not.',
    ],
    [
      'a default key helmArray has no name for',
      raw({
        actions: [
          action({
            id: 'fire',
            name: 'Fire',
            native: { key: { kind: 'key', code: 'F25' as never } },
          }),
        ],
      }),
      "Fire's default key isn't a key or mouse button helmArray knows.",
    ],
    [
      'a default key that is an Xbox control',
      raw({
        actions: [
          action({ id: 'fire', name: 'Fire', native: { key: { kind: 'pad', control: 'A' } } }),
        ],
      }),
      "Fire's default key isn't a key or mouse button helmArray knows.",
    ],
    [
      'a default key with a modifier helmArray has no name for',
      raw({
        actions: [
          action({
            id: 'fire',
            name: 'Fire',
            native: { key: { kind: 'key', code: 'F', mods: ['meta' as never] } },
          }),
        ],
      }),
      "Fire's default key isn't a key or mouse button helmArray knows.",
    ],
    [
      'a default mouse button helmArray has no name for',
      raw({
        actions: [
          action({
            id: 'fire',
            name: 'Fire',
            native: { key: { kind: 'mouse', button: 'thumb' as never } },
          }),
        ],
      }),
      "Fire's default key isn't a key or mouse button helmArray knows.",
    ],
    [
      'a default scroll with no speed',
      raw({
        actions: [
          action({
            id: 'fire',
            name: 'Fire',
            native: { key: { kind: 'scroll', dir: 'up' } as never },
          }),
        ],
      }),
      "Fire's default key isn't a key or mouse button helmArray knows.",
    ],
    [
      'a default controller button an Xbox controller does not have',
      raw({ actions: [action({ id: 'fire', name: 'Fire', native: { pad: 'Z' as never } })] }),
      "Fire's default controller button isn't one an Xbox controller has.",
    ],
    [
      'defaults that are not an object',
      raw({ actions: [{ ...action({ id: 'fire', name: 'Fire' }), native: 'F' }] }),
      "Fire's default key isn't a key or mouse button helmArray knows.",
    ],
    [
      'a file format helmArray does not write',
      raw({ file: { format: 'json' } }),
      "The game's file format isn't one helmArray knows.",
    ],
    [
      'a key-stick setting that is not yes or no',
      raw({ needsKeyStick: 'yes' }),
      'Whether the sticks must send keys must be yes or no.',
    ],
  ])('%s', (_what, value, sentence) => {
    expect(gameProblem(value)).toBe(sentence);
  });

  it('names the first problem only, in the order a person reads the game', () => {
    expect(gameProblem(raw({ name: '', actions: [action({ id: 'fire', name: '' })] }))).toBe(
      'The game needs a name.',
    );
  });
});

describe('isDataId', () => {
  it.each(['default', 'move_forward', 'weapon-2', 'a.b', 'A1'])('takes %s', (id) => {
    expect(isDataId(id)).toBe(true);
  });

  it.each([
    '',
    ' ',
    '_x',
    '-x',
    'on foot',
    'constructor',
    'toString',
    'hasOwnProperty',
    '__proto__',
    'x'.repeat(65),
    7,
  ])('refuses %s', (id) => {
    expect(isDataId(id)).toBe(false);
  });
});

describe('idFromName', () => {
  const free = (taken: string[]) => (id: string) => isDataId(id) && !taken.includes(id);

  it('makes a lower-case id of the name', () => {
    expect(idFromName('Throw Grenade!', free([]), 'action')).toBe('throw_grenade');
  });

  it('drops accents rather than the letters under them', () => {
    expect(idFromName('Évasion', free([]), 'action')).toBe('evasion');
  });

  it('counts up past an id already taken', () => {
    expect(idFromName('Fire', free(['fire', 'fire_2']), 'action')).toBe('fire_3');
  });

  it('counts up past a name every object inherits', () => {
    expect(idFromName('Constructor', free([]), 'mode')).toBe('constructor_2');
  });

  it('uses the fallback for a name with no letters it can use', () => {
    expect(idFromName('火力', free([]), 'action')).toBe('action');
  });

  it('counts up from the fallback too', () => {
    expect(idFromName('', free(['mode']), 'mode')).toBe('mode_2');
  });

  it('keeps a long name short enough to be an id', () => {
    const id = idFromName('a very long name '.repeat(10), free([]), 'action');
    expect([isDataId(id), id.length <= 40]).toEqual([true, true]);
  });
});
