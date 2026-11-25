// A read that gives a game its file format (`saveFileRead`): every scheme of the game made before,
// which the presets left with `writeGameFile` off, writes the game's file from then on (core's
// `writingFile`), in the same write as the read, under the same rules: every scheme file checked
// first, one it can't rewrite refusing the whole read, and a write that fails part way put back.

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILT_IN_DEVICES, mergeHarvest, resolve } from '@helmarray/core';
import type { Game, Scheme } from '@helmarray/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataStore } from './store';

const key = (code: 'G' | 'H' | 'M') => ({ kind: 'key' as const, code });

/** A game typed in on the Game screen, before its file was read: no format. */
const TYPED: Game = {
  id: 'es2-typed',
  name: 'Everspace 2',
  steamAppId: 1128920,
  modes: [{ id: 'default', name: 'Default' }],
  actions: [
    { id: 'boost', name: 'Boost', mode: 'default', required: true, native: { key: key('G') } },
    { id: 'wave', name: 'Wave', mode: 'default', required: false, native: { key: key('H') } },
  ],
};

/** Its file: an action of its own, none of yours by name, so the read moves no id. */
const FILE: Game = {
  id: 'es2-typed',
  name: 'Everspace 2',
  modes: [{ id: 'flight', name: 'Flight' }],
  actions: [{ id: 'Map', name: 'Map', mode: 'flight', required: false, native: { key: key('M') } }],
  file: { format: 'unreal-ini' },
};
/** Its file with Boost in it too: the read moves your Boost to the file's id. */
const FILE_BOOST: Game = {
  ...FILE,
  actions: [
    ...FILE.actions,
    { id: 'Boost', name: 'Boost', mode: 'flight', required: true, native: { key: key('G') } },
  ],
};

let root: string;
let n = 0;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'helm-store-file-on-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

let badIds = false;
beforeEach(() => {
  badIds = false;
});
const open = () =>
  DataStore.open({
    root,
    builtInGames: [],
    newId: () => (badIds ? 'no/such/folder' : `id${++n}`),
  });

/** Every file under the data folder, with its text; a folder where a file was, as a folder. */
async function files(dir = root, prefix = ''): Promise<[string, string][]> {
  const out: [string, string][] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory() && name.endsWith('.json')) out.push([name, '(folder)']);
    else if (entry.isDirectory()) out.push(...(await files(join(dir, entry.name), `${name}/`)));
    else out.push([name, await readFile(join(dir, entry.name), 'utf8')]);
  }
  return out.sort(([a], [b]) => a.localeCompare(b));
}

const onDisk = async (id: string): Promise<Scheme> =>
  JSON.parse(await readFile(join(root, 'schemes', `${id}.json`), 'utf8')) as Scheme;

/** The typed game saved, two schemes of its own keys made before the read, and another game's. */
async function madeBefore() {
  const data = await open();
  data.saveGame(TYPED);
  const other: Game = { ...TYPED, id: 'other', steamAppId: 1 };
  data.saveGame(other);
  await data.flush();
  const first = await data.createSchemeFromPreset(TYPED.id, 'keys');
  const second = await data.createSchemeFromPreset(TYPED.id, 'xbox');
  const others = await data.createSchemeFromPreset('other', 'keys');
  return { data, first, second, others };
}

/** What each unit button sends, by control. */
const pins = (scheme: Scheme, game: Game) => {
  const plan = resolve(scheme, game, BUILT_IN_DEVICES);
  return [...(plan.units.left?.pins ?? []), ...(plan.units.right?.pins ?? [])].map((p) => [
    p.control,
    p.presses,
  ]);
};

