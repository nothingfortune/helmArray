import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILT_IN_DEVICES, currentVersion, resolve, xboxControllerPreset } from '@helmarray/core';
import type { Game, Scheme } from '@helmarray/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_MS, DataStore, StoreError, isSafeId, isScheme } from './store';
import type { StoreProblem } from './store';

const SKIFF: Game = {
  id: 'skiff',
  name: 'Skiff',
  modes: [{ id: 'ship', name: 'Ship' }],
  actions: [
    {
      id: 'boost',
      name: 'Boost',
      mode: 'ship',
      role: 'movement',
      required: true,
      native: { pad: 'A' },
    },
  ],
};
const ARBORETUM: Game = { ...SKIFF, id: 'arboretum', name: 'Arboretum' };

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'helm-store-'));
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

let counter = 0;
async function openStore(builtIn: readonly Game[] = [SKIFF, ARBORETUM]) {
  const problems: StoreProblem[] = [];
  const data = await DataStore.open({
    root,
    builtInGames: builtIn,
    onProblem: (problem) => problems.push(problem),
    newId: () => `id${++counter}`,
  });
  return { data, problems };
}

const path = (...parts: string[]) => join(root, ...parts);
const readJson = async (...parts: string[]) =>
  JSON.parse(await readFile(path(...parts), 'utf8')) as Record<string, unknown>;
const exists = (...parts: string[]) =>
  stat(path(...parts)).then(
    () => true,
    () => false,
  );
const writeRaw = async (parts: string[], text: string) => {
  await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
  await writeFile(path(...parts), text, 'utf8');
};
const names = (...parts: string[]) => readdir(path(...parts)).then((list) => list.sort());

describe('ids', () => {
  it.each(['skiff', 'skiff-xbox-1a2b3c4d', 'Game_2.v3'])('accepts %s', (id) => {
    expect(isSafeId(id)).toBe(true);
  });

  it.each([
    '',
    '..',
    '__proto__',
    'con',
    'NUL',
    'com1.json',
    'lpt9',
    '.hidden',
    'a/b',
    'a\\b',
    'a b',
    'name.',
    'x'.repeat(101),
    3,
    null,
  ])('refuses %j', (id) => {
    expect(isSafeId(id)).toBe(false);
  });
});

describe('ids that are also names on every object', () => {
  const names = ['constructor', 'toString', 'valueOf', 'hasOwnProperty'];
  const gameOf = (id: string): Game => ({ ...SKIFF, id, name: id });

  it.each(names)('are fine as ids: %s', (id) => {
    expect(isSafeId(id)).toBe(true);
  });

  it.each(names)('give a game with no choice made no scheme, not a function: %s', async (id) => {
    const { data } = await openStore([gameOf(id)]);
    await data.setActive(id, null);
    expect(data.active()).toEqual({ gameId: id, schemeId: null });
    expect(() => structuredClone(data.active())).not.toThrow();
    expect((await readJson('settings.json'))['activeScheme']).toEqual({});
  });

  it.each(names)('are found as the active game of an old settings file: %s', async (id) => {
    await writeRaw(
      ['settings.json'],
      JSON.stringify({ schemaVersion: 1, activeGameId: id, activeScheme: {} }),
    );
    const { data } = await openStore([gameOf(id)]);
    expect(data.active()).toEqual({ gameId: id, schemeId: null });
    expect(structuredClone(data.active())).toEqual({ gameId: id, schemeId: null });
  });

  it.each(names)('keep a scheme chosen for such a game: %s', async (id) => {
    const { data } = await openStore([gameOf(id), SKIFF]);
    const scheme = await data.createSchemeFromPreset(id, 'xbox');
    await data.setActive(id, scheme.id);
    await data.setActive('skiff', null);
    await data.setActive(id, scheme.id);
    expect(structuredClone(data.active())).toEqual({ gameId: id, schemeId: scheme.id });
    expect((await openStore([gameOf(id), SKIFF])).data.active().schemeId).toBe(scheme.id);
  });

  it('refuses __proto__ as a game or a scheme, writing nothing', async () => {
    const { data } = await openStore();
    await expect(data.setActive('__proto__', null)).rejects.toThrow(StoreError);
    await expect(data.createSchemeFromPreset('__proto__', 'xbox')).rejects.toThrow(StoreError);
    expect(await data.getScheme('__proto__')).toBeNull();
    expect(await data.getApplied('__proto__')).toBeNull();
    expect(data.active()).toEqual({ gameId: null, schemeId: null });
    expect(await exists('settings.json')).toBe(false);
  });

  it('keeps a __proto__ key in a settings file as a plain key, not a prototype', async () => {
    await writeRaw(
      ['settings.json'],
      '{"schemaVersion":1,"activeGameId":"skiff","activeScheme":{"__proto__":"x"}}',
    );
    const { data } = await openStore();
    await data.setActive('skiff', null);
    expect(data.active()).toEqual({ gameId: 'skiff', schemeId: null });
    expect(Object.getPrototypeOf((await readJson('settings.json'))['activeScheme'])).toBe(
      Object.prototype,
    );
  });
});

