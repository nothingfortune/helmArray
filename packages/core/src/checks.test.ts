import { describe, expect, it } from 'vitest';
import { CHECK_RULES } from './checks';
import { BUILT_IN_DEVICES } from './devices/index';
import type { Game, Scheme, SetupDevices, Signal, StickDirections } from './model';
import { AZERONS_ONLY } from './model';
import type { Plan } from './plan';
import { KEY_POOL, formatCanName } from './pool';
import { gameKeysPreset } from './presets/keys';
import { xboxControllerPreset } from './presets/xbox';
import { resolve } from './resolve';

// A made-up game with two modes and a role of every kind, with keys and pad controls of its own.
const game: Game = {
  id: 'arena',
  name: 'Arena',
  modes: [
    { id: 'fight', name: 'Fighting' },
    { id: 'drive', name: 'Driving' },
  ],
  actions: [
    {
      id: 'fire',
      name: 'Fire',
      mode: 'fight',
      role: 'combat',
      required: true,
      native: { pad: 'RT' },
    },
    {
      id: 'boost',
      name: 'Boost',
      mode: 'fight',
      role: 'movement',
      required: true,
      native: { pad: 'A' },
    },
    {
      id: 'heal',
      name: 'Heal',
      mode: 'fight',
      role: 'ability',
      required: false,
      native: { pad: 'X' },
    },
    {
      id: 'pause',
      name: 'Pause',
      mode: 'fight',
      role: 'menu',
      required: false,
      native: { pad: 'START' },
    },
    {
      id: 'throttle',
      name: 'Throttle',
      mode: 'drive',
      role: 'travel',
      required: true,
      native: { pad: 'LS_UP' },
    },
    {
      id: 'horn',
      name: 'Horn',
      mode: 'drive',
      role: 'ability',
      required: false,
      native: { pad: 'B' },
    },
  ],
  file: { format: 'elite-binds' },
};

const WASD = {
  up: { kind: 'key', code: 'W' },
  down: { kind: 'key', code: 'S' },
  left: { kind: 'key', code: 'A' },
  right: { kind: 'key', code: 'D' },
} satisfies StickDirections;
/** Both sticks in key mode with their directions given, so no stick is found. */
const keyedSticks: Scheme['behaviour'] = {
  'L.stick': { stick: { mode: 'keys', directions: WASD } },
  'R.stick': { stick: { mode: 'keys', directions: WASD } },
};

/** A key scheme with every required action placed, so only what a test adds is found. */
/** Both Azerons and the named fixed devices. */
const withDevices = (over: Partial<SetupDevices>): SetupDevices => ({ ...AZERONS_ONLY, ...over });

function keys(over: Partial<Scheme> = {}, map: Scheme['map'] = {}): Scheme {
  return {
    ...gameKeysPreset(game),
    writeGameFile: true,
    ...over,
    behaviour: { ...keyedSticks, ...over.behaviour },
    map: {
      fight: { 'L.index_1': { tap: 'fire' }, 'L.index_2': { tap: 'boost' }, ...map['fight'] },
      drive: { 'L.middle_1': { tap: 'throttle' }, ...map['drive'] },
    },
  };
}

const run = (scheme: Scheme, g: Game = game): Plan => resolve(scheme, g, BUILT_IN_DEVICES);
const found = (plan: Plan, rule: string) => plan.findings.filter((f) => f.rule === rule);
const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;

describe('the checks', () => {
  it('find nothing in a scheme with every required action on its own button', () => {
    expect(run(keys()).findings).toEqual([]);
  });

  it('come in a fixed order: by rule, then mode, then device', () => {
    const plan = run(
      keys(
        { behaviour: { 'L.index_2': { latch: true } } },
        { fight: { 'L.index_1': { tap: 'fire', long: 'pause' } } },
      ),
    );
    expect(plan.findings.map((f) => f.rule)).toEqual([
      'menu-with-combat',
      'combat-tap-delayed',
      'hold-on-movement',
    ]);
    expect(CHECK_RULES.indexOf('menu-with-combat')).toBeLessThan(
      CHECK_RULES.indexOf('combat-tap-delayed'),
    );
  });
});

