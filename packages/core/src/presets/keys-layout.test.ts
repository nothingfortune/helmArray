// The *game's own keys* preset's layout rule (GAME'S OWN KEYS: THE LAYOUT RULE, in keys.ts).
import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES } from '../devices/index';
import { helldivers2 } from '../games/helldivers2';
import type { Action, Game, Signal } from '../model';
import { resolve } from '../resolve';
import { signalId } from '../signal';
import { REST_ORDER, gameKeysPreset } from './keys';
import { xboxControllerPreset } from './xbox';

const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;

const act = (
  id: string,
  native: NonNullable<Action['native']>,
  over: Partial<Action> = {},
): Action => ({
  id,
  name: id,
  mode: 'default',
  role: 'combat',
  required: false,
  native,
  ...over,
});

const gameOf = (actions: Action[], modes = ['default']): Game => ({
  id: 'g',
  name: 'G',
  modes: modes.map((id) => ({ id, name: id })),
  actions,
});

/** The control carrying an action's tap in a mode, or undefined. */
const where = (map: ReturnType<typeof gameKeysPreset>['map'], mode: string, action: string) =>
  Object.entries(map[mode] ?? {}).find(([, p]) => p.tap === action)?.[0];

describe("the game's own keys on Helldivers 2", () => {
  const scheme = gameKeysPreset(helldivers2);
  const plan = resolve(scheme, helldivers2, BUILT_IN_DEVICES);

  it('resolves with nothing to fix and nothing to set in the game', () => {
    expect({ findings: plan.findings, bindSheet: plan.bindSheet }).toEqual({
      findings: [],
      bindSheet: [],
    });
  });

  it('has the left stick send W, S, A and D, and the right stick move the mouse', () => {
    expect([scheme.behaviour['L.stick'], scheme.behaviour['R.stick']]).toEqual([
      {
        stick: {
          mode: 'keys',
          directions: { up: key('W'), down: key('S'), left: key('A'), right: key('D') },
        },
      },
      { stick: { mode: 'mouse' } },
    ]);
  });

  it('puts the four movement actions on the stick and on no button', () => {
    expect(
      ['move_forward', 'move_back', 'strafe_left', 'strafe_right'].map((a) =>
        where(scheme.map, 'default', a),
      ),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('puts every other action on a button, each sending the key the game ships it on', () => {
    const faults = plan.bindings.flatMap((b) => {
      const native = helldivers2.actions.find((a) => a.id === b.action)?.native?.key;
      return native !== undefined && signalId(native) === signalId(b.signal) ? [] : [b.action];
    });
    expect({ placed: plan.bindings.length, faults }).toEqual({
      placed: helldivers2.actions.length - 4,
      faults: [],
    });
  });

  it('puts an action on the button the Xbox controller preset gives it', () => {
    const xbox = xboxControllerPreset(helldivers2).map['default'] ?? {};
    const faults = Object.entries(xbox).flatMap(([control, presses]) =>
      presses.tap !== undefined && where(scheme.map, 'default', presses.tap) !== control
        ? [`${presses.tap} on ${control}`]
        : [],
    );
    expect({ homes: Object.keys(xbox).length, faults }).toEqual({ homes: 15, faults: [] });
  });

  it('puts the actions with no home of their own on the right unit, in the game’s order', () => {
    expect(
      ['jump', 'prone', 'dive', 'grenade', 'weapon_1'].map((a) => where(scheme.map, 'default', a)),
    ).toEqual(['R.index_1', 'R.index_2', 'R.index_3', 'R.index_4', 'R.middle_1']);
  });

  it('uses taps only: no long press and no double tap', () => {
    const presses = Object.values(scheme.map['default'] ?? {}).flatMap((p) => Object.keys(p));
    expect([...new Set(presses)]).toEqual(['tap']);
  });
});

describe("the game's own keys layout rule", () => {
  it('puts the actions with no home in REST_ORDER, the required ones first', () => {
    const scheme = gameKeysPreset(
      gameOf([
        act('a', { key: key('J') }),
        act('b', { key: key('K') }, { required: true }),
        act('c', { key: key('L') }),
      ]),
    );
    expect(['b', 'a', 'c'].map((a) => where(scheme.map, 'default', a))).toEqual(
      REST_ORDER.slice(0, 3),
    );
  });

  it('gives a home to the first action the game ships on a control; the next goes to the rest', () => {
    const scheme = gameKeysPreset(
      gameOf([
        act('first', { key: key('J'), pad: 'A' }),
        act('second', { key: key('K'), pad: 'A' }),
      ]),
    );
    expect([where(scheme.map, 'default', 'first'), where(scheme.map, 'default', 'second')]).toEqual(
      ['L.index_3', REST_ORDER[0]],
    );
  });

  it('leaves off an action with no key, one on a scroll, and one whose key is taken in its mode', () => {
    const scheme = gameKeysPreset(
      gameOf([
        act('keyless', { pad: 'X' }),
        act('scroll', { key: { kind: 'scroll', dir: 'up', speed: 1 } }),
        act('one', { key: key('J') }),
        act('two', { key: key('J') }),
      ]),
    );
    expect(Object.values(scheme.map['default'] ?? {}).map((p) => p.tap)).toEqual(['one']);
  });

  it('sends a mouse button the game ships an action on, from a button', () => {
    const scheme = gameKeysPreset(
      gameOf([act('fire', { key: { kind: 'mouse', button: 'left' } })]),
    );
    const plan = resolve(
      scheme,
      gameOf([act('fire', { key: { kind: 'mouse', button: 'left' } })]),
      BUILT_IN_DEVICES,
    );
    expect(plan.bindings.map((b) => [b.control, b.signal])).toEqual([
      [REST_ORDER[0], { kind: 'mouse', button: 'left' }],
    ]);
  });

  it('puts one key on one button in every mode: the same key in another mode shares it', () => {
    const scheme = gameKeysPreset(
      gameOf(
        [
          act('ship_fire', { key: key('J') }, { mode: 'ship' }),
          act('foot_fire', { key: key('J') }, { mode: 'foot' }),
          act('foot_jump', { key: key('K') }, { mode: 'foot' }),
        ],
        ['ship', 'foot'],
      ),
    );
    expect([
      where(scheme.map, 'ship', 'ship_fire'),
      where(scheme.map, 'foot', 'foot_fire'),
      where(scheme.map, 'foot', 'foot_jump'),
    ]).toEqual([REST_ORDER[0], REST_ORDER[0], REST_ORDER[1]]);
  });

  it('never puts another mode’s action with a different key on a button: it sends one key', () => {
    const game = gameOf(
      [
        act('ship_fire', { key: key('J') }, { mode: 'ship' }),
        act('foot_jump', { key: key('K') }, { mode: 'foot' }),
      ],
      ['ship', 'foot'],
    );
    const plan = resolve(gameKeysPreset(game), game, BUILT_IN_DEVICES);
    expect({ findings: plan.findings, sheet: plan.bindSheet }).toEqual({ findings: [], sheet: [] });
  });

  it('moves the mouse with a stick the game ships no keys for', () => {
    const scheme = gameKeysPreset(gameOf([act('a', { key: key('J') })]));
    expect([scheme.behaviour['L.stick'], scheme.behaviour['R.stick']]).toEqual([
      { stick: { mode: 'mouse' } },
      { stick: { mode: 'mouse' } },
    ]);
  });

  it('leaves an action off when the buttons run out', () => {
    const many = Array.from({ length: 80 }, (_, i) => act(`a${i}`, { key: key(`F${i}`) }));
    const scheme = gameKeysPreset(gameOf(many));
    expect(Object.keys(scheme.map['default'] ?? {})).toHaveLength(REST_ORDER.length);
  });
});