describe('what is handed in is what is written', () => {
  it('keeps a plan as it was when applied, whatever the caller does with it after', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    const plan = resolve(scheme, SKIFF, BUILT_IN_DEVICES);
    const asApplied = structuredClone(plan);
    const saved = data.saveApplied(scheme.id, plan);
    plan.findings.push({ rule: 'later', severity: 'error', message: 'changed after' });
    plan.units.left.hand = 'right';
    plan.bindings.length = 0;
    await saved;
    expect(await data.getApplied(scheme.id)).toEqual(asApplied);
    const file = await readJson('applied', `${scheme.id}.json`);
    expect(JSON.stringify(file)).not.toContain('changed after');
  });

  it('keeps a plan as it was when a write is already ahead of it in the queue', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    const plan = resolve(scheme, SKIFF, BUILT_IN_DEVICES);
    const asApplied = structuredClone(plan);
    const first = data.setActive('skiff', scheme.id);
    const saved = data.saveApplied(scheme.id, plan);
    plan.findings.push({ rule: 'later', severity: 'error', message: 'changed after' });
    await Promise.all([first, saved]);
    expect(await data.getApplied(scheme.id)).toEqual(asApplied);
  });

  it('keeps a scheme as it was when saved, whatever the caller does with it after', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    const mine: Scheme = { ...scheme, name: 'As saved' };
    data.saveScheme(mine);
    mine.name = 'Changed after';
    mine.padMap['L.index_1'] = 'X';
    mine.accepted.push({ rule: 'late', reason: 'changed after' });
    await data.flush();
    const onDisk = await readJson('schemes', `${scheme.id}.json`);
    expect(onDisk['name']).toBe('As saved');
    expect(JSON.stringify(onDisk)).not.toContain('changed after');
    expect((await data.getScheme(scheme.id))?.padMap['L.index_1']).toBe('RB');
  });

  it('keeps what it gave back separate from what it holds', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    scheme.name = 'Changed by the caller';
    scheme.padMap['L.index_1'] = 'X';
    await data.flush();
    expect((await readJson('schemes', `${scheme.id}.json`))['name']).toBe('Xbox controller');

    const waiting = { ...scheme, name: 'Waiting' };
    data.saveScheme(waiting);
    (await data.getScheme(scheme.id))?.accepted.push({ rule: 'x', reason: 'y' });
    (await data.listSchemes('skiff'))[0]?.accepted.push({ rule: 'x', reason: 'y' });
    expect((await data.getScheme(scheme.id))?.accepted).toEqual([]);

    await data.setActive('skiff', scheme.id);
    const active = data.active();
    active.gameId = 'changed';
    expect(data.active().gameId).toBe('skiff');
  });

  it('refuses at once, writing nothing, a plan that can’t be turned into a file', async () => {
    const { data } = await openStore();
    const plan = resolve(xboxControllerPreset(SKIFF), SKIFF, BUILT_IN_DEVICES);
    const cyclic = { ...plan } as Record<string, unknown>;
    cyclic['self'] = cyclic;
    await expect(data.saveApplied('x', cyclic as unknown as typeof plan)).rejects.toThrow(
      StoreError,
    );
    expect(await exists('applied')).toBe(false);
  });
});

