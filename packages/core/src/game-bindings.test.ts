// The game's bindings for a setup (GAME BINDINGS in resolve.ts), on Helldivers 2: what the plan
// says the game's controller and keyboard bindings must be, and the bind sheet rows that differ
// from what the game ships.

import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES } from './devices/index';
import { helldivers2 } from './games/helldivers2';
import type { Scheme, SetupDevices, Signal } from './model';
import { AZERONS_ONLY } from './model';
import type { GameBinding, Plan } from './plan';
import { gameKeysPreset } from './presets/keys';
import { xboxControllerPreset } from './presets/xbox';
import { bindingChanged, resolve } from './resolve';

const run = (scheme: Scheme): Plan => resolve(scheme, helldivers2, BUILT_IN_DEVICES);
const pad = (control: string): Signal => ({ kind: 'pad', control }) as Signal;
const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;
const devices = (over: Partial<SetupDevices>): SetupDevices => ({ ...AZERONS_ONLY, ...over });

/** Leaves the map as the preset made it. */
const keep = (map: Record<string, Record<string, string | undefined>>): void => {
  map['default'] = { ...map['default'] };
};

/** The preset with the default mode's map changed: `edit` gets a copy to change. */
function xbox(
  edit: (map: Record<string, Record<string, string | undefined>>) => void = keep,
  over: Partial<Scheme> = {},
): Scheme {
  const base = { ...xboxControllerPreset(helldivers2), ...over };
  const taps: Record<string, Record<string, string | undefined>> = {
    default: Object.fromEntries(
      Object.entries(base.map['default'] ?? {}).map(([control, presses]) => [control, presses.tap]),
    ),
  };
  edit(taps);
  const map: Scheme['map'] = {
    default: Object.fromEntries(
      Object.entries(taps['default'] ?? {}).flatMap(([control, action]) =>
        action === undefined ? [] : [[control, { tap: action }]],
      ),
    ),
  };
  return { ...base, map };
}

/** One action's binding in one set, as `[action, what it is on]` (null: on nothing). */
const on = (plan: Plan, set: GameBinding['set'], action: string) =>
  plan.gameBindings
    .filter((b) => b.set === set && b.action === action)
    .map((b) => (b.signal === null ? null : b.signal));

const rows = (plan: Plan) =>
  plan.bindSheet.map((b) => [b.set, b.action, b.signal === null ? null : b.signal]);

const errors = (plan: Plan) =>
  plan.findings.filter((f) => f.severity === 'error' && f.accepted === undefined);

describe('J1: the Xbox controller preset on Helldivers 2', () => {
  const plan = run(xboxControllerPreset(helldivers2));

  it('has no error to keep', () => {
    expect(errors(plan)).toEqual([]);
  });

  it('changes none of the game’s controller bindings, so there is nothing to set by hand', () => {
    expect([plan.bindSheet, plan.gameBindings.filter(bindingChanged)]).toEqual([[], []]);
  });

  it('rebinds the controller set only: the keyboard is not part of the setup', () => {
    expect([...new Set(plan.gameBindings.map((b) => b.set))]).toEqual(['controller']);
  });

  it('keeps the four moves on the left stick, which the left unit’s stick sends', () => {
    expect(
      ['move_forward', 'move_back', 'strafe_left', 'strafe_right'].map((a) =>
        on(plan, 'controller', a),
      ),
    ).toEqual([[pad('LS_UP')], [pad('LS_DOWN')], [pad('LS_LEFT')], [pad('LS_RIGHT')]]);
  });

  it('keeps the game’s own second uses of one button: Climb on A, Prone and Dive on B, Drop on the d-pad', () => {
    expect(['jump', 'prone', 'dive', 'drop'].map((a) => on(plan, 'controller', a))).toEqual([
      [pad('A')],
      [pad('B')],
      [pad('B')],
      [pad('DPAD_DOWN')],
    ]);
  });

  it('lists every action of the game once, in the game’s order', () => {
    expect(plan.gameBindings.map((b) => b.action)).toEqual(helldivers2.actions.map((a) => a.id));
  });

  it('leaves an action the game ships on no pad control on nothing, and that is no change', () => {
    expect([
      on(plan, 'controller', 'grenade'),
      plan.gameBindings.find((b) => b.action === 'grenade')?.native,
    ]).toEqual([[null], null]);
  });
});