describe('key-collision: two actions live at once on the same key', () => {
  const ledger = { 'L.index_3': { tap: key('Insert') }, 'L.index_4': { tap: key('Insert') } };

  it('is an error on each button, in the mode where both are live', () => {
    const plan = run(
      keys({ ledger }, { fight: { 'L.index_3': { tap: 'heal' }, 'L.index_4': { tap: 'pause' } } }),
    );
    expect(found(plan, 'key-collision')).toEqual([
      expect.objectContaining({ severity: 'error', control: 'L.index_3', mode: 'fight' }),
      expect.objectContaining({ severity: 'error', control: 'L.index_4', mode: 'fight' }),
    ]);
    expect(found(plan, 'key-collision')[0]?.message).toBe(
      'In Fighting, Heal and Pause are both on Insert: the game does them at once.',
    );
  });

  it('passes when the two are in different modes, which are never live together', () => {
    const plan = run(
      keys(
        { ledger },
        { fight: { 'L.index_3': { tap: 'heal' } }, drive: { 'L.index_4': { tap: 'horn' } } },
      ),
    );
    expect(found(plan, 'key-collision')).toEqual([]);
  });

  it('counts a key on the keyboard or mouse the scheme maps', () => {
    const plan = run(
      keys(
        {
          devices: withDevices({ mouse: true }),
          ledger: { 'L.index_3': { tap: { kind: 'mouse', button: 'left' } } },
        },
        { fight: { 'L.index_3': { tap: 'heal' }, 'mouse.left': { tap: 'pause' } } },
      ),
    );
    expect(found(plan, 'key-collision').map((f) => f.control)).toEqual(['L.index_3', 'mouse.left']);
  });

  it('is an error when two buttons send the same Xbox control for different actions', () => {
    const pad = xboxControllerPreset(game);
    pad.padMap['L.index_4'] = 'A';
    pad.map['fight'] = { ...pad.map['fight'], 'L.index_4': { tap: 'heal' } };
    expect(found(run(pad), 'key-collision').map((f) => f.control)).toEqual([
      'L.index_3',
      'L.index_4',
    ]);
    expect(found(run(xboxControllerPreset(game)), 'key-collision')).toEqual([]);
  });
});

describe('sends-nothing: a button whose action sends nothing', () => {
  it('is an error for a long press under Xbox output, which only taps', () => {
    const pad = xboxControllerPreset(game);
    pad.map['fight'] = { ...pad.map['fight'], 'L.index_3': { tap: 'boost', long: 'heal' } };
    expect(found(run(pad), 'sends-nothing')).toEqual([
      expect.objectContaining({ severity: 'error', control: 'L.index_3', mode: 'fight' }),
    ]);
  });

  it('is an error for a button with no Xbox control', () => {
    const pad = xboxControllerPreset(game);
    pad.map['fight'] = { ...pad.map['fight'], 'R.index_1': { tap: 'heal' } };
    expect(found(run(pad), 'sends-nothing').map((f) => f.control)).toEqual(['R.index_1']);
  });

  it('is an error for a control no device has, and a long press on a keyboard key', () => {
    const plan = run(
      keys({}, { fight: { 'L.nowhere': { tap: 'heal' }, 'key.W': { long: 'pause' } } }),
    );
    expect(found(plan, 'sends-nothing').map((f) => f.control)).toEqual(['key.W', 'L.nowhere']);
  });

  it("is an error for a long press or double tap on the pad's triggers and the sticks", () => {
    const plan = run(
      keys(
        { devices: withDevices({ controller: true }) },
        {
          fight: { 'pad.RT': { long: 'heal' }, 'L.stick': { double: 'pause' } },
          drive: { 'pad.LT': { tap: 'horn' } },
        },
      ),
    );
    expect(found(plan, 'sends-nothing').map((f) => [f.mode, f.control])).toEqual([
      ['fight', 'L.stick'],
      ['fight', 'pad.RT'],
    ]);
  });

  it('passes for actions on taps of buttons that send something', () => {
    expect(found(run(xboxControllerPreset(game)), 'sends-nothing')).toEqual([]);
    expect(
      found(
        run(
          keys(
            { devices: withDevices({ keyboard: true }) },
            { fight: { 'key.W': { tap: 'heal' } } },
          ),
        ),
        'sends-nothing',
      ),
    ).toEqual([]);
  });

  it("is an error for an action on a control of a device the setup doesn't use", () => {
    const plan = run(keys({}, { fight: { 'key.W': { tap: 'heal' }, 'pad.A': { tap: 'pause' } } }));
    expect(found(plan, 'sends-nothing').map((f) => [f.control, f.message])).toEqual([
      ['key.W', "Heal is on a control this setup doesn't use, so pressing it does nothing."],
      ['pad.A', "Pause is on a control this setup doesn't use, so pressing it does nothing."],
    ]);
  });

  it('is an error for an action on the right unit when the setup uses the left one only', () => {
    const plan = run(
      keys(
        { devices: withDevices({ azerons: 'left' }) },
        { fight: { 'R.index_1': { tap: 'heal' } } },
      ),
    );
    expect(found(plan, 'sends-nothing').map((f) => f.control)).toEqual(['R.index_1']);
  });

  it('leaves a button the resolver already reported to the resolver', () => {
    // Every key the file can name is given out, so the three mapped buttons get none.
    const spent = Object.fromEntries(
      KEY_POOL.filter((k) => formatCanName('elite-binds', k)).map((k, i) => [
        `R.x${i}`,
        { tap: key(k) },
      ]),
    );
    const plan = run(keys({ ledger: spent }));
    expect(found(plan, 'pool-spent').map((f) => f.control)).toEqual([
      'L.middle_1',
      'L.index_1',
      'L.index_2',
    ]);
    expect(found(plan, 'sends-nothing')).toEqual([]);
  });
});