describe('flush', () => {
  it('waits for a change of the active game that is still being worked out', async () => {
    const { data } = await openStore();
    const change = data.setActive('skiff', null);
    await data.flush();
    expect(await exists('settings.json')).toBe(true);
    expect((await readJson('settings.json'))['activeGameId']).toBe('skiff');
    await change;
  });

  it('waits for a scheme still being made from a preset', async () => {
    const { data } = await openStore();
    const made = data.createSchemeFromPreset('skiff', 'xbox');
    await data.flush();
    expect(await names('schemes')).toEqual([`${(await made).id}.json`]);
  });

  it('waits for an applied plan on its way to the disk', async () => {
    const { data } = await openStore();
    const plan = resolve(xboxControllerPreset(SKIFF), SKIFF, BUILT_IN_DEVICES);
    const saved = data.saveApplied('x', plan);
    await data.flush();
    expect(await exists('applied', 'x.json')).toBe(true);
    await saved;
  });

  it('waits for a change that is refused, and doesn’t throw for it', async () => {
    const { data } = await openStore();
    const refused = data.setActive('nowhere', null);
    const seen = expect(refused).rejects.toThrow(StoreError);
    await expect(data.flush()).resolves.toBeUndefined();
    await seen;
  });

  it('writes an edit made while a change was still being worked out', async () => {
    const { data } = await openStore();
    const made = data.createSchemeFromPreset('skiff', 'xbox');
    data.saveScheme({ ...xboxControllerPreset(SKIFF), id: 'edited' });
    await data.flush();
    expect(await names('schemes')).toEqual(['edited.json', `${(await made).id}.json`].sort());
  });
});

describe('the games', () => {
  it('lists the built-in games by name, then the ones added by hand', async () => {
    const { data } = await openStore([SKIFF, ARBORETUM]);
    const mine: Game = { ...SKIFF, id: 'mine', name: 'Zed' };
    const first: Game = { ...SKIFF, id: 'first', name: 'Aardvark' };
    await writeRaw(['games', 'mine.json'], JSON.stringify({ schemaVersion: 1, ...mine }));
    await writeRaw(['games', 'first.json'], JSON.stringify({ schemaVersion: 1, ...first }));
    const entries = await data.listGames();
    expect(entries.map((e) => [e.game.id, e.builtIn])).toEqual([
      ['arboretum', true],
      ['skiff', true],
      ['first', false],
      ['mine', false],
    ]);
    expect(entries[2]?.game).toEqual(first);
  });

  it('lists only the built-in games when none were added', async () => {
    const { data } = await openStore([SKIFF]);
    expect(await data.listGames()).toEqual([{ game: SKIFF, builtIn: true }]);
  });

  it('works with no built-in games and no folder at all', async () => {
    const { data, problems } = await openStore([]);
    expect(await data.listGames()).toEqual([]);
    expect(problems).toEqual([]);
  });

  it('keeps a game added by hand from taking a built-in one’s id', async () => {
    const { data, problems } = await openStore([SKIFF]);
    await writeRaw(
      ['games', 'skiff.json'],
      JSON.stringify({ schemaVersion: 1, ...SKIFF, name: 'Imposter' }),
    );
    expect(await data.listGames()).toEqual([{ game: SKIFF, builtIn: true }]);
    expect(problems.map((p) => p.file)).toEqual(['games/skiff.json']);
  });

  it('reports a damaged game file and goes on without it', async () => {
    const { data, problems } = await openStore([SKIFF]);
    await writeRaw(['games', 'broken.json'], '{"schemaVersion": 1, "id": "bro');
    await writeRaw(['games', 'arboretum.json'], JSON.stringify({ schemaVersion: 1, ...ARBORETUM }));
    const ids = (await data.listGames()).map((e) => e.game.id);
    expect(ids).toEqual(['skiff', 'arboretum']);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toBe('games/broken.json');
    expect(data.problems().map((p) => p.file)).toEqual(['games/broken.json']);
  });

  it('reports a game file filed under another name than its own id', async () => {
    const { data, problems } = await openStore([]);
    await writeRaw(['games', 'wrong.json'], JSON.stringify({ schemaVersion: 1, ...ARBORETUM }));
    expect(await data.listGames()).toEqual([]);
    expect(problems[0]?.file).toBe('games/wrong.json');
  });

  it('reports a game saved by a newer helmArray and says to update', async () => {
    const { data, problems } = await openStore([]);
    await writeRaw(
      ['games', 'arboretum.json'],
      JSON.stringify({ ...ARBORETUM, schemaVersion: currentVersion('game') + 1 }),
    );
    expect(await data.listGames()).toEqual([]);
    expect(problems[0]?.message).toContain('newer helmArray');
  });
});

