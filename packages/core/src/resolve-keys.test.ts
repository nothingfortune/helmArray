import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES } from './devices/index';
import type { Game, Scheme, Signal, StickDirections } from './model';
import type { Plan } from './plan';
import { KEY_POOL, formatCanName } from './pool';
import { copyScheme, gameKeysPreset } from './presets/keys';
import { resolve } from './resolve';
import { CHECK_RULES } from './checks';

// A made-up game with a writable file and two modes, like Elite's ship and on foot.
const game: Game = {
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
      required: true,
      native: { key: { kind: 'key', code: 'Tab' } },
    },
    {
      id: 'fire',
      name: 'Fire',
      mode: 'ship',
      role: 'combat',
      required: true,
      native: { key: { kind: 'mouse', button: 'left' } },
    },
    {
      id: 'map',
      name: 'Galaxy map',
      mode: 'ship',
      role: 'menu',
      required: false,
      native: { key: { kind: 'key', code: 'M' } },
    },
    {
      id: 'sprint',
      name: 'Sprint',
      mode: 'foot',
      role: 'movement',
      required: true,
      native: { key: { kind: 'key', code: 'LShift' } },
    },
    {
      id: 'shoot',
      name: 'Shoot',
      mode: 'foot',
      role: 'combat',
      required: true,
      native: { key: { kind: 'mouse', button: 'left' } },
    },
    { id: 'emote', name: 'Emote', mode: 'foot', role: 'menu', required: false },
    {
      id: 'zoom',
      name: 'Zoom',
      mode: 'ship',
      role: 'ability',
      required: false,
      native: { key: { kind: 'scroll', dir: 'up', speed: 33 } },
    },
  ],
  file: { format: 'elite-binds' },
};

// Key sticks with their directions given, so the stick checks stay quiet here.
const wasd = {
  up: { kind: 'key', code: 'W' },
  down: { kind: 'key', code: 'S' },
  left: { kind: 'key', code: 'A' },
  right: { kind: 'key', code: 'D' },
} satisfies StickDirections;
const keyedSticks: Scheme['behaviour'] = {
  'L.stick': { stick: { mode: 'keys', directions: wasd } },
  'R.stick': { stick: { mode: 'keys', directions: wasd } },
};

function scheme(over: Partial<Scheme> = {}): Scheme {
  return {
    ...gameKeysPreset(game),
    writeGameFile: true,
    ...over,
    behaviour: { ...keyedSticks, ...over.behaviour },
  };
}

const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;
// The resolver's own findings, without the checks' (checks.test.ts covers those).
const resolverFindings = (plan: Plan) =>
  plan.findings.filter((f) => !(CHECK_RULES as readonly string[]).includes(f.rule));
const sent = (plan: Plan, control: string) =>
  [...(plan.units.left?.pins ?? []), ...(plan.units.right?.pins ?? [])].find(
    (p) => p.control === control,
  )?.presses;

describe('keys, game file written', () => {
  const s = scheme({
    map: {
      ship: { 'L.index_1': { tap: 'boost' }, 'L.middle_1': { tap: 'fire', long: 'map' } },
      foot: { 'L.index_1': { tap: 'sprint' }, 'R.index_1': { tap: 'shoot' } },
    },
  });
  const plan = resolve(s, game, BUILT_IN_DEVICES);

  it('deals pool keys in device order: left before right, middle before index, tap before long', () => {
    expect(sent(plan, 'L.middle_1')).toEqual({ tap: key('Insert'), long: key('Home') });
    expect(sent(plan, 'L.index_1')).toEqual({ tap: key('PageUp') });
    expect(sent(plan, 'R.index_1')).toEqual({ tap: key('Del') });
  });

  it('gives a button one key for every mode, and binds it in each', () => {
    expect(
      plan.bindings
        .filter((b) => b.control === 'L.index_1')
        .map((b) => [b.mode, b.action, b.signal]),
    ).toEqual([
      ['ship', 'boost', key('PageUp')],
      ['foot', 'sprint', key('PageUp')],
    ]);
  });

  it('says the game file is written, and needs no bind sheet', () => {
    expect(plan.gameFile).toEqual({ format: 'elite-binds' });
    expect(plan.bindSheet).toEqual([]);
  });

  it('records every key it gave in the ledger', () => {
    expect(plan.ledger).toEqual({
      'L.middle_1': { tap: key('Insert'), long: key('Home') },
      'L.index_1': { tap: key('PageUp') },
      'R.index_1': { tap: key('Del') },
    });
  });

  it('matches the golden plan byte for byte', async () => {
    await expect(`${JSON.stringify(plan, null, 2)}\n`).toMatchFileSnapshot(
      './__golden__/skiff-keys.plan.json',
    );
  });
});

