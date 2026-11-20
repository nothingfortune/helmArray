import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES } from './devices/index';
import { helldivers2 } from './games/helldivers2';
import type { Game, Scheme, Signal, StickDirections } from './model';
import { AZERONS_ONLY } from './model';
import type { Plan } from './plan';
import { gameKeysPreset } from './presets/keys';
import { xboxControllerPreset } from './presets/xbox';
import { resolve } from './resolve';

// The rules for stick direction keys are written in resolve.ts (STICK DIRECTION KEYS). Each
// test here names the rule it holds to.

const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;
const WASD: StickDirections = {
  up: key('W'),
  down: key('S'),
  left: key('A'),
  right: key('D'),
};
const keysStick = (directions: StickDirections): Scheme['behaviour'][string] => ({
  stick: { mode: 'keys', directions },
});

// A made-up game with two modes and a writable file: Boost is Tab and Map is M in the ship,
// Sprint is Left Shift on foot.
const skiff: Game = {
  id: 'skiff',
  name: 'Skiff',
  modes: [
    { id: 'ship', name: 'Ship' },
    { id: 'foot', name: 'On foot' },
  ],
  actions: [
    {
      id: 'boost',
      name: 'Boost',
      mode: 'ship',
      role: 'movement',
      required: false,
      native: { key: key('Tab') },
    },
    {
      id: 'map',
      name: 'Galaxy map',
      mode: 'ship',
      role: 'menu',
      required: false,
      native: { key: key('M') },
    },
    {
      id: 'sprint',
      name: 'Sprint',
      mode: 'foot',
      role: 'movement',
      required: false,
      native: { key: key('LShift') },
    },
  ],
  file: { format: 'elite-binds' },
};

type Over = Partial<Scheme>;
function ownKeys(game: Game, over: Over = {}): Scheme {
  return { ...gameKeysPreset(game), ...over };
}
function fileWritten(game: Game, over: Over = {}): Scheme {
  return { ...gameKeysPreset(game), writeGameFile: true, ...over };
}
const run = (scheme: Scheme, game: Game) => resolve(scheme, game, BUILT_IN_DEVICES);
const sent = (plan: Plan, control: string) =>
  [...(plan.units.left?.pins ?? []), ...(plan.units.right?.pins ?? [])].find(
    (p) => p.control === control,
  )?.presses.tap;
const found = (plan: Plan, rule: string) => plan.findings.filter((f) => f.rule === rule);
const bothSticks = { 'L.stick': keysStick(WASD), 'R.stick': keysStick(WASD) };

describe('stick keys, rule 3: one action on a button and a stick is allowed', () => {
  it('lets a button keep the game key the stick sends for the same action, with no bind sheet row', () => {
    const plan = run(
      ownKeys(helldivers2, {
        behaviour: { 'L.stick': keysStick(WASD) },
        map: { default: { 'L.index_1': { tap: 'move_forward' } } },
      }),
      helldivers2,
    );
    expect(sent(plan, 'L.index_1')).toEqual(key('W'));
    expect(plan.bindSheet).toEqual([]);
    expect(found(plan, 'key-collision')).toEqual([]);
    expect(found(plan, 'stick-key-rebind')).toEqual([]);
    expect(plan.ledger['L.index_1']).toEqual({ tap: key('W') });
  });

  it('does the same with the game file written, when the file can name the key', () => {
    const plan = run(
      fileWritten(skiff, {
        behaviour: { 'L.stick': keysStick({ ...WASD, up: key('Tab') }) },
        map: { ship: { 'L.index_1': { tap: 'boost' } } },
      }),
      skiff,
    );
    expect(sent(plan, 'L.index_1')).toEqual(key('Tab'));
    expect(found(plan, 'key-collision')).toEqual([]);
    expect(found(plan, 'stick-key-rebind')).toEqual([]);
  });

  it('still deals a pool key, with the file written, when no stick sends the action key', () => {
    const plan = run(
      fileWritten(skiff, { map: { ship: { 'L.index_1': { tap: 'boost' } } } }),
      skiff,
    );
    expect(sent(plan, 'L.index_1')).toEqual(key('Insert'));
  });
});

