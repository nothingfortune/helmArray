// A game's data, kept by the store (docs/plans/02-architecture.md, *Storage*): `games/<id>.json`
// holds a game you added, or your copy of a built-in game under the built-in's id. Yours wins,
// and dropping it brings helmArray's back.

import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILT_IN_DEVICES, MIGRATIONS, resolve } from '@helmarray/core';
import type { Game } from '@helmarray/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_MS, DataStore, ON_GAME_DELETED } from './store';
import type { StoreProblem } from './store';

const SKIFF: Game = {
  id: 'skiff',
  name: 'Skiff',
  steamAppId: 4100,
  modes: [{ id: 'ship', name: 'Ship' }],
  actions: [
    {
      id: 'boost',
      name: 'Boost',
      mode: 'ship',
      role: 'movement',
      required: true,
      native: { key: { kind: 'key', code: 'LShift' }, pad: 'A' },
    },
  ],
};

/** A game added by hand: a name, one mode, one action. */
const ROVER: Game = {
  id: 'rover',
  name: 'Rover',
  modes: [{ id: 'default', name: 'Default' }],
  actions: [
    {
      id: 'jump',
      name: 'Jump',
      mode: 'default',
      role: 'movement',
      required: false,
      native: { key: { kind: 'key', code: 'Space' } },
    },
  ],
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'helm-store-games-'));
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

let counter = 0;
async function openStore() {
  const problems: StoreProblem[] = [];
  const data = await DataStore.open({
    root,
    builtInGames: [SKIFF],
    onProblem: (problem) => problems.push(problem),
    newId: () => `id${++counter}`,
  });
  return { data, problems };
}

const file = (id: string) => join(root, 'games', `${id}.json`);
const readJson = async (id: string) =>
  JSON.parse(await readFile(file(id), 'utf8')) as Record<string, unknown>;
const exists = (id: string) =>
  stat(file(id)).then(
    () => true,
    () => false,
  );
const listed = async (data: DataStore) =>
  (await data.listGames()).map((e) => [e.game.id, e.game.name, e.builtIn, e.edited === true]);

