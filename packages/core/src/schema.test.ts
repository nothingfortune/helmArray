import { describe, expect, it } from 'vitest';
import type { AppSettings, Game, Scheme } from './model';
import { copyScheme, gameKeysPreset } from './presets/keys';
import type { Migration } from './schema';
import { MIGRATIONS, SchemaError, currentVersion, load, runMigrations, store } from './schema';
// Frozen: what a scheme looked like on disk at version 1. Never regenerate it.
import schemeV1 from './__fixtures__/scheme.v1.json';
import schemeV1Turbo from './__fixtures__/scheme.v1-turbo.json';
import { BUILT_IN_DEVICES } from './devices/index';
import { DEFAULT_TURBO_INTERVAL } from './model';
import { resolve } from './resolve';

const game: Game = {
  id: 'skiff',
  name: 'Skiff',
  modes: [{ id: 'ship', name: 'Ship' }],
  actions: [{ id: 'boost', name: 'Boost', mode: 'ship', role: 'movement', required: true }],
  file: { format: 'elite-binds' },
};

/** Freeze every object in a value, so a migration that edits its input throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('the versions', () => {
  it('are one more than the migrations of each kind, so a new version needs its migration', () => {
    expect(currentVersion('scheme')).toBe(MIGRATIONS.scheme.length + 1);
    expect(currentVersion('game')).toBe(MIGRATIONS.game.length + 1);
    expect(currentVersion('settings')).toBe(MIGRATIONS.settings.length + 1);
    expect(currentVersion('applied')).toBe(MIGRATIONS.applied.length + 1);
  });
});

describe('store and load', () => {
  it('stamp the current version, and give back the same scheme', () => {
    const scheme = copyScheme(gameKeysPreset(game), 'mine', 'Mine');
    const stored = store('scheme', scheme);
    expect(Object.keys(stored)[0]).toBe('schemaVersion');
    expect(stored.schemaVersion).toBe(currentVersion('scheme'));
    expect(load('scheme', JSON.parse(JSON.stringify(stored)))).toEqual(scheme);
  });

  it('give back the same game', () => {
    expect(load('game', store('game', game))).toEqual(game);
  });

  it('give back the same settings', () => {
    const settings: AppSettings = { activeGameId: 'skiff', activeScheme: { skiff: 'mine' } };
    const stored = store('settings', settings);
    expect(stored.schemaVersion).toBe(currentVersion('settings'));
    expect(load('settings', JSON.parse(JSON.stringify(stored)))).toEqual(settings);
  });

  it('give back the same applied plan', () => {
    const plan = resolve(gameKeysPreset(game), game, BUILT_IN_DEVICES);
    const stored = store('applied', plan);
    expect(stored.schemaVersion).toBe(currentVersion('applied'));
    expect(load('applied', JSON.parse(JSON.stringify(stored)))).toEqual(plan);
  });

  it('refuse a settings file or plan saved by a newer helmArray', () => {
    const newer = { schemaVersion: currentVersion('settings') + 1 };
    expect(() => load('settings', newer)).toThrow('newer helmArray');
    expect(() => load('applied', { schemaVersion: currentVersion('applied') + 1 })).toThrow(
      'newer helmArray',
    );
  });

  it('share nothing with what they were given', () => {
    const scheme = gameKeysPreset(game);
    const stored = store('scheme', scheme);
    stored.map['ship'] = { 'L.index_1': { tap: 'boost' } };
    expect(scheme.map['ship']).toEqual({});
  });

  it('still load a scheme saved at version 1', () => {
    const scheme: Scheme = load('scheme', schemeV1);
    expect(scheme).toMatchObject({
      id: 'skiff-own-keys',
      output: 'keys',
      writeGameFile: true,
      ledger: { 'L.index_1': { tap: { kind: 'key', code: 'PageUp' } } },
      accepted: [
        { rule: 'combat-tap-delayed', control: 'L.middle_1', reason: 'Map is a long hold' },
      ],
    });
    expect(scheme).not.toHaveProperty('schemaVersion');
  });

  it('give a version-1 turbo the default rate, so it still repeats and resolves to a rate', () => {
    const scheme: Scheme = load('scheme', schemeV1Turbo);
    expect(scheme.behaviour).toEqual({
      'L.index_1': { turbo: { interval: DEFAULT_TURBO_INTERVAL }, latch: false },
      'L.index_2': {},
    });
    const plan = resolve(scheme, game, BUILT_IN_DEVICES);
    const pin = plan.units.left.pins.find((p) => p.control === 'L.index_1');
    expect(pin?.turbo).toEqual({ interval: 20 });
  });
});

describe('the migration runner', () => {
  // Two made-up steps: version 1 named the output `mode`, version 2 kept a single `note`.
  const steps: Migration[] = [
    ({ mode, ...rest }) => ({ ...rest, output: mode }),
    ({ note, ...rest }) => ({ ...rest, notes: note === undefined ? [] : [note] }),
  ];

  it('runs every step from the file’s version to the current one, in order', () => {
    expect(runMigrations({ schemaVersion: 1, mode: 'keys', note: 'hi' }, 'scheme', steps)).toEqual({
      output: 'keys',
      notes: ['hi'],
    });
  });

  it('starts at the file’s version', () => {
    expect(runMigrations({ schemaVersion: 2, output: 'pad' }, 'scheme', steps)).toEqual({
      output: 'pad',
      notes: [],
    });
    expect(runMigrations({ schemaVersion: 3, output: 'pad', notes: [] }, 'scheme', steps)).toEqual({
      output: 'pad',
      notes: [],
    });
  });

  it('leaves what it read untouched, even for a step that edits its input', () => {
    const editing: Migration[] = [
      (doc) => {
        doc['output'] = 'pad';
        (doc['map'] as Record<string, unknown>)['foot'] = {};
        return doc;
      },
    ];
    const raw = deepFreeze({ schemaVersion: 1, output: 'keys', map: { ship: {} } });
    expect(runMigrations(raw, 'scheme', editing)).toEqual({
      output: 'pad',
      map: { ship: {}, foot: {} },
    });
    expect(raw).toEqual({ schemaVersion: 1, output: 'keys', map: { ship: {} } });
  });

  it('refuses a file saved by a newer helmArray, and says what to do', () => {
    expect(() => runMigrations({ schemaVersion: 4 }, 'scheme', steps)).toThrow(
      new SchemaError('This scheme was saved by a newer helmArray. Update helmArray to open it.'),
    );
  });

  it.each([
    ['nothing', null],
    ['a list', []],
    ['text', 'scheme'],
    ['no version', { id: 'x' }],
    ['version 0', { schemaVersion: 0 }],
    ['a part version', { schemaVersion: 1.5 }],
    ['a version in words', { schemaVersion: '1' }],
  ])('refuses %s', (_, raw) => {
    expect(() => runMigrations(raw, 'game', steps)).toThrow(SchemaError);
  });
});