describe('stick keys, rule 4: different actions on one key collide', () => {
  const clash = (map: Scheme['map'], ledger: Scheme['ledger'], keyboard = false) =>
    found(
      run(
        fileWritten(skiff, {
          devices: { ...AZERONS_ONLY, keyboard },
          behaviour: { 'L.stick': keysStick({ ...WASD, up: key('Tab') }) },
          ledger,
          map,
        }),
        skiff,
      ),
      'key-collision',
    );

  it('is an error on the stick when a button carries another action on the key', () => {
    expect(
      clash({ ship: { 'L.index_1': { tap: 'map' } } }, { 'L.index_1': { tap: key('Tab') } }),
    ).toEqual([expect.objectContaining({ severity: 'error', control: 'L.stick', mode: 'ship' })]);
  });

  it('is an error when a keyboard key sends it for another action', () => {
    expect(clash({ ship: { 'key.Tab': { tap: 'map' } } }, {}, true)).toEqual([
      expect.objectContaining({ control: 'L.stick', mode: 'ship' }),
    ]);
  });

  it('is judged in each mode: a ledger key held for the same action in one mode and another in the next', () => {
    const findings = clash(
      { ship: { 'L.index_1': { tap: 'boost' } }, foot: { 'L.index_1': { tap: 'sprint' } } },
      { 'L.index_1': { tap: key('Tab') } },
    );
    expect(findings.map((f) => f.mode)).toEqual(['foot']);
  });
});

describe('stick keys, rule 2: the pool never deals a stick key', () => {
  it('skips the keys of both sticks when both are in key mode', () => {
    const plan = run(
      fileWritten(skiff, {
        behaviour: {
          'L.stick': keysStick({ ...WASD, up: key('Insert') }),
          'R.stick': keysStick({ ...WASD, up: key('Home') }),
        },
        map: {
          ship: {
            'L.index_1': { tap: 'boost' },
            'L.index_2': { tap: 'map' },
          },
          foot: { 'L.index_3': { tap: 'sprint' } },
        },
      }),
      skiff,
    );
    expect(sent(plan, 'L.index_1')).toEqual(key('PageUp'));
    expect(sent(plan, 'L.index_2')).toEqual(key('Del'));
    expect(sent(plan, 'L.index_3')).toEqual(key('End'));
  });

  it('lets two sticks send the same key without it counting as a collision', () => {
    const plan = run(
      fileWritten(skiff, { behaviour: bothSticks, map: { ship: { 'L.index_1': { tap: 'map' } } } }),
      skiff,
    );
    expect(found(plan, 'key-collision')).toEqual([]);
    expect(found(plan, 'stick-no-directions')).toEqual([]);
  });
});

describe('stick keys, rule 1: a stick not in key mode sends nothing', () => {
  const padStick: Scheme['behaviour'] = {
    'L.stick': { stick: { mode: 'pad-left', directions: { ...WASD, up: key('Insert') } } },
  };

  it('reserves no key and drops the directions from the plan', () => {
    const plan = run(
      fileWritten(skiff, { behaviour: padStick, map: { ship: { 'L.index_1': { tap: 'map' } } } }),
      skiff,
    );
    expect(sent(plan, 'L.index_1')).toEqual(key('Insert'));
    expect(plan.units.left?.stick.mode).toBe('pad-left');
    expect(plan.units.left?.stick).not.toHaveProperty('directions');
  });

  it('is not collided: its old directions clash with nothing', () => {
    const plan = run(
      fileWritten(skiff, {
        behaviour: {
          'L.stick': { stick: { mode: 'pad-left', directions: { ...WASD, up: key('Tab') } } },
        },
        ledger: { 'L.index_1': { tap: key('Tab') } },
        map: { ship: { 'L.index_1': { tap: 'map' } } },
      }),
      skiff,
    );
    expect(found(plan, 'key-collision')).toEqual([]);
  });

  it('does not count towards required actions', () => {
    const scheme = ownKeys(helldivers2, {
      behaviour: { 'L.stick': { stick: { mode: 'pad-left', directions: WASD } } },
      map: { default: { 'L.index_1': { tap: 'fire_primary' }, 'L.index_2': { tap: 'stratagem' } } },
    });
    const missing = found(run(scheme, helldivers2), 'missing-required').map((f) => f.action);
    expect(missing).toEqual(['move_forward', 'move_back', 'strafe_left', 'strafe_right']);
  });
});