describe('a game added by hand', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  it('is listed at once, after the built-in games', async () => {
    const { data } = await openStore();
    data.saveGame(ROVER);
    expect(await listed(data)).toEqual([
      ['skiff', 'Skiff', true, false],
      ['rover', 'Rover', false, false],
    ]);
  });

  it('is written a moment after the last change, with its schema version', async () => {
    const { data } = await openStore();
    data.saveGame(ROVER);
    data.saveGame({ ...ROVER, name: 'Rover 2' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    expect(await exists('rover')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(async () =>
      expect(await readJson('rover')).toEqual({ schemaVersion: 1, ...ROVER, name: 'Rover 2' }),
    );
  });

  it('is written as it was handed in, whatever is done to it afterwards', async () => {
    const { data } = await openStore();
    const game = structuredClone(ROVER);
    data.saveGame(game);
    game.name = 'Changed after';
    await data.flush();
    expect((await readJson('rover'))['name']).toBe('Rover');
  });

  it('is written by flush, as on quit', async () => {
    const { data } = await openStore();
    data.saveGame(ROVER);
    await data.flush();
    expect((await readJson('rover'))['id']).toBe('rover');
  });

  it('is read back by the next run', async () => {
    const first = await openStore();
    first.data.saveGame(ROVER);
    await first.data.flush();
    const { data } = await openStore();
    expect((await data.listGames()).find((e) => e.game.id === 'rover')?.game).toEqual(ROVER);
  });

  it('can be given a scheme before it is written', async () => {
    const { data } = await openStore();
    data.saveGame(ROVER);
    const scheme = await data.createSchemeFromPreset('rover', 'keys');
    expect(scheme.gameId).toBe('rover');
  });

  it('is refused, with the reason in one sentence, when something in it is wrong', async () => {
    const { data } = await openStore();
    const broken: Game = {
      ...ROVER,
      actions: [{ ...(ROVER.actions[0] as Game['actions'][number]), mode: 'ship' }],
    };
    expect(() => data.saveGame(broken)).toThrow("Jump is in a mode the game doesn't have.");
    await data.flush();
    expect([await exists('rover'), await listed(data)]).toEqual([
      false,
      [['skiff', 'Skiff', true, false]],
    ]);
  });

  it.each(['..', 'con', '', 'a/b'])('is refused under the id %j: it names a file', async (id) => {
    const { data } = await openStore();
    expect(() => data.saveGame({ ...ROVER, id })).toThrow(
      "This game's id can't be used as a file name.",
    );
  });

  it('is deleted: no longer listed, and its file is gone', async () => {
    const { data } = await openStore();
    data.saveGame(ROVER);
    await data.flush();
    await data.deleteGame('rover');
    expect([await exists('rover'), await listed(data)]).toEqual([
      false,
      [['skiff', 'Skiff', true, false]],
    ]);
  });

  it('is deleted before its autosave: the waiting write never happens', async () => {
    const { data } = await openStore();
    data.saveGame(ROVER);
    await data.deleteGame('rover');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
    await data.flush();
    expect([await exists('rover'), (await data.listGames()).length]).toEqual([false, 1]);
  });

  it('is deleted while its write is under way: the delete comes after it', async () => {
    const { data } = await openStore();
    data.saveGame(ROVER);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS); // the write is queued now
    await data.deleteGame('rover');
    await data.flush();
    expect(await exists('rover')).toBe(false);
  });

  // A game deleted once kept its schemes, and the next game under its id took them over silently
  // (Codex on #95): a game you delete now takes its schemes with it.
  it('takes its schemes with it: added again under its id, it has none', async () => {
    const { data } = await openStore();
    data.saveGame(ROVER);
    const scheme = await data.createSchemeFromPreset('rover', 'keys');
    await data.flush();
    await data.deleteGame('rover');
    data.saveGame(ROVER);
    expect([
      await data.listSchemes('rover'),
      await stat(join(root, 'schemes', `${scheme.id}.json`)).then(
        () => true,
        () => false,
      ),
    ]).toEqual([[], false]);
  });

  it('takes with it the plan it was applied with, and what it holds', async () => {
    const { data } = await openStore();
    data.saveGame(ROVER);
    const scheme = await data.createSchemeFromPreset('rover', 'keys');
    const plan = resolve(scheme, ROVER, BUILT_IN_DEVICES);
    await data.saveApplied(scheme.id, plan);
    await data.deleteGame('rover');
    expect([await data.lastApplied('rover'), await readdir(join(root, 'applied'))]).toEqual([
      null,
      [],
    ]);
  });

  it('keeps a built-in game’s schemes when your copy is dropped: the game is still there', async () => {
    const { data } = await openStore();
    data.saveGame({ ...SKIFF, name: 'Mine' });
    const scheme = await data.createSchemeFromPreset('skiff', 'keys');
    await data.deleteGame('skiff');
    expect((await data.listSchemes('skiff')).map((s) => s.id)).toEqual([scheme.id]);
  });
});

describe('your copy of a built-in game', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  const mine: Game = { ...SKIFF, name: 'My Skiff' };

  it('takes the built-in game’s place in the list, marked as edited', async () => {
    const { data } = await openStore();
    data.saveGame(mine);
    expect(await listed(data)).toEqual([['skiff', 'My Skiff', true, true]]);
  });

  it('is saved under the built-in game’s id, and wins on the next run', async () => {
    const first = await openStore();
    first.data.saveGame(mine);
    await first.data.flush();
    const { data, problems } = await openStore();
    expect([await listed(data), problems]).toEqual([[['skiff', 'My Skiff', true, true]], []]);
  });

  it('is what a new scheme is made from', async () => {
    const { data } = await openStore();
    data.saveGame({
      ...SKIFF,
      actions: [
        ...SKIFF.actions,
        { ...(SKIFF.actions[0] as Game['actions'][number]), id: 'brake', name: 'Brake' },
      ],
    });
    const scheme = await data.createSchemeFromPreset('skiff', 'xbox');
    expect(Object.values(scheme.map['ship'] ?? {}).map((p) => p.tap)).toEqual(['boost']);
  });

  it('is dropped by "back to helmArray’s": the built-in game comes back, and the file goes', async () => {
    const { data } = await openStore();
    data.saveGame(mine);
    await data.flush();
    await data.deleteGame('skiff');
    expect([await exists('skiff'), await listed(data)]).toEqual([
      false,
      [['skiff', 'Skiff', true, false]],
    ]);
  });

  it('is dropped before its autosave: the waiting write never happens', async () => {
    const { data } = await openStore();
    data.saveGame(mine);
    await data.deleteGame('skiff');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
    await data.flush();
    expect([await exists('skiff'), await listed(data)]).toEqual([
      false,
      [['skiff', 'Skiff', true, false]],
    ]);
  });

  it('leaves the built-in game itself as it was', async () => {
    const before = structuredClone(SKIFF);
    const { data } = await openStore();
    data.saveGame(mine);
    await data.flush();
    expect(SKIFF).toEqual(before);
  });
});