describe('missing-required: a required action on no button', () => {
  it('is an error naming the action and its mode', () => {
    const scheme = keys();
    delete scheme.map['fight']?.['L.index_2'];
    expect(found(run(scheme), 'missing-required')).toEqual([
      {
        rule: 'missing-required',
        severity: 'error',
        action: 'boost',
        mode: 'fight',
        message: 'Boost is needed to play Fighting, and it is on no button.',
      },
    ]);
  });

  it('passes for an Xbox action the stick sends, though no button carries it', () => {
    expect(found(run(xboxControllerPreset(game)), 'missing-required')).toEqual([]);
  });

  it('is an error for that action once the stick no longer sends Xbox', () => {
    const pad = xboxControllerPreset(game);
    pad.behaviour['L.stick'] = { stick: { mode: 'keys' } };
    expect(found(run(pad), 'missing-required').map((f) => f.action)).toEqual(['throttle']);
  });
});

describe('menu-with-combat: a menu action on a combat button you mash', () => {
  it('is an error when they share a button in one mode', () => {
    const plan = run(keys({}, { fight: { 'L.index_1': { tap: 'fire', double: 'pause' } } }));
    expect(found(plan, 'menu-with-combat')).toEqual([
      expect.objectContaining({ severity: 'error', control: 'L.index_1', mode: 'fight' }),
    ]);
  });

  it('passes when the menu action is on that button in another mode', () => {
    const scheme = keys();
    scheme.map['drive'] = { ...scheme.map['drive'], 'L.index_1': { tap: 'horn' } };
    const plan = run(keys({}, { fight: { 'L.index_3': { tap: 'heal', long: 'pause' } } }));
    expect(found(run(scheme), 'menu-with-combat')).toEqual([]);
    expect(found(plan, 'menu-with-combat')).toEqual([]);
  });
});

describe('combat-tap-delayed: a long press or double tap on a combat button', () => {
  it('is a warning on a button with a combat tap and a long press', () => {
    const plan = run(keys({}, { fight: { 'L.index_1': { tap: 'fire', long: 'heal' } } }));
    expect(found(plan, 'combat-tap-delayed')).toEqual([
      expect.objectContaining({ severity: 'warning', control: 'L.index_1' }),
    ]);
  });

  it('is a warning when the long press is in another mode: the unit holds one per button', () => {
    const plan = run(keys({}, { drive: { 'L.index_2': { double: 'horn' } } }));
    expect(found(plan, 'combat-tap-delayed').map((f) => f.control)).toEqual(['L.index_2']);
  });

  it('passes for a long press on a button with no combat or movement action', () => {
    const plan = run(keys({}, { fight: { 'L.index_3': { tap: 'heal', long: 'pause' } } }));
    expect(found(plan, 'combat-tap-delayed')).toEqual([]);
  });
});

describe('hold-on-movement: hold-to-latch on movement or boost', () => {
  it('is a warning on a latched button that moves you', () => {
    const plan = run(keys({ behaviour: { 'L.index_2': { latch: true } } }));
    expect(found(plan, 'hold-on-movement')).toEqual([
      expect.objectContaining({ severity: 'warning', control: 'L.index_2' }),
    ]);
  });

  it('passes for a latch on anything else', () => {
    const plan = run(
      keys(
        { behaviour: { 'L.index_3': { latch: true } } },
        { fight: { 'L.index_3': { tap: 'heal' } } },
      ),
    );
    expect(found(plan, 'hold-on-movement')).toEqual([]);
  });
});

describe('mixed-input: Xbox output and keys in one scheme', () => {
  it('is a warning on a stick sending keys or the mouse while the buttons are a pad', () => {
    const pad = xboxControllerPreset(game);
    pad.behaviour['R.stick'] = { stick: { mode: 'mouse' } };
    expect(found(run(pad), 'mixed-input')).toEqual([
      expect.objectContaining({ severity: 'warning', control: 'R.stick' }),
    ]);
  });

  it('is a warning on a pad stick while the buttons send keys', () => {
    const plan = run(keys({ behaviour: { 'L.stick': { stick: { mode: 'pad-left' } } } }));
    expect(found(plan, 'mixed-input').map((f) => f.control)).toEqual(['L.stick']);
  });

  it('passes when the sticks match the buttons', () => {
    expect(found(run(xboxControllerPreset(game)), 'mixed-input')).toEqual([]);
    expect(found(run(keys()), 'mixed-input')).toEqual([]);
  });
});

