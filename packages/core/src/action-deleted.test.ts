// An action deleted from a game, in the setups that used it (docs/plans/02-architecture.md,
// *Storage*): editing a game never rewrites a setup, so the setup still names the action's id.
// The resolver treats it as on nothing, and the check says so on the control that carries it.

import { describe, expect, it } from 'vitest';
import { clone } from './clone';
import { BUILT_IN_DEVICES } from './devices/index';
import type { Game, Scheme } from './model';
import { blankKeysScheme } from './presets/keys';
import { xboxControllerPreset } from './presets/xbox';
import { resolve } from './resolve';

const game: Game = {
  id: 'arena',
  name: 'Arena',
  modes: [
    { id: 'fight', name: 'Fighting' },
    { id: 'drive', name: 'Driving' },
  ],
  actions: [
    {
      id: 'jump',
      name: 'Jump',
      mode: 'fight',
      role: 'movement',
      required: false,
      native: { key: { kind: 'key', code: 'Space' }, pad: 'A' },
    },
    {
      id: 'reload',
      name: 'Reload',
      mode: 'fight',
      role: 'combat',
      required: false,
      native: { key: { kind: 'key', code: 'R' }, pad: 'X' },
    },
    {
      id: 'honk',
      name: 'Honk',
      mode: 'drive',
      role: 'travel',
      required: false,
      native: { key: { kind: 'key', code: 'H' }, pad: 'Y' },
    },
  ],
};

/** The game with one action taken out. */
const without = (id: string): Game => ({
  ...game,
  actions: game.actions.filter((a) => a.id !== id),
});

/** The game's own keys, with Reload on the left index 1 tap and Jump on index 2. */
function keysScheme(): Scheme {
  const scheme = blankKeysScheme(game);
  scheme.map['fight'] = {
    'L.index_1': { tap: 'reload' },
    'L.index_2': { tap: 'jump' },
  };
  return scheme;
}

const deleted = (scheme: Scheme, g: Game) =>
  resolve(scheme, g, BUILT_IN_DEVICES).findings.filter((f) => f.rule === 'action-deleted');

describe('an action deleted from the game, in a setup that used it', () => {
  it('is a warning on the button that carries it, in its mode', () => {
    expect(deleted(keysScheme(), without('reload'))).toEqual([
      {
        rule: 'action-deleted',
        severity: 'warning',
        control: 'L.index_1',
        mode: 'fight',
        action: 'reload',
        message: 'The action on this button was deleted from Arena, so pressing it does nothing.',
      },
    ]);
  });

  it('is not raised while the game still has the action', () => {
    expect(deleted(keysScheme(), game)).toEqual([]);
  });

  it('is not raised for an action that was only renamed: it keeps its id', () => {
    const renamed: Game = {
      ...game,
      actions: game.actions.map((a) => (a.id === 'reload' ? { ...a, name: 'Load ammo' } : a)),
    };
    expect(deleted(keysScheme(), renamed)).toEqual([]);
  });

  it('gets no key: the button sends nothing, and no key is dealt to it', () => {
    const plan = resolve(keysScheme(), without('reload'), BUILT_IN_DEVICES);
    const pin = plan.units.left?.pins.find((p) => p.control === 'L.index_1');
    expect([pin?.presses, plan.ledger['L.index_1']]).toEqual([{}, undefined]);
  });

  it('leaves the other buttons as they were', () => {
    const plan = resolve(keysScheme(), without('reload'), BUILT_IN_DEVICES);
    expect(plan.bindings.map((b) => [b.control, b.action, b.signal])).toEqual([
      ['L.index_2', 'jump', { kind: 'key', code: 'Space' }],
    ]);
  });

  it('is not raised as a button that sends nothing as well', () => {
    const rules = resolve(keysScheme(), without('reload'), BUILT_IN_DEVICES).findings.map(
      (f) => f.rule,
    );
    expect(rules.filter((r) => r === 'sends-nothing')).toEqual([]);
  });

  it('carries no binding with controller output either: the button sends its Xbox control for nothing', () => {
    // The preset put Reload on the button sending Xbox X, where the game ships it.
    const scheme = xboxControllerPreset(game);
    const carrier = Object.entries(scheme.map['fight'] ?? {}).find(
      ([, presses]) => presses.tap === 'reload',
    )?.[0];
    const plan = resolve(scheme, without('reload'), BUILT_IN_DEVICES);
    expect([
      carrier === undefined ? undefined : scheme.padMap[carrier],
      plan.bindings.filter((b) => b.action === 'reload'),
      plan.gameBindings.filter((b) => b.action === 'reload'),
    ]).toEqual(['X', [], []]);
  });

  it('is said once per button and mode, whichever presses carry it', () => {
    const scheme = keysScheme();
    scheme.map['fight'] = { 'L.index_1': { tap: 'reload', long: 'reload', double: 'jump' } };
    expect(deleted(scheme, without('reload')).map((f) => [f.control, f.mode])).toEqual([
      ['L.index_1', 'fight'],
    ]);
  });

  it('names a key a key', () => {
    const scheme: Scheme = {
      ...keysScheme(),
      devices: { azerons: 'none', keyboard: true, mouse: true, controller: false },
      map: { fight: { 'key.R': { tap: 'reload' } }, drive: {} },
    };
    expect(deleted(scheme, without('reload')).map((f) => [f.control, f.message])).toEqual([
      ['key.R', 'The action on this key was deleted from Arena, so pressing it does nothing.'],
    ]);
  });

  it('is raised, with no mode, when the action went with its whole mode', () => {
    const scheme = keysScheme();
    scheme.map['drive'] = { 'L.ring_1': { tap: 'honk' } };
    const noDriving: Game = {
      ...game,
      modes: game.modes.filter((m) => m.id !== 'drive'),
      actions: game.actions.filter((a) => a.mode !== 'drive'),
    };
    expect(deleted(scheme, noDriving)).toEqual([
      {
        rule: 'action-deleted',
        severity: 'warning',
        control: 'L.ring_1',
        action: 'honk',
        message: 'The action on this button was deleted from Arena, so pressing it does nothing.',
      },
    ]);
  });

  it('is raised for an action moved to another mode, in the mode the setup has it in', () => {
    const moved: Game = {
      ...game,
      actions: game.actions.map((a) => (a.id === 'reload' ? { ...a, mode: 'drive' } : a)),
    };
    expect(deleted(keysScheme(), moved).map((f) => [f.control, f.mode, f.action])).toEqual([
      ['L.index_1', 'fight', 'reload'],
    ]);
  });

  it('is kept with the reason when the setup accepted it', () => {
    const scheme = keysScheme();
    scheme.accepted = [
      { rule: 'action-deleted', control: 'L.index_1', action: 'reload', reason: 'I know' },
    ];
    expect(deleted(scheme, without('reload')).map((f) => f.accepted)).toEqual(['I know']);
  });

  it('reads a mode named like an inherited property as an ordinary mode', () => {
    const scheme = keysScheme();
    scheme.map = JSON.parse(
      '{"fight": {}, "drive": {}, "constructor": {"L.ring_2": {"tap": "gone"}}}',
    ) as Scheme['map'];
    expect(deleted(scheme, game).map((f) => [f.control, f.mode, f.action])).toEqual([
      ['L.ring_2', undefined, 'gone'],
    ]);
  });

  it('does not change the setup it was given', () => {
    const scheme = keysScheme();
    const before = clone(scheme);
    resolve(scheme, without('reload'), BUILT_IN_DEVICES);
    expect(scheme).toEqual(before);
  });
});
