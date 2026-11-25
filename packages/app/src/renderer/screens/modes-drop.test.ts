// A drag in a mode, as the Editor makes it (editor-model's `drop`), over a game of three modes:
// the action goes on that button in that mode only, and the button keeps one signal in every mode
// (J4: docs/plans/02-architecture.md, "One signal per control-press per scheme, whatever the
// mode"). Seeded drags from the list and off other buttons, into any mode, from each preset and
// both outputs, each resolved with the ledger the last one dealt.

import { describe, expect, it } from 'vitest';
import type { Action, Game, KeyCode, PadControl, Scheme } from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
  CYBORG2_LEFT,
  CYBORG2_RIGHT,
  gameKeysPreset,
  resolve,
  signalId,
  xboxControllerPreset,
} from '@helmarray/core';
import { actionAt, drop, setOutput, shownAction } from './editor-model';

const key = (code: KeyCode) => ({ kind: 'key' as const, code });

/** Ship, SRV and on foot, as Elite has them: the same few buttons do a job in each. */
const game: Game = {
  id: 'three_modes',
  name: 'Three Modes',
  modes: [
    { id: 'ship', name: 'Ship' },
    { id: 'srv', name: 'SRV' },
    { id: 'foot', name: 'On foot' },
  ],
  actions: (
    [
      ['boost', 'Boost', 'ship', 'Tab', 'A'],
      ['fire', 'Fire', 'ship', 'Space', 'RT'],
      ['cargo', 'Cargo scoop', 'ship', 'Home', 'Y'],
      ['flight_assist', 'Flight assist', 'ship', 'Z', 'LB'],
      ['handbrake', 'Handbrake', 'srv', 'X', 'B'],
      ['turret', 'Turret', 'srv', 'U', 'Y'],
      ['srv_lights', 'Lights', 'srv', 'L', 'DPAD_UP'],
      ['jump', 'Jump', 'foot', 'Space', 'A'],
      ['crouch', 'Crouch', 'foot', 'C', 'B'],
      ['reload', 'Reload', 'foot', 'R', 'X'],
      ['melee', 'Melee', 'foot', 'V', 'RB'],
    ] as const satisfies readonly (readonly [string, string, string, KeyCode, PadControl])[]
  ).map(([id, name, mode, code, pad]): Action => ({
    id,
    name,
    mode,
    required: false,
    native: { key: key(code), pad },
  })),
  file: { format: 'elite-binds' },
};

const BUTTONS = [
  ...CYBORG2_LEFT.positions.filter((p) => p.name !== 'stick').map((p) => `L.${p.name}`),
  ...CYBORG2_RIGHT.positions.filter((p) => p.name !== 'stick').map((p) => `R.${p.name}`),
];

function seeded(seed: number) {
  let x = seed;
  return (n: number): number => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return Math.floor(x / 65536) % n;
  };
}

/** Every control-press that, across modes, is bound to more than one signal. */
function splitPresses(scheme: Scheme): string[] {
  const plan = resolve(scheme, game, BUILT_IN_DEVICES);
  const bySlot = new Map<string, Set<string>>();
  for (const b of plan.bindings) {
    const slot = `${b.control}|${b.press}`;
    bySlot.set(slot, (bySlot.get(slot) ?? new Set()).add(signalId(b.signal)));
  }
  return [...bySlot].filter(([, s]) => s.size > 1).map(([slot, s]) => `${slot}: ${[...s]}`);
}

const STARTS: [string, () => Scheme][] = [
  ['the Xbox controller preset', () => xboxControllerPreset(game)],
  ["the game's own keys", () => gameKeysPreset(game)],
  [
    'the Xbox controller preset, sending keys',
    () => setOutput(xboxControllerPreset(game), 'keys', game),
  ],
];

describe('a drag in a mode', () => {
  it('puts the action on that button in that mode, and leaves the other modes as they were', () => {
    let scheme = gameKeysPreset(game);
    scheme = drop(scheme, 'ship', 'L.index_1', 'boost', undefined, game);
    const before = scheme;
    const after = drop(scheme, 'foot', 'L.index_1', 'jump', undefined, game);
    expect({
      foot: actionAt(after, { mode: 'foot', control: 'L.index_1', press: 'tap' }),
      ship: after.map['ship'],
      srv: after.map['srv'],
    }).toEqual({ foot: 'jump', ship: before.map['ship'], srv: before.map['srv'] });
  });

  it('of an action of another mode puts nothing anywhere', () => {
    const scheme = gameKeysPreset(game);
    expect(drop(scheme, 'ship', 'L.index_1', 'jump', undefined, game)).toBe(scheme);
  });

  for (const [name, start] of STARTS) {
    it(`over 300 seeded drags from ${name}: that mode only, one signal per button press`, () => {
      const next = seeded(name.length * 7919);
      const faults: string[] = [];
      let scheme = start();
      for (let i = 1; i <= 300; i++) {
        const mode = game.modes[next(game.modes.length)]?.id ?? 'ship';
        const inMode = game.actions.filter((a) => a.mode === mode);
        const action = inMode[next(inMode.length)]?.id ?? '';
        const control = BUTTONS[next(BUTTONS.length)] ?? '';
        // Now and then dragged off another button of the mode that shows it.
        const off = BUTTONS.find((c) => shownAction(scheme, mode, c)?.id === action);
        const from =
          next(3) === 0 && off !== undefined ? { control: off, press: 'tap' as const } : undefined;
        const before = scheme;
        scheme = drop(scheme, mode, control, action, from, game);
        const others = game.modes.filter((m) => m.id !== mode);
        for (const m of others) {
          if (JSON.stringify(scheme.map[m.id]) !== JSON.stringify(before.map[m.id]))
            faults.push(`drag ${i} into ${mode} changed ${m.id}`);
        }
        if (shownAction(scheme, mode, control)?.id !== action)
          faults.push(`drag ${i}: ${action} is not on ${control} in ${mode}`);
        const plan = resolve(scheme, game, BUILT_IN_DEVICES);
        scheme = { ...scheme, ledger: plan.ledger };
        for (const split of splitPresses(scheme)) faults.push(`drag ${i}: ${split}`);
      }
      expect(faults.slice(0, 10)).toEqual([]);
    });
  }
});