describe('putting an action on an Azeron button sending an Xbox control rebinds the game', () => {
  // Left index 1 sends RB, where the game ships Ping. Reload (shipped on X) goes there.
  const plan = run(
    xbox((m) => {
      m['default'] = { ...m['default'], 'L.index_1': 'reload', 'L.middle_1': undefined };
    }),
  );

  it('binds Reload to the button’s Xbox control', () => {
    expect(on(plan, 'controller', 'reload')).toEqual([pad('RB')]);
  });

  it('takes Ping, displaced from RB, off it: RB does Reload and only Reload', () => {
    expect(on(plan, 'controller', 'ping')).toEqual([null]);
  });

  it('puts both changes on the bind sheet, and nothing else', () => {
    expect(rows(plan)).toEqual([
      ['controller', 'reload', pad('RB')],
      ['controller', 'ping', null],
    ]);
  });

  it('flags nothing: the game is told, so nothing is left to keep', () => {
    expect(plan.findings.map((f) => f.rule)).toEqual([]);
  });
});

describe('an action the game ships on no pad control', () => {
  it('gets the button’s Xbox control, with no finding', () => {
    const plan = run(
      xbox((m) => {
        m['default'] = { ...m['default'], 'L.middle_2': 'grenade' };
      }),
    );
    expect([on(plan, 'controller', 'grenade'), plan.findings]).toEqual([[pad('Y')], []]);
  });
});

describe('missing-required, with the game rebound to the setup', () => {
  it('counts Fire as missing once it is off every button, though a button still sends RT', () => {
    const plan = run(
      xbox((m) => {
        m['default'] = { ...m['default'], 'L.index_2': undefined };
      }),
    );
    expect([
      plan.units.left?.pins.find((p) => p.control === 'L.index_2')?.presses.tap,
      errors(plan).map((f) => [f.rule, f.action]),
    ]).toEqual([pad('RT'), [['missing-required', 'fire_primary']]]);
  });

  it('counts the moves as reached by the controller’s left stick, in a setup of the controller only', () => {
    const plan = run({
      ...xbox(keep),
      devices: devices({ azerons: 'none', controller: true }),
      map: { default: { 'pad.RT': { tap: 'fire_primary' }, 'pad.LB': { tap: 'stratagem' } } },
    });
    expect(errors(plan)).toEqual([]);
  });

  it('counts a required action on the right unit as missing when the setup uses the left one only', () => {
    const plan = run({
      ...xboxControllerPreset(helldivers2),
      devices: devices({ azerons: 'left' }),
      map: {
        default: { 'L.middle_3': { tap: 'stratagem' }, 'R.index_1': { tap: 'fire_primary' } },
      },
    });
    expect(
      errors(plan)
        .filter((f) => f.rule === 'missing-required')
        .map((f) => f.action),
    ).toEqual(['fire_primary']);
  });
});

describe('a setup of the controller only', () => {
  const scheme: Scheme = {
    ...xboxControllerPreset(helldivers2),
    devices: devices({ azerons: 'none', controller: true }),
    padMap: {},
    map: { default: { 'pad.RB': { tap: 'reload' } } },
  };
  const plan = run(scheme);

  it('writes no unit', () => {
    expect(plan.units).toEqual({});
  });

  it('binds Reload to RB, from the controller’s own button', () => {
    expect(on(plan, 'controller', 'reload')).toEqual([pad('RB')]);
  });

  it('takes an action off a controller button left empty: X is shown empty, so it does nothing', () => {
    // Nothing is on X; the game ships Reload there, but Reload is on RB now. Interact ships on A,
    // which carries nothing: it comes off, so A does nothing, as the editor shows.
    expect(on(plan, 'controller', 'interact')).toEqual([null]);
  });
});

describe('the controller and the Azerons as a controller share one controller set', () => {
  const both = devices({ controller: true });

  it('flags two actions on one Xbox control, one from the controller and one from a button', () => {
    const plan = run(
      xbox(
        (m) => {
          m['default'] = { ...m['default'], 'pad.RB': 'reload', 'L.middle_1': undefined };
        },
        { devices: both },
      ),
    );
    expect(plan.findings.filter((f) => f.rule === 'key-collision').map((f) => f.control)).toEqual([
      'L.index_1',
      'pad.RB',
    ]);
  });

  it('refuses one action on two Xbox controls: the game gives an action one button', () => {
    const plan = run(
      xbox(
        (m) => {
          m['default'] = { ...m['default'], 'pad.Y': 'reload' };
        },
        { devices: both },
      ),
    );
    expect(plan.findings.map((f) => [f.rule, f.control, f.severity])).toEqual([
      ['pad-bound-twice', 'pad.Y', 'error'],
    ]);
  });
});