describe('using a preset', () => {
  it('stores a copy under a new id and leaves the preset alone', async () => {
    const { data } = await openStore();
    const before = JSON.stringify(xboxControllerPreset(SKIFF));
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');

    expect(scheme.id).toBe(`skiff-xbox-id${counter}`);
    expect(scheme.id).not.toBe(xboxControllerPreset(SKIFF).id);
    expect({ ...scheme, id: '' }).toEqual({ ...xboxControllerPreset(SKIFF), id: '' });
    expect(await data.getScheme(scheme.id)).toEqual(scheme);

    // Editing the copy, or the copy on disk, doesn't reach the preset.
    scheme.padMap['L.index_1'] = 'X';
    data.saveScheme(scheme);
    await data.flush();
    expect(JSON.stringify(xboxControllerPreset(SKIFF))).toBe(before);
    expect(xboxControllerPreset(SKIFF).padMap['L.index_1']).toBe('RB');
  });

  it('writes the file with its schema version at the top', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    const file = await readJson('schemes', `${scheme.id}.json`);
    expect(Object.keys(file)[0]).toBe('schemaVersion');
    expect(file['schemaVersion']).toBe(currentVersion('scheme'));
  });

  it('gives each copy its own id', async () => {
    const { data } = await openStore();
    const a = await data.createSchemeFromPreset('skiff', 'xbox');
    const b = await data.createSchemeFromPreset('skiff', 'xbox');
    expect(a.id).not.toBe(b.id);
    expect((await data.listSchemes('skiff')).map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('names a second copy so the two can be told apart', async () => {
    const { data } = await openStore();
    await data.createSchemeFromPreset('skiff', 'xbox');
    await data.createSchemeFromPreset('skiff', 'xbox');
    const third = await data.createSchemeFromPreset('skiff', 'xbox');
    expect((await data.listSchemes('skiff')).map((s) => s.name)).toEqual([
      'Xbox controller',
      'Xbox controller 2',
      'Xbox controller 3',
    ]);
    expect(third.name).toBe('Xbox controller 3');
  });

  it('names copies made at the same moment apart too', async () => {
    const { data } = await openStore();
    const made = await Promise.all([
      data.createSchemeFromPreset('skiff', 'xbox'),
      data.createSchemeFromPreset('skiff', 'xbox'),
      data.createSchemeFromPreset('skiff', 'xbox'),
    ]);
    expect(made.map((s) => s.name)).toEqual([
      'Xbox controller',
      'Xbox controller 2',
      'Xbox controller 3',
    ]);
  });

  it('makes an id that passes the same check, whatever the length of the game’s id', async () => {
    const long: Game = { ...SKIFF, id: 'g'.repeat(100), name: 'Long' };
    const { data } = await openStore([long]);
    for (const preset of ['xbox', 'keys'] as const) {
      const scheme = await data.createSchemeFromPreset(long.id, preset);
      expect(isSafeId(scheme.id)).toBe(true);
      expect(scheme.gameId).toBe(long.id);
      expect(scheme.id).toContain(`-${preset}-`);
      expect(await data.getScheme(scheme.id)).toEqual(scheme);
      data.saveScheme({ ...scheme, name: 'Edited' });
      await data.flush();
      expect((await data.listSchemes(long.id)).map((s) => s.name)).toContain('Edited');
    }
    expect(await data.listSchemes(long.id)).toHaveLength(2);
  });

  it('also makes the game’s-own-keys scheme', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'keys');
    expect(scheme).toMatchObject({ gameId: 'skiff', output: 'keys', name: "Game's own keys" });
    expect(scheme.id).toMatch(/^skiff-keys-/);
  });

  it('refuses a game or a preset it doesn’t have, writing nothing', async () => {
    const { data } = await openStore();
    await expect(data.createSchemeFromPreset('nowhere', 'xbox')).rejects.toThrow(StoreError);
    await expect(data.createSchemeFromPreset('skiff', 'mine' as 'xbox')).rejects.toThrow(
      StoreError,
    );
    expect(await exists('schemes')).toBe(false);
  });

  it('works for a game added by hand', async () => {
    const { data } = await openStore([]);
    await writeRaw(['games', 'arboretum.json'], JSON.stringify({ schemaVersion: 1, ...ARBORETUM }));
    const scheme = await data.createSchemeFromPreset('arboretum', 'xbox');
    expect(scheme.gameId).toBe('arboretum');
  });
});

