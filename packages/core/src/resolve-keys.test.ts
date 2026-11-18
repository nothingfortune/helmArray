import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES } from './devices/index';
import type { Game, Scheme, Signal } from './model';
import type { Plan } from './plan';
import { KEY_POOL, formatCanName } from './pool';
import { copyScheme, gameKeysPreset } from './presets/keys';
import { resolve } from './resolve';

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
  ],
  file: { format: 'elite-binds' },
};

function scheme(over: Partial<Scheme> = {}): Scheme {
  return { ...gameKeysPreset(game), writeGameFile: true, ...over };
}

const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;
const sent = (plan: Plan, control: string) =>
  [...plan.units.left.pins, ...plan.units.right.pins].find((p) => p.control === control)?.presses;

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
    expect(plan.findings).toEqual([
      expect.objectContaining({ rule: 'pool-spent', severity: 'error', control: 'L.index_1' }),
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
    expect(plan.bindSheet).toEqual([{ mode: 'foot', action: 'shoot', signal: key('Insert') }]);
  });

  it('puts an action with no key of its own on the bind sheet', () => {
    const plan = own({ foot: { 'L.index_1': { tap: 'emote' } } });
    expect(plan.bindSheet).toEqual([{ mode: 'foot', action: 'emote', signal: key('Insert') }]);
  });

  it("keeps one key across modes: the first mode's, and a row for the other", () => {
    const plan = own({
      ship: { 'L.index_1': { tap: 'boost' } },
      foot: { 'L.index_1': { tap: 'sprint' } },
    });
    expect(sent(plan, 'L.index_1')).toEqual({ tap: key('Tab') });
    expect(plan.bindSheet).toEqual([{ mode: 'foot', action: 'sprint', signal: key('Tab') }]);
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