describe('a stick keeps the actions it sends for', () => {
  it('refuses to move Move forward off the left stick onto a button', () => {
    const plan = run(
      xbox((m) => {
        m['default'] = { ...m['default'], 'L.middle_2': 'move_forward' };
      }),
    );
    expect([
      on(plan, 'controller', 'move_forward'),
      plan.findings.map((f) => [f.rule, f.control, f.message]),
    ]).toEqual([
      [pad('LS_UP')],
      [
        [
          'stick-key-rebind',
          'L.middle_2',
          'Move forward would move off Xbox LS_UP, which the left stick sends for it. Keep it on the stick.',
        ],
      ],
    ]);
  });
});

describe('the keyboard rebinds the game’s keyboard set', () => {
  const keyboard: Scheme = {
    ...gameKeysPreset(helldivers2),
    devices: devices({ azerons: 'none', keyboard: true }),
    map: { default: { 'key.G': { tap: 'reload' } } },
  };
  const plan = run(keyboard);

  it('binds Reload to G, and takes Throw grenade, displaced from G, off it', () => {
    expect([on(plan, 'keyboard', 'reload'), on(plan, 'keyboard', 'grenade')]).toEqual([
      [key('G')],
      [null],
    ]);
  });

  it('takes an action off a key the setup’s keyboard has and leaves empty', () => {
    expect(on(plan, 'keyboard', 'interact')).toEqual([null]);
  });

  it('keeps an action the game ships on a mouse button: the mouse is not part of this setup', () => {
    expect(on(plan, 'keyboard', 'fire_primary')).toEqual([{ kind: 'mouse', button: 'left' }]);
  });

  it('rebinds no controller binding', () => {
    expect(plan.gameBindings.filter((b) => b.set === 'controller')).toEqual([]);
  });
});

describe('the whole set, not only what differs from what the game ships', () => {
  it('says where every action is, so a setup applied after another can undo its changes', () => {
    // The first setup moved Reload to RB; the second is the preset as made. Its bind sheet is
    // empty against the game's shipped bindings, but the game holds the first setup's: only the
    // whole set says Reload goes back to X.
    const first = run(
      xbox((m) => {
        m['default'] = { ...m['default'], 'L.index_1': 'reload', 'L.middle_1': undefined };
      }),
    );
    const second = run(xboxControllerPreset(helldivers2));
    expect([
      on(first, 'controller', 'reload'),
      second.bindSheet,
      on(second, 'controller', 'reload'),
    ]).toEqual([[pad('RB')], [], [pad('X')]]);
  });
});

describe('the game’s file', () => {
  it('takes the bindings instead of a bind sheet when the setup writes it', () => {
    const game = { ...helldivers2, file: { format: 'unreal-ini' as const } };
    const scheme = {
      ...xbox((m) => {
        m['default'] = { ...m['default'], 'L.index_1': 'reload', 'L.middle_1': undefined };
      }),
      writeGameFile: true,
    };
    const plan = resolve(scheme, game, BUILT_IN_DEVICES);
    expect([
      plan.gameFile,
      plan.bindSheet,
      plan.gameBindings.filter(bindingChanged).length,
    ]).toEqual([{ format: 'unreal-ini' }, [], 2]);
  });
});

describe('the units of the setup', () => {
  it('are the left one only for the left Azeron and the mouse', () => {
    expect(Object.keys(run(xbox(keep, { devices: devices({ azerons: 'left' }) })).units)).toEqual([
      'left',
    ]);
  });

  it('are none for a setup without Azerons', () => {
    expect(
      run(xbox(keep, { devices: devices({ azerons: 'none', controller: true }) })).units,
    ).toEqual({});
  });
});

describe('mixed-input, for a setup', () => {
  it('warns once when the setup sends Xbox controls and mouse buttons: the left Azeron as a controller', () => {
    const plan = run(xbox(keep, { devices: devices({ azerons: 'left' }) }));
    expect(
      plan.findings.filter((f) => f.rule === 'mixed-input').map((f) => [f.control, f.severity]),
    ).toEqual([[undefined, 'warning']]);
  });

  it('says nothing for both Azerons as a controller', () => {
    expect(
      run(xboxControllerPreset(helldivers2)).findings.filter((f) => f.rule === 'mixed-input'),
    ).toEqual([]);
  });
});