describe('deleting what is not there', () => {
  it('says there is nothing of yours to drop for a built-in game you never changed', async () => {
    const { data } = await openStore();
    await expect(data.deleteGame('skiff')).rejects.toThrow(
      "You haven't changed this game: it is already helmArray's.",
    );
  });

  it('says there is no such game for an id nobody has', async () => {
    const { data } = await openStore();
    await expect(data.deleteGame('nobody')).rejects.toThrow('There is no such game.');
  });

  it('says there is no such game for an id that can’t be a file name', async () => {
    const { data } = await openStore();
    await expect(data.deleteGame('../settings')).rejects.toThrow('There is no such game.');
  });
});

describe('a game file that is wrong inside', () => {
  it('is reported, with what is wrong, and left out of the list', async () => {
    const { data, problems } = await openStore();
    await mkdir(join(root, 'games'), { recursive: true });
    const bad = { ...ROVER, modes: [{ id: 'constructor', name: 'Ship' }], actions: [] };
    await writeFile(file('rover'), JSON.stringify({ schemaVersion: 1, ...bad }));
    expect([await listed(data), problems]).toEqual([
      [['skiff', 'Skiff', true, false]],
      [
        {
          file: 'games/rover.json',
          message: "This game can't be used: the mode Ship has an id helmArray can't use.",
        },
      ],
    ]);
  });

  it('is never your copy: the built-in game stays', async () => {
    const { data } = await openStore();
    await mkdir(join(root, 'games'), { recursive: true });
    await writeFile(file('skiff'), JSON.stringify({ schemaVersion: 1, ...SKIFF, name: '' }));
    expect(await listed(data)).toEqual([['skiff', 'Skiff', true, false]]);
  });
});

describe('deleting the active game', () => {
  it('leaves no game active when it was a game added by hand, and forgets its scheme', async () => {
    const { data } = await openStore();
    data.saveGame(ROVER);
    const scheme = await data.createSchemeFromPreset('rover', 'keys');
    await data.setActive('rover', scheme.id);
    await data.deleteGame('rover');
    const reopened = await openStore();
    expect([data.active(), data.activeSchemeOf('rover'), reopened.data.active()]).toEqual([
      { gameId: null, schemeId: null },
      null,
      { gameId: null, schemeId: null },
    ]);
  });

  it('forgets the scheme picked for a game added by hand that wasn’t the active one', async () => {
    const { data } = await openStore();
    data.saveGame(ROVER);
    const scheme = await data.createSchemeFromPreset('rover', 'keys');
    await data.setActive('rover', scheme.id);
    await data.setActive('skiff', null);
    await data.deleteGame('rover');
    expect([data.active(), data.activeSchemeOf('rover')]).toEqual([
      { gameId: 'skiff', schemeId: null },
      null,
    ]);
  });

  it('keeps the built-in game active when your copy is dropped: the game is still there', async () => {
    const { data } = await openStore();
    data.saveGame({ ...SKIFF, name: 'My Skiff' });
    const scheme = await data.createSchemeFromPreset('skiff', 'keys');
    await data.setActive('skiff', scheme.id);
    await data.deleteGame('skiff');
    expect(data.active()).toEqual({ gameId: 'skiff', schemeId: scheme.id });
  });
});