describe("a read that gives a game its file format: the game's schemes write its file from then on", () => {
  it('turns it on for each scheme of the game, and no other game’s, when nothing moved', async () => {
    const { data, first, second, others } = await madeBefore();
    const { game, moves } = mergeHarvest(TYPED, FILE);
    await data.saveFileRead(game, moves);
    expect({
      moves: moves.length,
      before: [first.writeGameFile, second.writeGameFile, others.writeGameFile],
      after: [
        (await onDisk(first.id)).writeGameFile,
        (await onDisk(second.id)).writeGameFile,
        (await onDisk(others.id)).writeGameFile,
      ],
    }).toEqual({ moves: 0, before: [false, false, false], after: [true, true, false] });
  });

  it('writes the game with its format at once, with the schemes', async () => {
    const { data } = await madeBefore();
    const { game, moves } = mergeHarvest(TYPED, FILE);
    await data.saveFileRead(game, moves);
    const saved = JSON.parse(await readFile(join(root, 'games', 'es2-typed.json'), 'utf8')) as Game;
    expect(saved.file).toEqual({ format: 'unreal-ini' });
  });

  it('keeps what each button sends: the keys it deals now go in its ledger', async () => {
    const { data, first } = await madeBefore();
    const { game, moves } = mergeHarvest(TYPED, FILE);
    const before = pins(first, game);
    await data.saveFileRead(game, moves);
    const after = await onDisk(first.id);
    expect({ pins: pins(after, game), ledger: Object.keys(after.ledger).length > 0 }).toEqual({
      pins: before,
      ledger: true,
    });
  });

  it('turns it on and moves the ids together, when the read moves them', async () => {
    const { data, first } = await madeBefore();
    const { game, moves } = mergeHarvest(TYPED, FILE_BOOST);
    await data.saveFileRead(game, moves);
    const after = await onDisk(first.id);
    expect({
      moves: moves.map((m) => [m.action, m.to]),
      writes: after.writeGameFile,
      oldId: JSON.stringify(after).includes('"boost"'),
    }).toEqual({ moves: [['boost', 'Boost']], writes: true, oldId: false });
  });

  it('takes in an edit of a scheme still waiting to be written', async () => {
    const { data, first } = await madeBefore();
    data.saveScheme({ ...first, name: 'Renamed' });
    const { game, moves } = mergeHarvest(TYPED, FILE);
    await data.saveFileRead(game, moves);
    await data.flush();
    const after = await onDisk(first.id);
    expect([after.name, after.writeGameFile]).toEqual(['Renamed', true]);
  });

  it('turns it on for a scheme left off by a read before this one, when the game is read again', async () => {
    const { data, first } = await madeBefore();
    // An earlier helmArray saved the read's format and left the scheme as it was.
    data.saveGame(mergeHarvest(TYPED, FILE).game);
    await data.flush();
    const read = await data.listGames().then((g) => g.find((e) => e.game.id === TYPED.id)?.game);
    if (read === undefined) throw new Error('The game is gone.');
    const { game, moves } = mergeHarvest(read, FILE);
    await data.saveFileRead(game, moves);
    expect([read.file, (await onDisk(first.id)).writeGameFile]).toEqual([
      { format: 'unreal-ini' },
      true,
    ]);
  });

  it('rewrites no scheme that writes the file already', async () => {
    const { data, first } = await madeBefore();
    const { game, moves } = mergeHarvest(TYPED, FILE);
    await data.saveFileRead(game, moves);
    const once = await readFile(join(root, 'schemes', `${first.id}.json`), 'utf8');
    await data.saveFileRead(mergeHarvest(game, FILE).game, []);
    expect(await readFile(join(root, 'schemes', `${first.id}.json`), 'utf8')).toBe(once);
  });

  it('is a plain save, touching no scheme, for a game the read gives no format', async () => {
    const { data, first } = await madeBefore();
    await data.saveFileRead({ ...TYPED, name: 'Renamed' }, []);
    await data.flush();
    expect((await onDisk(first.id)).writeGameFile).toBe(false);
  });
});

describe('a read that gives a game its file format, when a scheme file of the game cannot be rewritten', () => {
  it('is refused, writing nothing, for a scheme a newer helmArray saved', async () => {
    const { data, first } = await madeBefore();
    const path = join(root, 'schemes', `${first.id}.json`);
    const doc = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    await writeFile(path, JSON.stringify({ ...doc, schemaVersion: 999 }));
    const before = await files();
    const { game, moves } = mergeHarvest(TYPED, FILE);
    await expect(data.saveFileRead(game, moves)).rejects.toThrow(
      `schemes/${first.id}.json was left as it was: This scheme was saved by a newer helmArray. Update helmArray to open it.`,
    );
    expect(await files()).toEqual(before);
  });

  it("is refused, writing nothing, for a scheme the disk won't give up", async () => {
    const { data, first } = await madeBefore();
    const path = join(root, 'schemes', `${first.id}.json`);
    await rm(path);
    await mkdir(path);
    const before = await files();
    const { game, moves } = mergeHarvest(TYPED, FILE);
    await expect(data.saveFileRead(game, moves)).rejects.toThrow(
      `schemes/${first.id}.json was left as it was`,
    );
    expect(await files()).toEqual(before);
  });

  it('puts back every scheme it turned on when a write fails part way', async () => {
    const { data } = await madeBefore();
    // The game's own file is damaged, and keeping it aside fails: the game, written last, fails.
    await writeFile(join(root, 'games', 'es2-typed.json'), '{ not json');
    badIds = true;
    const before = await files();
    const { game, moves } = mergeHarvest(TYPED, FILE);
    await expect(data.saveFileRead(game, moves)).rejects.toThrow(
      "games/es2-typed.json is damaged and couldn't be set aside",
    );
    expect(await files()).toEqual(before);
  });

  it('passes over a damaged scheme file', async () => {
    const { data, first } = await madeBefore();
    await writeFile(join(root, 'schemes', 'damaged.json'), '{ not json');
    const { game, moves } = mergeHarvest(TYPED, FILE);
    await data.saveFileRead(game, moves);
    expect((await onDisk(first.id)).writeGameFile).toBe(true);
  });
});
