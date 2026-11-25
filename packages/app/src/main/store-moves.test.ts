// A read of a game's own file in which actions you typed in by hand took the file's ids (core's
// mergeHarvest, `moves`): the store writes the game and every file that names an old id in one go
// (`saveFileRead`, `ON_ACTION_MOVED`), or nothing at all.

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILT_IN_DEVICES, MIGRATIONS, mergeHarvest, resolve } from '@helmarray/core';
import type { Action, Game, Scheme } from '@helmarray/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataStore, ON_ACTION_MOVED } from './store';
import type { StoreProblem } from './store';

const key = (code: 'G' | 'H' | 'F13' | 'LShift') => ({ kind: 'key' as const, code });

/** A game typed in on the Game screen: one mode, `default`, two actions with keys. */
const TYPED: Game = {
  id: 'es2-typed',
  name: 'Everspace 2',
  steamAppId: 1128920,
  modes: [{ id: 'default', name: 'Default' }],
  actions: [
    { id: 'boost', name: 'Boost', mode: 'default', required: false, native: { key: key('G') } },
    { id: 'wave', name: 'Wave', mode: 'default', required: false, native: { key: key('H') } },
  ],
};

const fileAction = (over: Partial<Action> & Pick<Action, 'id' | 'name' | 'mode'>): Action => ({
  required: false,
  role: 'movement',
  ...over,
});

/** The game's file, as its adapter harvests it: Boost in Flight. */
const FILE: Game = {
  id: 'es2-typed',
  name: 'Everspace 2',
  modes: [
    { id: 'flight', name: 'Flight' },
    { id: 'menus', name: 'Menus' },
  ],
  actions: [
    fileAction({ id: 'Boost', name: 'Boost', mode: 'flight', native: { key: key('LShift') } }),
    fileAction({ id: 'Map', name: 'Map', mode: 'menus', native: { key: key('F13') } }),
  ],
  file: { format: 'unreal-ini' },
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'helm-store-moves-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

let counter = 0;
async function openStore() {
  const problems: StoreProblem[] = [];
  const data = await DataStore.open({
    root,
    builtInGames: [],
    onProblem: (problem) => problems.push(problem),
    newId: () => `id${++counter}`,
  });
  return { data, problems };
}

/** Every file under the data folder, with its text. */
async function files(dir = root, prefix = ''): Promise<[string, string][]> {
  const out: [string, string][] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) out.push(...(await files(join(dir, entry.name), `${name}/`)));
    else out.push([name, await readFile(join(dir, entry.name), 'utf8')]);
  }
  return out.sort(([a], [b]) => a.localeCompare(b));
}

/**
 * The typed game saved, a scheme of its own keys made, applied and held, and kept as the game's own
 * once deleted (`<game>.held`), with a second scheme left: every kind that can name an action.
 */
async function used(data: DataStore): Promise<{ kept: Scheme; held: Scheme }> {
  data.saveGame(TYPED);
  await data.flush();
  const kept = await data.createSchemeFromPreset(TYPED.id, 'keys');
  await data.saveApplied(kept.id, resolve(kept, TYPED, BUILT_IN_DEVICES));
  // Applied a moment later, so it is the scheme applied last.
  await new Promise((done) => setTimeout(done, 20));
  const held = await data.createSchemeFromPreset(TYPED.id, 'keys');
  const plan = resolve(held, TYPED, BUILT_IN_DEVICES);
  await data.saveApplied(held.id, plan);
  await data.settleBaseline(TYPED.id, plan.gameBindings);
  // The scheme applied last is deleted: its plan is kept as what the game holds.
  await data.deleteScheme(held.id);
  await data.flush();
  return { kept, held };
}

const merged = (game: Game = TYPED) => mergeHarvest(game, FILE);

describe('what a move does to every kind the store keeps', () => {
  it('is listed for every kind', () => {
    expect(Object.keys(ON_ACTION_MOVED).sort()).toEqual(Object.keys(MIGRATIONS).sort());
  });
});