describe('stick directions', () => {
  const stickUp = (code: string): Scheme['behaviour'] => ({
    ...keyedSticks,
    'L.stick': { stick: { mode: 'keys', directions: { ...wasd, up: key(code) } } },
  });

  it('keep their keys out of the pool: a button is never dealt a key a direction sends', () => {
    const plan = resolve(
      scheme({
        behaviour: stickUp('Insert'),
        map: { ship: { 'L.index_1': { tap: 'boost' }, 'L.index_2': { tap: 'map' } } },
      }),
      game,
      BUILT_IN_DEVICES,
    );
    // Insert is the pool's first key, and the left stick's up direction already sends it.
    expect(sent(plan, 'L.index_1')).toEqual({ tap: key('Home') });
    expect(sent(plan, 'L.index_2')).toEqual({ tap: key('PageUp') });
    expect(plan.findings.filter((f) => f.rule === 'key-collision')).toEqual([]);
  });

  it('keep the right stick keys out of the pool too, and only while the stick is in key mode', () => {
    const rightUp = {
      ...keyedSticks,
      'R.stick': { stick: { mode: 'keys', directions: { ...wasd, up: key('Insert') } } },
    } satisfies Scheme['behaviour'];
    const map = { ship: { 'L.index_1': { tap: 'boost' } } };
    const right = resolve(scheme({ behaviour: rightUp, map }), game, BUILT_IN_DEVICES);
    expect(sent(right, 'L.index_1')).toEqual({ tap: key('Home') });
    const mouse = {
      ...rightUp,
      'R.stick': { stick: { mode: 'mouse' } },
    } satisfies Scheme['behaviour'];
    const free = resolve(scheme({ behaviour: mouse, map }), game, BUILT_IN_DEVICES);
    expect(sent(free, 'L.index_1')).toEqual({ tap: key('Insert') });
  });

  it('are reported when a key a button already holds is also a direction', () => {
    const plan = resolve(
      scheme({
        behaviour: stickUp('Insert'),
        ledger: { 'L.index_1': { tap: key('Insert') } },
        map: { ship: { 'L.index_1': { tap: 'boost' } } },
      }),
      game,
      BUILT_IN_DEVICES,
    );
    expect(plan.findings.filter((f) => f.rule === 'key-collision')).toEqual([
      expect.objectContaining({
        severity: 'error',
        control: 'L.stick',
        mode: 'ship',
        message:
          "In Ship, the left stick's up and Boost are both on Insert: the game does them at once.",
      }),
    ]);
  });
});

describe('a stick direction and a button on the same action', () => {
  // Boost is Tab in this game. The left stick's up sends Tab, and so can a button.
  const tabUp = {
    ...keyedSticks,
    'L.stick': { stick: { mode: 'keys', directions: { ...wasd, up: key('Tab') } } },
  } satisfies Scheme['behaviour'];
  const collisions = (action: string) =>
    resolve(
      scheme({
        behaviour: tabUp,
        ledger: { 'L.index_1': { tap: key('Tab') } },
        map: { ship: { 'L.index_1': { tap: action } } },
      }),
      game,
      BUILT_IN_DEVICES,
    ).findings.filter((f) => f.rule === 'key-collision');

  it('is not a collision: two ways to send the one action', () => {
    expect(collisions('boost')).toEqual([]);
  });

  it('is a collision when the button carries a different action', () => {
    expect(collisions('map')).toEqual([
      expect.objectContaining({ control: 'L.stick', mode: 'ship', severity: 'error' }),
    ]);
  });
});

describe('the ledger', () => {
  it('comes first: a key once given stays, even with an earlier pool key free', () => {
    const plan = resolve(
      scheme({
        map: { ship: { 'L.index_1': { tap: 'boost' } } },
        ledger: { 'L.index_1': { tap: key('End') } },
      }),
      game,
      BUILT_IN_DEVICES,
    );
    expect(sent(plan, 'L.index_1')).toEqual({ tap: key('End') });
  });

  it('never re-deals a key freed by taking an action off its button', () => {
    const plan = resolve(
      scheme({
        map: { ship: { 'L.index_2': { tap: 'boost' } } },
        ledger: { 'L.index_1': { tap: key('Insert') } },
      }),
      game,
      BUILT_IN_DEVICES,
    );
    expect(sent(plan, 'L.index_2')).toEqual({ tap: key('Home') });
    expect(plan.ledger['L.index_1']).toEqual({ tap: key('Insert') });
  });

  it('keeps every key where it was when a button earlier in the order is added later', () => {
    const first = resolve(
      scheme({ map: { ship: { 'L.index_1': { tap: 'boost' } } } }),
      game,
      BUILT_IN_DEVICES,
    );
    const edited = scheme({
      map: { ship: { 'L.index_1': { tap: 'boost' }, 'L.pinky_1': { tap: 'map' } } },
      ledger: first.ledger,
    });
    const second = resolve(edited, game, BUILT_IN_DEVICES);
    expect(sent(second, 'L.index_1')).toEqual(sent(first, 'L.index_1'));
    expect(sent(second, 'L.pinky_1')).toEqual({ tap: key('Home') });
  });
});