// A game read from its own file and then deleted stays deleted: the store keeps, in the settings,
// the ids of those games, and the Library doesn't find them from their file again until each is set
// up from its tile (docs/plans/02-architecture.md, *Harvesting a game's defaults*).
describe('the games read from their file that were deleted', () => {
  it('are none to start with', async () => {
    const { data } = await openStore();
    expect(data.dismissedFiles()).toEqual([]);
  });

  it('are kept, each once, and still there when the app opens again', async () => {
    const { data } = await openStore();
    await data.dismissFile('everspace2');
    await data.dismissFile('everspace2');
    await data.dismissFile('elite-dangerous');
    const reopened = await openStore();
    expect([data.dismissedFiles(), reopened.data.dismissedFiles()]).toEqual([
      ['everspace2', 'elite-dangerous'],
      ['everspace2', 'elite-dangerous'],
    ]);
  });

  it('let one go when it is set up again, and only that one', async () => {
    const { data } = await openStore();
    await data.dismissFile('everspace2');
    await data.dismissFile('elite-dangerous');
    await data.restoreFile('everspace2');
    const reopened = await openStore();
    expect([data.dismissedFiles(), reopened.data.dismissedFiles()]).toEqual([
      ['elite-dangerous'],
      ['elite-dangerous'],
    ]);
  });

  it('write nothing when nothing changes', async () => {
    const { data } = await openStore();
    await data.restoreFile('everspace2');
    await expect(stat(join(root, 'settings.json'))).rejects.toThrow('ENOENT');
  });

  it('stay through deleting a game, making another active, and deleting a scheme', async () => {
    const { data } = await openStore();
    data.saveGame(ROVER);
    const scheme = await data.createSchemeFromPreset('rover', 'keys');
    await data.setActive('rover', scheme.id);
    await data.dismissFile('everspace2');
    await data.setActive('skiff', null);
    await data.setActive('rover', scheme.id);
    await data.deleteScheme(scheme.id);
    await data.deleteGame('rover');
    const reopened = await openStore();
    expect([data.dismissedFiles(), reopened.data.dismissedFiles()]).toEqual([
      ['everspace2'],
      ['everspace2'],
    ]);
  });

  it('make a settings file whose list is not of ids one the store reports, not one it reads', async () => {
    await writeFile(
      join(root, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, activeGameId: null, activeScheme: {}, dismissed: [7] }),
    );
    const { data, problems } = await openStore();
    expect([data.dismissedFiles(), problems.map((p) => p.file)]).toEqual([[], ['settings.json']]);
  });

  it('make a settings file whose list has one id that could never be a game one the store reports', async () => {
    await writeFile(
      join(root, 'settings.json'),
      JSON.stringify({
        schemaVersion: 1,
        activeGameId: null,
        activeScheme: {},
        dismissed: ['everspace2', '../x'],
      }),
    );
    const { data, problems } = await openStore();
    expect([data.dismissedFiles(), problems.map((p) => p.file)]).toEqual([[], ['settings.json']]);
  });

  it('are left as they were, and the change refused, when a newer helmArray wrote the settings', async () => {
    const text = JSON.stringify({ schemaVersion: 99, activeGameId: null, activeScheme: {} });
    await writeFile(join(root, 'settings.json'), text);
    const { data } = await openStore();
    await expect(data.dismissFile('everspace2')).rejects.toThrow('newer helmArray');
    expect([data.dismissedFiles(), await readFile(join(root, 'settings.json'), 'utf8')]).toEqual([
      [],
      text,
    ]);
  });

  it('refuse an id that could never be a game', async () => {
    const { data } = await openStore();
    await expect(data.dismissFile('../x')).rejects.toThrow('There is no such game.');
  });
});

// Everything the store keeps per game is listed in one place (`ON_GAME_DELETED`), so a new kind of
// per-game data can't be forgotten when a game added by hand is deleted, and a game added later
// under its id never inherits any of it.
describe('everything kept per game goes with a game added by hand', () => {
  /** Every file under the data folder, with its text. A file keyed by the game names it in its
   * name (a scheme's id starts with the game's) or in its text. */
  async function files(dir = root, prefix = ''): Promise<[string, string][]> {
    const out: [string, string][] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) out.push(...(await files(join(dir, entry.name), `${name}/`)));
      else out.push([name, await readFile(join(dir, entry.name), 'utf8')]);
    }
    return out;
  }

  it('lists what deleting a game does for every kind the store keeps', () => {
    expect(Object.keys(ON_GAME_DELETED).sort()).toEqual(Object.keys(MIGRATIONS).sort());
  });

  it('leaves nothing keyed by its id on disk but the units’ history, marked as of a deleted game', async () => {
    const { data } = await openStore();
    data.saveGame(ROVER);
    await data.flush();
    const scheme = await data.createSchemeFromPreset('rover', 'keys');
    const plan = resolve(scheme, ROVER, BUILT_IN_DEVICES);
    await data.setActive('rover', scheme.id);
    await data.saveApplied(scheme.id, plan);
    await data.settleBaseline('rover', plan.gameBindings);
    await data.recordApply(
      plan,
      [
        { hand: 'left', status: 'applied' },
        { hand: 'right', status: 'applied' },
      ],
      {
        schemeId: scheme.id,
        gameId: 'rover',
        schemeName: scheme.name,
        devices: scheme.devices,
        output: scheme.output,
        at: 1,
      },
    );
    await data.flush();
    // Every kind was written for it: the guard below sees each one.
    const keyed = ([f, text]: [string, string]) => f.includes('rover') || text.includes('rover');
    const before = (await files()).filter(keyed).map(([f]) => f);
    expect(before.sort()).toEqual(
      [
        'games/rover.json',
        `schemes/${scheme.id}.json`,
        `applied/${scheme.id}.json`,
        'settings.json',
        'sheets.json',
        'units.json',
      ].sort(),
    );

    await data.deleteGame('rover');
    await data.flush();
    const left = (await files()).filter(keyed);
    // units.json is history: what each unit was last written with, which is still true. It is kept,
    // marked as of a deleted game, so a game added later under the id is never taken for it.
    expect(left.map(([f]) => f)).toEqual(['units.json']);
    const units = JSON.parse(left[0]?.[1] ?? '{}') as Record<string, { gameDeleted?: boolean }>;
    expect([units['left']?.gameDeleted, units['right']?.gameDeleted]).toEqual([true, true]);
  });
});