describe('reading schemes', () => {
  it('lists one game’s schemes only, by name', async () => {
    const { data } = await openStore();
    const mine = await data.createSchemeFromPreset('skiff', 'xbox');
    const own = await data.createSchemeFromPreset('skiff', 'keys');
    await data.createSchemeFromPreset('arboretum', 'xbox');
    expect((await data.listSchemes('skiff')).map((s) => s.id)).toEqual([own.id, mine.id]);
    expect(await data.listSchemes('nobody')).toEqual([]);
  });

  it('gives null for a scheme that isn’t there or an id that is no id', async () => {
    const { data } = await openStore();
    expect(await data.getScheme('missing')).toBeNull();
    expect(await data.getScheme('../settings')).toBeNull();
  });

  it('brings an old scheme up to date as it reads it', async () => {
    const { data } = await openStore();
    const preset = xboxControllerPreset(SKIFF);
    await writeRaw(
      ['schemes', 'old.json'],
      JSON.stringify({
        schemaVersion: 1,
        ...preset,
        id: 'old',
        behaviour: { 'L.index_1': { turbo: true } },
      }),
    );
    expect((await data.getScheme('old'))?.behaviour['L.index_1']).toEqual({
      turbo: { interval: 20 },
    });
  });

  it('skips and reports a scheme file that is damaged, not a scheme, or filed wrongly', async () => {
    const { data, problems } = await openStore();
    const good = await data.createSchemeFromPreset('skiff', 'xbox');
    await writeRaw(['schemes', 'cut.json'], '{"schemaVersion":1,"id":"cut"');
    await writeRaw(
      ['schemes', 'nonsense.json'],
      JSON.stringify({ schemaVersion: 1, id: 'nonsense' }),
    );
    await writeRaw(
      ['schemes', 'wrongname.json'],
      JSON.stringify({ schemaVersion: 1, ...good, id: 'someone-else' }),
    );
    expect((await data.listSchemes('skiff')).map((s) => s.id)).toEqual([good.id]);
    expect(problems.map((p) => p.file).sort()).toEqual([
      'schemes/cut.json',
      'schemes/nonsense.json',
      'schemes/wrongname.json',
    ]);
    expect(await data.getScheme('cut')).toBeNull();
  });

  it('gives null, and reports it, for a scheme filed under another id than its own', async () => {
    const { data, problems } = await openStore();
    const other = await data.createSchemeFromPreset('skiff', 'keys');
    const text = JSON.stringify({
      schemaVersion: currentVersion('scheme'),
      ...xboxControllerPreset(SKIFF),
      id: other.id,
    });
    await writeRaw(['schemes', 'a.json'], text);

    expect(await data.getScheme('a')).toBeNull();
    expect(problems.map((p) => p.file)).toEqual(['schemes/a.json']);
    expect(problems[0]?.message).toContain('different name');
    // The same file is turned down the same way when the schemes are listed.
    expect((await data.listSchemes('skiff')).map((s) => s.id)).toEqual([other.id]);
    // The unrelated scheme is still its own.
    expect(await data.getScheme(other.id)).toEqual(other);
  });

  it('lets getScheme and listSchemes agree on every file', async () => {
    const { data } = await openStore();
    const good = await data.createSchemeFromPreset('skiff', 'xbox');
    await writeRaw(
      ['schemes', 'liar.json'],
      JSON.stringify({ schemaVersion: currentVersion('scheme'), ...good, id: 'someone' }),
    );
    const listed = new Set((await data.listSchemes('skiff')).map((s) => s.id));
    for (const id of [good.id, 'liar', 'someone']) {
      expect((await data.getScheme(id)) !== null, id).toBe(listed.has(id));
    }
  });

  it('clears a report once the file reads well again', async () => {
    const { data } = await openStore();
    await writeRaw(['schemes', 'x.json'], 'not json');
    await data.getScheme('x');
    expect(data.problems()).toHaveLength(1);
    await rm(path('schemes', 'x.json'));
    await data.getScheme('x');
    expect(data.problems()).toEqual([]);
  });
});