describe('the pool', () => {
  it('only grows at its end: the keys already handed out stay in order', () => {
    expect(KEY_POOL.slice(0, 31)).toEqual([
      'Insert',
      'Home',
      'PageUp',
      'Del',
      'End',
      'PageDown',
      'NumAdd',
      'NumSubtract',
      'NumMultiply',
      'NumDivide',
      '[',
      ']',
      ';',
      "'",
      ',',
      '.',
      '/',
      '\\',
      '-',
      'Num0',
      'Num1',
      'Num2',
      'Num3',
      'Num4',
      'Num5',
      'Num6',
      'Num7',
      'Num8',
      'Num9',
      'NumDecimal',
      '`',
    ]);
    expect(KEY_POOL.at(-1)).toBe('F24');
    expect(new Set(KEY_POOL).size).toBe(KEY_POOL.length);
  });

  it('skips F13–F24 for Unreal and Elite files', () => {
    expect(formatCanName('elite-binds', 'F13')).toBe(false);
    expect(formatCanName('unreal-ini', 'F24')).toBe(false);
    expect(formatCanName('unreal-ini', 'F12')).toBe(true);
  });

  const allButFKeys = Object.fromEntries(
    KEY_POOL.filter((k) => !k.startsWith('F')).map((k, i) => [`R.x${i}`, { tap: key(k) }]),
  );

  it('reports a button it has no key left for, rather than leave it sending nothing quietly', () => {
    const plan = resolve(
      scheme({ map: { ship: { 'L.index_1': { tap: 'boost' } } }, ledger: allButFKeys }),
      game,
      BUILT_IN_DEVICES,
    );
    expect(sent(plan, 'L.index_1')).toEqual({});
    expect(resolverFindings(plan)).toEqual([
      expect.objectContaining({ rule: 'pool-spent', severity: 'error', control: 'L.index_1' }),
    ]);
  });

  it('lets an action moved to an emptied button send the key that button kept, as the finding says', () => {
    // L.index_2 once had an action and still holds Insert; every other key is given out.
    const ledger: Scheme['ledger'] = Object.fromEntries(
      Object.entries(allButFKeys).filter(([control]) => control !== 'R.x0'),
    );
    ledger['L.index_2'] = { tap: key('Insert') };
    const stuck = resolve(
      scheme({ map: { ship: { 'L.index_1': { tap: 'boost' } } }, ledger }),
      game,
      BUILT_IN_DEVICES,
    );
    expect(resolverFindings(stuck).map((f) => f.rule)).toEqual(['pool-spent']);

    const moved = resolve(
      scheme({ map: { ship: { 'L.index_2': { tap: 'boost' } } }, ledger }),
      game,
      BUILT_IN_DEVICES,
    );
    expect(sent(moved, 'L.index_2')).toEqual({ tap: key('Insert') });
    expect(resolverFindings(moved)).toEqual([]);
  });

  it("reports a ledger key the game's file can't name, once the file is written", () => {
    const map: Scheme['map'] = { foot: { 'L.index_1': { tap: 'emote' } } };
    const own = resolve(
      scheme({ writeGameFile: false, map, ledger: allButFKeys }),
      game,
      BUILT_IN_DEVICES,
    );
    expect(sent(own, 'L.index_1')).toEqual({ tap: key('F13') });
    expect(resolverFindings(own)).toEqual([]);

    const written = resolve(
      scheme({ writeGameFile: true, map, ledger: own.ledger }),
      game,
      BUILT_IN_DEVICES,
    );
    expect(sent(written, 'L.index_1')).toEqual({ tap: key('F13') });
    expect(resolverFindings(written)).toEqual([
      expect.objectContaining({ rule: 'key-unnamable', severity: 'error', control: 'L.index_1' }),
    ]);
  });

  it('reaches F13 when no file has to name it', () => {
    const plan = resolve(
      scheme({
        writeGameFile: false,
        map: { foot: { 'L.index_1': { tap: 'emote' } } },
        ledger: allButFKeys,
      }),
      game,
      BUILT_IN_DEVICES,
    );
    expect(sent(plan, 'L.index_1')).toEqual({ tap: key('F13') });
  });
});

// What the made-up game ships Shoot and Zoom on: its bind sheet rows say what they change from.
const LEFT_CLICK = { kind: 'mouse', button: 'left' } as const;
const SCROLL_UP = { kind: 'scroll', dir: 'up', speed: 33 } as const;