describe("a read of the game's file in which your actions took the file's ids", () => {
  it('leaves no file naming an old id, once something named each one', async () => {
    const { data } = await openStore();
    const { kept } = await used(data);
    const before = (await files()).filter(([, text]) => text.includes('"boost"')).map(([f]) => f);
    const { game, moves } = merged();
    await data.saveFileRead(game, moves);
    await data.flush();
    const after = (await files()).filter(([, text]) => text.includes('"boost"')).map(([f]) => f);
    expect({ before, after }).toEqual({
      before: [
        `applied/${kept.id}.json`,
        'applied/es2-typed.held.json',
        'games/es2-typed.json',
        `schemes/${kept.id}.json`,
        'sheets.json',
      ].sort((a, b) => a.localeCompare(b)),
      after: [],
    });
  });

  it("puts each placement under the file's id, in the file's mode", async () => {
    const { data } = await openStore();
    const { kept } = await used(data);
    const placedBefore = Object.entries(kept.map['default'] ?? {}).find(
      ([, presses]) => presses.tap === 'boost',
    )?.[0];
    const { game, moves } = merged();
    await data.saveFileRead(game, moves);
    const scheme = await data.getScheme(kept.id);
    expect([placedBefore !== undefined, scheme?.map['flight']?.[placedBefore ?? '']?.tap]).toEqual([
      true,
      'Boost',
    ]);
  });

  it("moves what the game holds, and each applied plan's game bindings", async () => {
    const { data } = await openStore();
    const { kept } = await used(data);
    const { game, moves } = merged();
    await data.saveFileRead(game, moves);
    const held = await data.heldBindings(TYPED.id);
    const applied = await data.getApplied(kept.id);
    const boostRows = (rows: readonly { action: string; mode: string }[] | null | undefined) => [
      ...new Set((rows ?? []).filter((r) => r.action === 'Boost').map((r) => r.mode)),
    ];
    expect([boostRows(held), boostRows(applied?.gameBindings)]).toEqual([['flight'], ['flight']]);
  });

  it('saves the game as the read left it, at once', async () => {
    const { data } = await openStore();
    await used(data);
    const { game, moves } = merged();
    await data.saveFileRead(game, moves);
    const saved = JSON.parse(await readFile(join(root, 'games', 'es2-typed.json'), 'utf8')) as Game;
    expect({ ...saved, schemaVersion: undefined }).toEqual({ ...game, schemaVersion: undefined });
  });

  it('takes an edit of a scheme still waiting to be written, so it never puts the old id back', async () => {
    const { data } = await openStore();
    const { kept } = await used(data);
    data.saveScheme({ ...kept, name: 'Renamed' });
    const { game, moves } = merged();
    await data.saveFileRead(game, moves);
    await data.flush();
    const onDisk = JSON.parse(
      await readFile(join(root, 'schemes', `${kept.id}.json`), 'utf8'),
    ) as Scheme;
    expect([onDisk.name, JSON.stringify(onDisk.map).includes('"boost"')]).toEqual([
      'Renamed',
      false,
    ]);
  });

  it('takes an edit of the game still waiting: the read is what is written', async () => {
    const { data } = await openStore();
    await used(data);
    data.saveGame({ ...TYPED, name: 'Typed' });
    const { game, moves } = merged();
    await data.saveFileRead(game, moves);
    await data.flush();
    const saved = JSON.parse(await readFile(join(root, 'games', 'es2-typed.json'), 'utf8')) as Game;
    expect(saved.name).toBe('Everspace 2');
  });

  it('writes nothing at all when a file it must change was saved by a newer helmArray', async () => {
    const { data, problems } = await openStore();
    await used(data);
    await writeFile(join(root, 'sheets.json'), JSON.stringify({ schemaVersion: 999, games: [] }));
    const before = await files();
    const { game, moves } = merged();
    await expect(data.saveFileRead(game, moves)).rejects.toThrow(
      'sheets.json was left as it was: This list of bindings to set in the game was saved by a newer helmArray. Update helmArray to open it.',
    );
    expect([await files(), problems.map((p) => p.file)]).toEqual([before, ['sheets.json']]);
  });

  it('refuses a game core refuses, writing nothing', async () => {
    const { data } = await openStore();
    await used(data);
    const before = await files();
    const { game, moves } = merged();
    await expect(data.saveFileRead({ ...game, modes: [] }, moves)).rejects.toThrow(
      'The game needs at least one mode.',
    );
    expect(await files()).toEqual(before);
  });

  it("refuses an id that can't be a file name", async () => {
    const { data } = await openStore();
    const { game, moves } = merged();
    await expect(data.saveFileRead({ ...game, id: '../x' }, moves)).rejects.toThrow(
      "This game's id can't be used as a file name.",
    );
  });

  it('is a plain save when nothing moved', async () => {
    const { data } = await openStore();
    await data.saveFileRead(TYPED, []);
    await data.flush();
    expect((await data.listGames()).map((e) => e.game.id)).toEqual(['es2-typed']);
  });

  it('changes nothing the second time', async () => {
    const { data } = await openStore();
    await used(data);
    const { game, moves } = merged();
    await data.saveFileRead(game, moves);
    await data.flush();
    const once = await files();
    await data.saveFileRead(game, moves);
    await data.flush();
    expect(await files()).toEqual(once);
  });

  it('leaves the other games alone', async () => {
    const { data } = await openStore();
    await used(data);
    const other: Game = { ...TYPED, id: 'other', steamAppId: 1 };
    data.saveGame(other);
    await data.flush();
    const scheme = await data.createSchemeFromPreset('other', 'keys');
    await data.settleBaseline('other', resolve(scheme, other, BUILT_IN_DEVICES).gameBindings);
    await data.flush();
    const { game, moves } = merged();
    await data.saveFileRead(game, moves);
    const mentions = (await files())
      .filter(
        ([f, text]) => text.includes('"boost"') && (f.includes('other') || f === 'sheets.json'),
      )
      .map(([f]) => f);
    expect(mentions).toEqual(['games/other.json', `schemes/${scheme.id}.json`, 'sheets.json']);
  });
});

describe('a read whose game has nothing else on disk yet', () => {
  it('writes only the game', async () => {
    const { data } = await openStore();
    await mkdir(join(root, 'games'), { recursive: true });
    const { game, moves } = merged();
    await data.saveFileRead(game, moves);
    expect((await files()).map(([f]) => f)).toEqual(['games/es2-typed.json']);
  });
});