describe('autosaving a scheme', () => {
  const edit = (scheme: Scheme, name: string): Scheme => ({ ...scheme, name });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  it('writes a moment after the last change, once, with the last change', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    const file = ['schemes', `${scheme.id}.json`] as const;

    data.saveScheme(edit(scheme, 'One'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 100);
    data.saveScheme(edit(scheme, 'Two'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    // Not yet: each change starts the wait again.
    expect((await readJson(...file))['name']).toBe('Xbox controller');

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(async () => expect((await readJson(...file))['name']).toBe('Two'));
  });

  it('keeps each scheme’s wait apart', async () => {
    const { data } = await openStore();
    const a = await data.createSchemeFromPreset('skiff', 'xbox');
    const b = await data.createSchemeFromPreset('skiff', 'keys');
    data.saveScheme(edit(a, 'A edited'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 100);
    data.saveScheme(edit(b, 'B edited'));
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(async () =>
      expect((await readJson('schemes', `${a.id}.json`))['name']).toBe('A edited'),
    );
    expect((await readJson('schemes', `${b.id}.json`))['name']).toBe("Game's own keys");
  });

  it('answers a read with the edit that is still waiting', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    data.saveScheme(edit(scheme, 'Waiting'));
    expect((await data.getScheme(scheme.id))?.name).toBe('Waiting');
    expect((await data.listSchemes('skiff')).map((s) => s.name)).toEqual(['Waiting']);
    expect((await readJson('schemes', `${scheme.id}.json`))['name']).toBe('Xbox controller');
  });

  it('takes a copy: changing the scheme afterwards changes nothing waiting', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    const mine = edit(scheme, 'Mine');
    data.saveScheme(mine);
    mine.name = 'Changed after';
    expect((await data.getScheme(scheme.id))?.name).toBe('Mine');
  });

  it('flush writes what is waiting at once, and nothing is written twice after', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    data.saveScheme(edit(scheme, 'Before quit'));
    await data.flush();
    expect((await readJson('schemes', `${scheme.id}.json`))['name']).toBe('Before quit');
    // The wait that was running is cancelled: a later edit made on disk by hand stays.
    await writeRaw(
      ['schemes', `${scheme.id}.json`],
      JSON.stringify({ schemaVersion: currentVersion('scheme'), ...scheme, name: 'By hand' }),
    );
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
    expect((await readJson('schemes', `${scheme.id}.json`))['name']).toBe('By hand');
  });

  it('flush with nothing waiting does nothing', async () => {
    const { data } = await openStore();
    await data.flush();
    expect(await exists('schemes')).toBe(false);
  });

  it('writes a scheme that is new to the disk', async () => {
    const { data } = await openStore();
    const scheme = { ...xboxControllerPreset(SKIFF), id: 'brand-new' };
    data.saveScheme(scheme);
    await data.flush();
    expect(await data.getScheme('brand-new')).toEqual(scheme);
  });

  it('refuses at once what isn’t a scheme, and writes nothing', async () => {
    const { data } = await openStore();
    expect(() => data.saveScheme({ id: 'x' } as unknown as Scheme)).toThrow(StoreError);
    expect(() => data.saveScheme({ ...xboxControllerPreset(SKIFF), id: '../x' })).toThrow(
      StoreError,
    );
    await data.flush();
    expect(await exists('schemes')).toBe(false);
  });

  it('keeps an edit it could not write, reports it, and gives it back to the next read', async () => {
    const { data, problems } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    const file = ['schemes', `${scheme.id}.json`] as const;
    await writeRaw([...file], JSON.stringify({ schemaVersion: currentVersion('scheme') + 1 }));
    problems.length = 0;
    data.saveScheme(edit(scheme, 'Kept'));
    await data.flush();
    expect(problems.map((p) => p.message).join(' ')).toContain('newer helmArray');
    expect((await data.getScheme(scheme.id))?.name).toBe('Kept');
  });
});

