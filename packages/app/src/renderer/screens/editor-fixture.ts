// A small two-mode game and schemes on it, for the editor's tests. Not shipped: nothing in the
// app imports this file.
import { AZERONS_ONLY, BUILT_IN_DEVICES, helldivers2, resolve } from '@helmarray/core';
import type { Action, Game, PadControl, Plan, Role, Scheme, Signal } from '@helmarray/core';

const act = (
  id: string,
  name: string,
  mode: string,
  role: Role,
  native?: Signal,
  required = false,
): Action => ({
  id,
  name,
  mode,
  role,
  required,
  ...(native ? { native: { key: native } } : {}),
});
const key = (code: 'J' | 'M' | 'U' | 'L' | 'LShift' | 'LCtrl' | 'Space' | 'Home'): Signal => ({
  kind: 'key',
  code,
});

export const game: Game = {
  id: 'lite',
  name: 'Lite Dangerous',
  modes: [
    { id: 'ship', name: 'Ship' },
    { id: 'srv', name: 'SRV' },
  ],
  actions: [
    act('boost', 'Boost', 'ship', 'movement', key('LShift')),
    act('fire', 'Fire', 'ship', 'combat', { kind: 'mouse', button: 'left' }),
    act('fsd', 'Frame shift drive', 'ship', 'travel', key('J'), true),
    act('galaxy', 'Galaxy map', 'ship', 'menu', key('M')),
    act('hardpoints', 'Hardpoints', 'ship', 'combat', key('U')),
    act('gear', 'Landing gear', 'ship', 'travel', key('L')),
    act('silent', 'Silent running', 'ship', 'ability', key('LCtrl')),
    act('jump', 'Jump', 'srv', 'movement', key('Space')),
    act('lights', 'SRV lights', 'srv', 'ability', key('Home')),
    act('srv_fire', 'Fire (SRV)', 'srv', 'combat', { kind: 'mouse', button: 'right' }),
  ],
};

/** Own keys: key output, the game's file left alone. */
export function keysScheme(): Scheme {
  return {
    id: 'lite-main',
    gameId: 'lite',
    name: 'Main',
    devices: { ...AZERONS_ONLY },
    output: 'keys',
    padMap: {},
    writeGameFile: false,
    map: {
      ship: {
        'L.index_1': { tap: 'boost' },
        'L.middle_1': { tap: 'fsd' },
        'R.index_1': { tap: 'fire' },
      },
      srv: { 'L.index_1': { tap: 'jump' } },
    },
    // Sticks on the mouse: a stick in keys mode with no directions is itself an error.
    behaviour: { 'L.stick': { stick: { mode: 'mouse' } }, 'R.stick': { stick: { mode: 'mouse' } } },
    ledger: {},
    accepted: [],
  };
}

/** Xbox output: each button sends its pad control. */
export function padScheme(): Scheme {
  return {
    ...keysScheme(),
    id: 'lite-pad',
    output: 'pad',
    padMap: { 'L.index_1': 'RB', 'L.middle_1': 'A', 'R.index_1': 'RT' },
    behaviour: {
      'L.stick': { stick: { mode: 'pad-left' } },
      'R.stick': { stick: { mode: 'pad-right' } },
    },
  };
}

export const plan = (scheme: Scheme, g: Game = game): Plan => resolve(scheme, g, BUILT_IN_DEVICES);

/** Freezes a value and everything inside it, so an edit that mutates its input throws. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/**
 * The same game with the Xbox controls it ships on, for controller output. `gear` and
 * `lights` have none: their controller default is not known, as for every Helldivers 2 action.
 */
const PAD_DEFAULTS: Record<string, PadControl> = {
  boost: 'RB',
  fire: 'RT',
  fsd: 'A',
  hardpoints: 'Y',
  silent: 'LB',
  galaxy: 'START',
  jump: 'RB',
  srv_fire: 'RT',
};
export const padGame: Game = {
  ...game,
  actions: game.actions.map((a) => {
    const pad = PAD_DEFAULTS[a.id];
    return pad === undefined ? a : { ...a, native: { ...a.native, pad } };
  }),
};

/** Ids that are also names on every object: a record keyed by data must keep them as entries. */
export const HOSTILE_IDS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'] as const;

/**
 * Helldivers 2 with hostile ids: its actions dealt into two modes named `__proto__` and
 * `constructor`, and four of the actions on buttons renamed to the hostile ids. Whatever a
 * transform does to a record keyed by mode or action id, it must do to these as entries.
 */
export const hostileGame: Game = (() => {
  const renamed: Record<string, string> = Object.fromEntries([
    ['interact', '__proto__'],
    ['reload', 'constructor'],
    ['crouch', 'toString'],
    ['fire_primary', 'hasOwnProperty'],
  ]);
  const modes = [
    { id: '__proto__', name: 'Proto' },
    { id: 'constructor', name: 'Constructor' },
  ];
  return {
    ...helldivers2,
    id: 'hostile',
    name: 'Hostile',
    modes,
    actions: helldivers2.actions.map((a, i) => ({
      ...a,
      id: Object.hasOwn(renamed, a.id) ? (renamed[a.id] ?? a.id) : a.id,
      mode: modes[i % 2]?.id ?? 'default',
    })),
  };
})();

/** The hostile game with every action in one mode, `__proto__`. */
export const hostileOneMode: Game = {
  ...hostileGame,
  modes: [{ id: '__proto__', name: 'Proto' }],
  actions: hostileGame.actions.map((a) => ({ ...a, mode: '__proto__' })),
};