describe('stick keys, rule 5: nothing moves an action off a key the stick sends', () => {
  const left = { 'L.stick': keysStick(WASD) };

  it('says so, and writes no bind sheet row, when a second button carries the action', () => {
    const plan = run(
      ownKeys(helldivers2, {
        behaviour: left,
        map: {
          default: {
            'L.index_1': { tap: 'move_forward' },
            'L.index_2': { tap: 'move_forward' },
          },
        },
      }),
      helldivers2,
    );
    expect(sent(plan, 'L.index_1')).toEqual(key('W'));
    expect(found(plan, 'stick-key-rebind')).toEqual([
      expect.objectContaining({ severity: 'error', control: 'L.index_2', mode: 'default' }),
    ]);
    expect(plan.bindSheet.filter((r) => r.action === 'move_forward')).toEqual([]);
  });

  it('says so when a button already holds another key for the action', () => {
    const plan = run(
      ownKeys(helldivers2, {
        behaviour: left,
        ledger: { 'L.index_1': { tap: key('Insert') } },
        map: { default: { 'L.index_1': { tap: 'move_forward' } } },
      }),
      helldivers2,
    );
    expect(found(plan, 'stick-key-rebind').map((f) => f.control)).toEqual(['L.index_1']);
    expect(plan.bindSheet).toEqual([]);
  });

  it('still asks for a bind sheet row for an action no stick relies on', () => {
    const plan = run(
      ownKeys(helldivers2, {
        behaviour: left,
        ledger: { 'L.index_1': { tap: key('Insert') } },
        map: { default: { 'L.index_1': { tap: 'sprint' } } },
      }),
      helldivers2,
    );
    expect(plan.bindSheet).toEqual([
      {
        set: 'keyboard',
        mode: 'default',
        action: 'sprint',
        signal: key('Insert'),
        native: key('LShift'),
      },
    ]);
  });

  it('says so with the game file written too', () => {
    const plan = run(
      fileWritten(skiff, {
        behaviour: { 'L.stick': keysStick({ ...WASD, up: key('Tab') }) },
        ledger: { 'L.index_1': { tap: key('Insert') } },
        map: { ship: { 'L.index_1': { tap: 'boost' } } },
      }),
      skiff,
    );
    expect(found(plan, 'stick-key-rebind')).toHaveLength(1);
  });
});

describe('stick keys, rule 7: the ledger holds button keys only', () => {
  it('has nothing for a stick with no button placed', () => {
    const plan = run(ownKeys(helldivers2, { behaviour: bothSticks }), helldivers2);
    expect(plan.ledger).toEqual({});
  });
});

describe('stick keys and the presets', () => {
  it('the Xbox controller preset has pad sticks and no directions, so no stick key is reserved or checked', () => {
    const plan = run(xboxControllerPreset(helldivers2), helldivers2);
    for (const unit of [plan.units.left, plan.units.right]) {
      expect(unit?.stick).not.toHaveProperty('directions');
    }
    expect(found(plan, 'stick-no-directions')).toEqual([]);
    expect(found(plan, 'stick-key-rebind')).toEqual([]);
  });

  it("the game's own keys preset leaves the sticks' directions to the player", () => {
    const scheme = gameKeysPreset(helldivers2);
    expect(scheme.behaviour).toEqual({});
    expect(found(run(scheme, helldivers2), 'stick-no-directions')).toHaveLength(2);
  });
});