describe('writing', () => {
  it('leaves no temporary file behind', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    data.saveScheme({ ...scheme, name: 'Again' });
    await data.flush();
    await data.setActive('skiff', scheme.id);
    await data.saveApplied(scheme.id, resolve(scheme, SKIFF, BUILT_IN_DEVICES));
    expect(await names('schemes')).toEqual([`${scheme.id}.json`]);
    expect(await names('applied')).toEqual([`${scheme.id}.json`]);
    expect(await names('.')).toEqual(['applied', 'schemes', 'settings.json']);
  });

  it('never leaves a half-written file: it writes beside the file and renames', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    const file = path('schemes', `${scheme.id}.json`);
    const seen: string[][] = [];
    // While a flush is running the folder holds either the old file or the new one, whole.
    data.saveScheme({ ...scheme, name: 'Whole' });
    const writing = data.flush();
    for (let i = 0; i < 20; i++) {
      seen.push(await readdir(path('schemes')));
      const text = await readFile(file, 'utf8').catch(() => null);
      if (text !== null) expect(() => JSON.parse(text)).not.toThrow();
    }
    await writing;
    for (const list of seen) {
      for (const name of list)
        expect(name === `${scheme.id}.json` || name.endsWith('.tmp')).toBe(true);
    }
  });

  it('keeps a damaged file aside before replacing it, and says so', async () => {
    const { data, problems } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    const file = ['schemes', `${scheme.id}.json`] as const;
    await writeRaw([...file], '{"half');
    data.saveScheme({ ...scheme, name: 'Fresh' });
    await data.flush();

    expect((await readJson(...file))['name']).toBe('Fresh');
    const aside = (await names('schemes')).filter((n) => n.includes('.corrupt-'));
    expect(aside).toHaveLength(1);
    expect(await readFile(path('schemes', aside[0] ?? ''), 'utf8')).toBe('{"half');
    expect(problems.some((p) => p.message.includes('.corrupt-'))).toBe(true);
  });

  it('refuses to replace a file a newer helmArray wrote, and leaves it as it was', async () => {
    const { data, problems } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    const text = JSON.stringify({ schemaVersion: currentVersion('scheme') + 1, future: true });
    await writeRaw(['schemes', `${scheme.id}.json`], text);
    problems.length = 0;
    data.saveScheme({ ...scheme, name: 'Mine' });
    await data.flush();
    expect(await readFile(path('schemes', `${scheme.id}.json`), 'utf8')).toBe(text);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('Update helmArray');
    expect(data.problems().map((p) => p.file)).toEqual([`schemes/${scheme.id}.json`]);
  });

  it('refuses to touch a file the disk won’t let it read', async () => {
    const { data, problems } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    await rm(path('schemes', `${scheme.id}.json`));
    // A folder where the file should be: reading it fails with something other than "not there".
    await mkdir(path('schemes', `${scheme.id}.json`));
    data.saveScheme({ ...scheme, name: 'Mine' });
    await data.flush();
    expect((await stat(path('schemes', `${scheme.id}.json`))).isDirectory()).toBe(true);
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('the settings', () => {
  it('start with no game and no scheme', async () => {
    const { data } = await openStore();
    expect(data.active()).toEqual({ gameId: null, schemeId: null });
    expect(await exists('settings.json')).toBe(false);
  });

  it('remember the active game and scheme across a restart', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    await data.setActive('skiff', scheme.id);
    expect(data.active()).toEqual({ gameId: 'skiff', schemeId: scheme.id });

    const file = await readJson('settings.json');
    expect(file['schemaVersion']).toBe(currentVersion('settings'));
    const again = (await openStore()).data;
    expect(again.active()).toEqual({ gameId: 'skiff', schemeId: scheme.id });
  });

  it('keep each game’s own active scheme', async () => {
    const { data } = await openStore();
    const a = await data.createSchemeFromPreset('skiff', 'xbox');
    const b = await data.createSchemeFromPreset('arboretum', 'xbox');
    await data.setActive('skiff', a.id);
    await data.setActive('arboretum', b.id);
    await data.setActive('skiff', null);
    expect(data.active()).toEqual({ gameId: 'skiff', schemeId: null });
    await data.setActive('arboretum', b.id);
    expect(data.active()).toEqual({ gameId: 'arboretum', schemeId: b.id });
    await data.setActive('skiff', a.id);
    expect((await readJson('settings.json'))['activeScheme']).toEqual({
      skiff: a.id,
      arboretum: b.id,
    });
  });

  it('keep both choices when two changes overlap', async () => {
    const { data } = await openStore();
    const a = await data.createSchemeFromPreset('skiff', 'xbox');
    const b = await data.createSchemeFromPreset('arboretum', 'xbox');
    await Promise.all([data.setActive('skiff', a.id), data.setActive('arboretum', b.id)]);
    expect(data.active()).toEqual({ gameId: 'arboretum', schemeId: b.id });
    expect((await readJson('settings.json'))['activeScheme']).toEqual({
      skiff: a.id,
      arboretum: b.id,
    });
    expect((await openStore()).data.active()).toEqual({ gameId: 'arboretum', schemeId: b.id });
  });

  it('go back to what they were when a change is refused', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    await data.setActive('skiff', scheme.id);
    await writeRaw(
      ['settings.json'],
      JSON.stringify({ schemaVersion: currentVersion('settings') + 1 }),
    );
    await expect(data.setActive('skiff', null)).rejects.toThrow(StoreError);
    expect(data.active()).toEqual({ gameId: 'skiff', schemeId: scheme.id });
  });

  it('refuse a game or a scheme that isn’t there, or a scheme of another game', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    await expect(data.setActive('nowhere', null)).rejects.toThrow(StoreError);
    await expect(data.setActive('skiff', 'missing')).rejects.toThrow(StoreError);
    await expect(data.setActive('arboretum', scheme.id)).rejects.toThrow(StoreError);
    expect(data.active()).toEqual({ gameId: null, schemeId: null });
    expect(await exists('settings.json')).toBe(false);
  });

  it('accept a scheme whose edit is still waiting to be written', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { data } = await openStore();
    data.saveScheme({ ...xboxControllerPreset(SKIFF), id: 'fresh' });
    await data.setActive('skiff', 'fresh');
    expect(data.active().schemeId).toBe('fresh');
  });

  it('go back to nothing, reported, when the file is damaged; a change keeps the damaged one aside', async () => {
    await writeRaw(['settings.json'], '{ not json');
    const { data, problems } = await openStore();
    expect(data.active()).toEqual({ gameId: null, schemeId: null });
    expect(problems.map((p) => p.file)).toEqual(['settings.json']);

    await data.setActive('skiff', null);
    expect(data.active()).toEqual({ gameId: 'skiff', schemeId: null });
    expect((await names('.')).some((n) => n.startsWith('settings.json.corrupt-'))).toBe(true);
  });

  it('are left alone, and the change refused, when a newer helmArray wrote them', async () => {
    const text = JSON.stringify({ schemaVersion: currentVersion('settings') + 1, activeGameId: 7 });
    await writeRaw(['settings.json'], text);
    const { data, problems } = await openStore();
    expect(problems[0]?.message).toContain('newer helmArray');
    await expect(data.setActive('skiff', null)).rejects.toThrow(StoreError);
    expect(await readFile(path('settings.json'), 'utf8')).toBe(text);
    expect(data.active()).toEqual({ gameId: null, schemeId: null });
  });

  it('refuse a settings file of the wrong shape', async () => {
    await writeRaw(
      ['settings.json'],
      JSON.stringify({ schemaVersion: 1, activeGameId: 3, activeScheme: [] }),
    );
    const { data, problems } = await openStore();
    expect(data.active()).toEqual({ gameId: null, schemeId: null });
    expect(problems).toHaveLength(1);
  });
});