describe("keys, the game's own", () => {
  const own = (map: Scheme['map']) =>
    resolve(scheme({ writeGameFile: false, map }), game, BUILT_IN_DEVICES);

  it('sends the key the game already has, and touches no file', () => {
    const plan = own({ ship: { 'L.index_1': { tap: 'boost' }, 'L.index_2': { tap: 'fire' } } });
    expect(sent(plan, 'L.index_1')).toEqual({ tap: key('Tab') });
    expect(sent(plan, 'L.index_2')).toEqual({ tap: { kind: 'mouse', button: 'left' } });
    expect(plan.gameFile).toBeUndefined();
    expect(plan.bindSheet).toEqual([]);
  });

  it('gives a second button on the same key a free key and a bind sheet row', () => {
    const plan = own({
      ship: { 'L.index_1': { tap: 'fire' } },
      foot: { 'R.index_1': { tap: 'shoot' } },
    });
    expect(sent(plan, 'L.index_1')).toEqual({ tap: { kind: 'mouse', button: 'left' } });
    expect(sent(plan, 'R.index_1')).toEqual({ tap: key('Insert') });
    expect(plan.bindSheet).toEqual([
      { set: 'keyboard', mode: 'foot', action: 'shoot', signal: key('Insert'), native: LEFT_CLICK },
    ]);
  });

  it('sends a scroll on a tap, as the game has it', () => {
    const plan = own({ ship: { 'L.index_1': { tap: 'zoom' } } });
    expect(sent(plan, 'L.index_1')).toEqual({ tap: { kind: 'scroll', dir: 'up', speed: 33 } });
    expect(plan.bindSheet).toEqual([]);
  });

  it('gives a scroll on a long press or double tap a key and a bind sheet row: the unit only scrolls on a tap', () => {
    const plan = own({ ship: { 'L.index_1': { long: 'zoom' }, 'L.index_2': { double: 'zoom' } } });
    expect(sent(plan, 'L.index_1')).toEqual({ long: key('Insert') });
    expect(sent(plan, 'L.index_2')).toEqual({ double: key('Home') });
    expect(plan.bindSheet).toEqual([
      { set: 'keyboard', mode: 'ship', action: 'zoom', signal: key('Insert'), native: SCROLL_UP },
      { set: 'keyboard', mode: 'ship', action: 'zoom', signal: key('Home'), native: SCROLL_UP },
    ]);
  });

  it('puts an action with no key of its own on the bind sheet', () => {
    const plan = own({ foot: { 'L.index_1': { tap: 'emote' } } });
    expect(plan.bindSheet).toEqual([
      { set: 'keyboard', mode: 'foot', action: 'emote', signal: key('Insert'), native: null },
    ]);
  });

  it("keeps one key across modes: the first mode's, and a row for the other", () => {
    const plan = own({
      ship: { 'L.index_1': { tap: 'boost' } },
      foot: { 'L.index_1': { tap: 'sprint' } },
    });
    expect(sent(plan, 'L.index_1')).toEqual({ tap: key('Tab') });
    expect(plan.bindSheet).toEqual([
      {
        set: 'keyboard',
        mode: 'foot',
        action: 'sprint',
        signal: key('Tab'),
        native: key('LShift'),
      },
    ]);
  });
});

describe('determinism and copies', () => {
  it("gives the same plan however the scheme's keys were inserted", () => {
    const a = scheme({
      map: {
        ship: { 'L.index_1': { tap: 'boost' }, 'R.middle_2': { tap: 'fire', double: 'map' } },
        foot: { 'R.ring_1': { tap: 'sprint' } },
      },
    });
    const reversed = <T extends object>(o: T): T =>
      Object.fromEntries(Object.entries(o).reverse()) as T;
    const b: Scheme = {
      ...a,
      map: reversed(Object.fromEntries(Object.entries(a.map).map(([m, c]) => [m, reversed(c)]))),
    };
    expect(JSON.stringify(resolve(b, game, BUILT_IN_DEVICES))).toBe(
      JSON.stringify(resolve(a, game, BUILT_IN_DEVICES)),
    );
  });

  it('copies a scheme with its ledger, so the copy sends the same keys, and shares nothing', () => {
    const original = scheme({
      map: { ship: { 'L.index_1': { tap: 'boost' } } },
      ledger: { 'L.index_1': { tap: key('End') } },
    });
    const copy = copyScheme(original, 'copy', 'Copy');
    expect(copy).toMatchObject({
      id: 'copy',
      name: 'Copy',
      ledger: original.ledger,
      map: original.map,
    });
    copy.map['ship'] = {};
    expect(original.map['ship']).toEqual({ 'L.index_1': { tap: 'boost' } });
  });
});