describe('the keyboard and Azerons sending keys share the keyboard set', () => {
  // Throw grenade is on the keyboard's R, where the game ships Reload. Reload is on an Azeron button
  // with the game's own keys: its own key is taken, so the button gets one of the pool's.
  const plan = run({
    ...gameKeysPreset(helldivers2),
    devices: devices({ keyboard: true }),
    map: { default: { 'key.R': { tap: 'grenade' }, 'L.index_1': { tap: 'reload' } } },
  });

  it('gives the Azeron button a key of the pool, not the key the keyboard does something with', () => {
    expect([
      plan.units.left?.pins.find((p) => p.control === 'L.index_1')?.presses.tap,
      on(plan, 'keyboard', 'reload'),
    ]).toEqual([key('Insert'), [key('Insert')]]);
  });

  it('leaves no two actions on one key', () => {
    expect(plan.findings.filter((f) => f.rule === 'key-collision')).toEqual([]);
  });
});

describe('two actions resolved onto one live signal are a collision, from a stick or a button', () => {
  it('flags an action put on a button sending a direction the stick sends for another', () => {
    // Left middle 2 sends the left stick's up, which the game ships Move forward on; Reload is put
    // there. Both end up on LS_UP: pressing forward reloads.
    const plan = run({
      ...xboxControllerPreset(helldivers2),
      padMap: { ...xboxControllerPreset(helldivers2).padMap, 'L.middle_2': 'LS_UP' },
      map: {
        default: {
          ...xboxControllerPreset(helldivers2).map['default'],
          'L.middle_2': { tap: 'reload' },
          'L.middle_1': {},
        },
      },
    });
    expect(
      plan.findings
        .filter((f) => f.rule === 'key-collision')
        .map((f) => [f.control, f.severity, f.message]),
    ).toEqual([
      [
        'L.middle_2',
        'error',
        'In Default, Move forward and Reload are both on Xbox LS_UP: the game does them at once.',
      ],
    ]);
  });

  it('leaves the game’s own second uses of one control alone: Interact and Climb on A', () => {
    expect(
      run(xboxControllerPreset(helldivers2)).findings.filter((f) => f.rule === 'key-collision'),
    ).toEqual([]);
  });
});

describe('a stick sending W, A, S and D beside buttons sending Xbox controls', () => {
  const wasd = {
    up: key('W'),
    down: key('S'),
    left: key('A'),
    right: key('D'),
  };
  const plan = run({
    ...xboxControllerPreset(helldivers2),
    behaviour: {
      ...xboxControllerPreset(helldivers2).behaviour,
      'L.stick': { stick: { mode: 'keys', directions: wasd } },
    },
  });

  it('reaches the four moves on the keys the game ships them on: none is missing', () => {
    expect(plan.findings.filter((f) => f.rule === 'missing-required')).toEqual([]);
  });

  it('keeps the moves on those keys in the game’s keyboard set', () => {
    expect(
      ['move_forward', 'move_back', 'strafe_left', 'strafe_right'].map((a) =>
        on(plan, 'keyboard', a),
      ),
    ).toEqual([[key('W')], [key('S')], [key('A')], [key('D')]]);
  });

  it('warns of the mix once, on the stick', () => {
    expect(plan.findings.filter((f) => f.rule === 'mixed-input').map((f) => f.control)).toEqual([
      'L.stick',
    ]);
  });
});

describe('an Xbox stick beside buttons sending keys', () => {
  it('reaches the moves on the stick directions the game ships them on', () => {
    const plan = run({
      ...gameKeysPreset(helldivers2),
      behaviour: {
        'L.stick': { stick: { mode: 'pad-left' } },
        'R.stick': { stick: { mode: 'mouse' } },
      },
      map: { default: { 'L.index_1': { tap: 'fire_primary' }, 'L.index_2': { tap: 'stratagem' } } },
    });
    expect([
      plan.findings.filter((f) => f.rule === 'missing-required'),
      on(plan, 'controller', 'move_forward'),
    ]).toEqual([[], [pad('LS_UP')]]);
  });
});