describe('the applied plans', () => {
  it('keep the last plan applied for each scheme', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    const plan = resolve(scheme, SKIFF, BUILT_IN_DEVICES);
    expect(await data.getApplied(scheme.id)).toBeNull();

    await data.saveApplied(scheme.id, plan);
    expect(await data.getApplied(scheme.id)).toEqual(plan);
    expect((await readJson('applied', `${scheme.id}.json`))['schemaVersion']).toBe(
      currentVersion('applied'),
    );

    const later = {
      ...plan,
      findings: [{ rule: 'r', severity: 'warning' as const, message: 'm' }],
    };
    await data.saveApplied(scheme.id, later);
    expect(await data.getApplied(scheme.id)).toEqual(later);
  });

  it('are kept apart from the schemes, and survive a restart', async () => {
    const { data } = await openStore();
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    await data.saveApplied(scheme.id, resolve(scheme, SKIFF, BUILT_IN_DEVICES));
    const again = (await openStore()).data;
    expect(await again.getApplied(scheme.id)).not.toBeNull();
    expect((await again.listSchemes('skiff')).map((s) => s.id)).toEqual([scheme.id]);
  });

  it('refuse an id that is no id and a plan that is no plan', async () => {
    const { data } = await openStore();
    const plan = resolve(xboxControllerPreset(SKIFF), SKIFF, BUILT_IN_DEVICES);
    await expect(data.saveApplied('../x', plan)).rejects.toThrow(StoreError);
    await expect(data.saveApplied('x', {} as typeof plan)).rejects.toThrow(StoreError);
    expect(await data.getApplied('../x')).toBeNull();
    expect(await exists('applied')).toBe(false);
  });

  it('say nothing was applied when the file is damaged, and report it', async () => {
    const { data, problems } = await openStore();
    await writeRaw(['applied', 'x.json'], '[');
    expect(await data.getApplied('x')).toBeNull();
    expect(problems.map((p) => p.file)).toEqual(['applied/x.json']);
  });
});

describe('isScheme', () => {
  it('accepts a scheme and refuses what is missing a part', () => {
    const scheme = xboxControllerPreset(SKIFF);
    expect(isScheme(scheme)).toBe(true);
    for (const key of Object.keys(scheme)) {
      const rest = Object.fromEntries(Object.entries(scheme).filter(([name]) => name !== key));
      expect(isScheme(rest), key).toBe(false);
    }
    expect(isScheme({ ...scheme, output: 'both' })).toBe(false);
    expect(isScheme(null)).toBe(false);
    expect(isScheme([])).toBe(false);
  });
});
