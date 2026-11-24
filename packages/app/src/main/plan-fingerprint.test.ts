import { describe, expect, it } from 'vitest';
import type { Game, Scheme } from '@helmarray/core';
import { BUILT_IN_DEVICES, gameKeysPreset, resolve } from '@helmarray/core';
import { canonical, planFingerprint } from './plan-fingerprint';

const game: Game = {
  id: 'skiff',
  name: 'Skiff',
  modes: [{ id: 'ship', name: 'Ship' }],
  actions: [
    { id: 'boost', name: 'Boost', mode: 'ship', role: 'movement', required: true },
    { id: 'fire', name: 'Fire', mode: 'ship', role: 'combat', required: false },
  ],
  file: { format: 'elite-binds' },
};
const scheme: Scheme = {
  ...gameKeysPreset(game),
  map: { ship: { 'L.index_1': { tap: 'boost' }, 'R.index_1': { tap: 'fire' } } },
};
const plan = (s: Scheme) => resolve(s, game, BUILT_IN_DEVICES);

describe('the fingerprint of a plan', () => {
  it('is the same for the same layout, whether resolved again or read back from disk', () => {
    expect(planFingerprint(plan(scheme))).toBe(planFingerprint(plan(scheme)));
    const fromDisk = JSON.parse(JSON.stringify(plan(scheme))) as ReturnType<typeof plan>;
    expect(planFingerprint(fromDisk)).toBe(planFingerprint(plan(scheme)));
  });

  it('changes with any button, with what a button sends, and with a unit setting', () => {
    const base = planFingerprint(plan(scheme));
    const moved = {
      ...scheme,
      map: { ship: { 'L.index_1': { tap: 'fire' }, 'R.index_1': { tap: 'boost' } } },
    };
    const fewer = { ...scheme, map: { ship: { 'L.index_1': { tap: 'boost' } } } };
    const latched = { ...scheme, behaviour: { 'L.index_1': { latch: true } } };
    for (const other of [moved, fewer, latched]) {
      expect(planFingerprint(plan(other))).not.toBe(base);
    }
  });

  it('does not depend on the order of keys, nor on a key left undefined', () => {
    expect(canonical({ b: 1, a: { d: 2, c: undefined } })).toBe(canonical({ a: { d: 2 }, b: 1 }));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });
});

describe('canonical, piece by piece', () => {
  it('writes nothing as null', () => {
    expect([canonical(undefined), canonical(() => 1), canonical([undefined])]).toEqual([
      'null',
      'null',
      '[null]',
    ]);
  });

  it('joins array items and object entries with a comma', () => {
    expect([canonical([1, 2, 3]), canonical({ a: 1, b: 2 })]).toEqual(['[1,2,3]', '{"a":1,"b":2}']);
  });

  it('puts keys in order whatever order they were made in', () => {
    expect(canonical({ b: 1, c: 2, a: 3, A: 4, 10: 5, 9: 6 })).toBe(
      '{"10":5,"9":6,"A":4,"a":3,"b":1,"c":2}',
    );
  });

  it('leaves out a key whose value is undefined, and keeps one that is null', () => {
    expect(canonical({ a: undefined, b: null })).toBe('{"b":null}');
  });
});