describe('stick-not-keyboard: the stick not sending keys, for a game that needs it', () => {
  const picky: Game = { ...game, needsKeyStick: true };

  it('is an error on each stick that is not in key mode', () => {
    const scheme = {
      ...keys({ behaviour: { 'R.stick': { stick: { mode: 'mouse' } } } }),
      gameId: picky.id,
    };
    expect(found(run(scheme, picky), 'stick-not-keyboard')).toEqual([
      expect.objectContaining({ severity: 'error', control: 'R.stick' }),
    ]);
  });

  it('passes with both sticks sending keys, and for a game that never asked', () => {
    expect(found(run(keys(), picky), 'stick-not-keyboard')).toEqual([]);
    expect(found(run(xboxControllerPreset(game)), 'stick-not-keyboard')).toEqual([]);
  });
});

describe('stick-no-directions: a key-mode stick with no direction keys sends nothing', () => {
  const keyStick = (directions?: StickDirections): Scheme['behaviour'] => ({
    'L.stick': { stick: { mode: 'keys', ...(directions ? { directions } : {}) } },
  });

  it('is an error on a stick set to keys with no directions at all', () => {
    const plan = run(keys({ behaviour: keyStick() }));
    expect(found(plan, 'stick-no-directions')).toEqual([
      expect.objectContaining({
        severity: 'error',
        control: 'L.stick',
        message:
          'The left stick sends nothing: give its directions keys or set it to a controller stick.',
      }),
    ]);
  });

  it('is an error when the directions are an empty set', () => {
    const plan = run(keys({ behaviour: keyStick({}) }));
    expect(found(plan, 'stick-no-directions').map((f) => f.control)).toEqual(['L.stick']);
  });

  it('is an error on a unit left on its default, which is keys with none given', () => {
    const plan = run({ ...keys(), behaviour: {} });
    expect(found(plan, 'stick-no-directions').map((f) => f.control)).toEqual([
      'L.stick',
      'R.stick',
    ]);
  });

  it('passes when at least one direction has a key', () => {
    const plan = run(keys({ behaviour: keyStick({ up: key('W') }) }));
    expect(found(plan, 'stick-no-directions')).toEqual([]);
  });

  it('passes with all four directions, and for a stick that is not in key mode', () => {
    expect(found(run(keys()), 'stick-no-directions')).toEqual([]);
    expect(found(run(xboxControllerPreset(game)), 'stick-no-directions')).toEqual([]);
    const mouse = keys({ behaviour: { 'R.stick': { stick: { mode: 'mouse' } } } });
    expect(found(run(mouse), 'stick-no-directions').map((f) => f.control)).toEqual([]);
  });
});

describe('accepting a finding', () => {
  const clash = { fight: { 'L.index_1': { tap: 'fire', long: 'heal' } } };

  it('keeps it in the list, with the reason', () => {
    const plan = run(
      keys(
        {
          accepted: [
            { rule: 'combat-tap-delayed', control: 'L.index_1', reason: 'I hold to heal' },
          ],
        },
        clash,
      ),
    );
    expect(found(plan, 'combat-tap-delayed')).toEqual([
      expect.objectContaining({ control: 'L.index_1', accepted: 'I hold to heal' }),
    ]);
  });

  it('is for that rule on that control only', () => {
    const plan = run(
      keys(
        { accepted: [{ rule: 'combat-tap-delayed', control: 'L.index_2', reason: 'no' }] },
        clash,
      ),
    );
    expect(found(plan, 'combat-tap-delayed')[0]?.accepted).toBeUndefined();
  });

  it('names the action for a required action on no button', () => {
    const scheme = keys({
      accepted: [{ rule: 'missing-required', action: 'boost', reason: 'auto-boost' }],
    });
    delete scheme.map['fight']?.['L.index_2'];
    expect(found(run(scheme), 'missing-required')[0]?.accepted).toBe('auto-boost');
  });

  it("can't accept what the resolver found: a key that can't be written stays a plain error", () => {
    const plan = run(
      keys({
        ledger: { 'L.index_1': { tap: key('F13') } },
        accepted: [{ rule: 'key-unnamable', control: 'L.index_1', reason: 'fine' }],
      }),
    );
    expect(found(plan, 'key-unnamable')[0]?.accepted).toBeUndefined();
  });
});
