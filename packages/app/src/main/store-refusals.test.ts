// A change that follows a game into every kind of file the store keeps (a read of the game's file
// whose actions took the file's ids, `saveFileRead`; deleting a game added by hand, `deleteGame`)
// must see every file it may have to change. One it can't read (the disk won't give it up) or that
// a newer helmArray saved may hold the game's ids, and would name them again once it can be read:
// the whole change is refused, and every file is left as it was. One for each kind, each way.

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILT_IN_DEVICES, mergeHarvest, resolve } from '@helmarray/core';
import type { Game, Scheme } from '@helmarray/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataStore, ON_ACTION_MOVED, ON_GAME_DELETED } from './store';

const key = (code: 'G' | 'H' | 'LShift') => ({ kind: 'key' as const, code });

/** A game typed in on the Game screen: one mode, `default`. */
const TYPED: Game = {
  id: 'es2-typed',
  name: 'Everspace 2',
  steamAppId: 1128920,
  modes: [{ id: 'default', name: 'Default' }],
  actions: [
    { id: 'jump', name: 'Jump', mode: 'default', required: false, native: { key: key('G') } },
    { id: 'wave', name: 'Wave', mode: 'default', required: false, native: { key: key('H') } },
  ],
};

/** Its file: Jump in Flight. */
const FILE: Game = {
  id: 'es2-typed',
  name: 'Everspace 2',
  modes: [{ id: 'flight', name: 'Flight' }],
  actions: [
    {
      id: 'Jump',
      name: 'Jump',
      mode: 'flight',
      required: false,
      role: 'movement',
      native: { key: key('LShift') },
    },
  ],
  file: { format: 'unreal-ini' },
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'helm-store-refusals-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
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

/**
 * The typed game with a file of every kind written for it: its own, a scheme (`kept`) with its
 * applied plan, the plan it holds from a scheme deleted since (`<game>.held`), the settings, what it
 * holds (sheets.json) and what the units hold.
 */
async function everyKind(): Promise<{ data: DataStore; kept: Scheme }> {
  let n = 0;
  const data = await DataStore.open({ root, builtInGames: [], newId: () => `id${++n}` });
  data.saveGame(TYPED);
  await data.flush();
  const kept = await data.createSchemeFromPreset(TYPED.id, 'keys');
  await data.saveApplied(kept.id, resolve(kept, TYPED, BUILT_IN_DEVICES));
  await new Promise((done) => setTimeout(done, 20));
  const gone = await data.createSchemeFromPreset(TYPED.id, 'keys');
  const plan = resolve(gone, TYPED, BUILT_IN_DEVICES);
  await data.saveApplied(gone.id, plan);
  await data.settleBaseline(TYPED.id, plan.gameBindings);
  await data.recordApply(plan, [{ hand: 'left', status: 'applied' }], {
    schemeId: gone.id,
    gameId: TYPED.id,
    schemeName: gone.name,
    devices: gone.devices,
    output: gone.output,
    at: 1,
  });
  await data.deleteScheme(gone.id);
  await data.setActive(TYPED.id, kept.id);
  await data.flush();
  return { data, kept };
}

type Kind = keyof typeof ON_ACTION_MOVED;
/** The file of each kind, as `everyKind` leaves it. */
const fileOf = (kind: Kind | 'held', kept: Scheme): string =>
  ({
    game: 'games/es2-typed.json',
    scheme: `schemes/${kept.id}.json`,
    applied: `applied/${kept.id}.json`,
    held: 'applied/es2-typed.held.json',
    settings: 'settings.json',
    sheets: 'sheets.json',
    units: 'units.json',
  })[kind];

/** A newer helmArray saved it: its text, at a schema version this one doesn't know. */
async function newer(file: string): Promise<void> {
  const path = join(root, file);
  const doc = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  await writeFile(path, JSON.stringify({ ...doc, schemaVersion: 999 }));
}

/** The disk won't give it up: a folder where the file was. */
async function unreadable(file: string): Promise<void> {
  const path = join(root, file);
  await rm(path);
  await mkdir(path);
}

const BREAK = { newer, unreadable };
const KINDS: (Kind | 'held')[] = [
  'game',
  'scheme',
  'applied',
  'held',
  'settings',
  'sheets',
  'units',
];

/** What became of the change: refused with every file as it was, or done. */
type Outcome = 'refused, nothing changed' | 'refused, something changed' | 'done';

describe('every kind the store keeps is listed for both changes', () => {
  it('names the same kinds', () => {
    expect(Object.keys(ON_ACTION_MOVED).sort()).toEqual(Object.keys(ON_GAME_DELETED).sort());
  });
});

describe("a read of the game's file that moves ids, with one file it can't read", () => {
  /** Refused for every file that may name an action; settings and units name none. */
  const EXPECTED: Record<Kind | 'held', Outcome> = {
    game: 'refused, nothing changed',
    scheme: 'refused, nothing changed',
    applied: 'refused, nothing changed',
    held: 'refused, nothing changed',
    settings: 'done',
    sheets: 'refused, nothing changed',
    units: 'done',
  };

  for (const how of ['newer', 'unreadable'] as const) {
    it(`is refused, writing nothing, for each kind that names an action, when that file is ${how}`, async () => {
      const outcomes: Record<string, Outcome> = {};
      for (const kind of KINDS) {
        await rm(root, { recursive: true, force: true });
        await mkdir(root, { recursive: true });
        const { data, kept } = await everyKind();
        await BREAK[how](fileOf(kind, kept));
        const before = await files();
        const { game, moves } = mergeHarvest(TYPED, FILE);
        const refused = await data.saveFileRead(game, moves).then(
          () => false,
          () => true,
        );
        await data.flush();
        const same = JSON.stringify(await files()) === JSON.stringify(before);
        // keyed-write-ok: the key is one of the KINDS listed above, never data
        outcomes[kind] = refused
          ? same
            ? 'refused, nothing changed'
            : 'refused, something changed'
          : 'done';
      }
      expect(outcomes).toEqual(EXPECTED);
    });
  }

  it("is refused for a scheme a newer helmArray saved (Codex's case): the game keeps its ids", async () => {
    const { data, kept } = await everyKind();
    await newer(fileOf('scheme', kept));
    const { game, moves } = mergeHarvest(TYPED, FILE);
    await expect(data.saveFileRead(game, moves)).rejects.toThrow(
      `schemes/${kept.id}.json was left as it was: This scheme was saved by a newer helmArray. Update helmArray to open it.`,
    );
    const saved = JSON.parse(await readFile(join(root, 'games', 'es2-typed.json'), 'utf8')) as Game;
    expect(saved.actions.map((a) => a.id)).toEqual(['jump', 'wave']);
  });

  it("isn't stopped by another game's scheme a newer helmArray saved", async () => {
    const { data } = await everyKind();
    await mkdir(join(root, 'schemes'), { recursive: true });
    await writeFile(
      join(root, 'schemes', 'other-x.json'),
      JSON.stringify({ schemaVersion: 999, id: 'other-x', gameId: 'other' }),
    );
    const { game, moves } = mergeHarvest(TYPED, FILE);
    await expect(data.saveFileRead(game, moves)).resolves.toBeUndefined();
  });

  it("is refused for a scheme of the game filed under another scheme's name", async () => {
    const { data, kept } = await everyKind();
    const path = join(root, fileOf('scheme', kept));
    const doc = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    await writeFile(join(root, 'schemes', 'misfiled.json'), JSON.stringify({ ...doc }));
    const { game, moves } = mergeHarvest(TYPED, FILE);
    await expect(data.saveFileRead(game, moves)).rejects.toThrow(
      'schemes/misfiled.json was left as it was: This scheme is filed under a different name than its own.',
    );
  });
});

describe("deleting a game added by hand, with one file it can't read", () => {
  /**
   * Refused for a file it would have to change and can't read; a plan or the game's own file a
   * newer helmArray saved is only removed, which needs no reading.
   */
  const EXPECTED: Record<'newer' | 'unreadable', Record<Kind | 'held', Outcome>> = {
    newer: {
      game: 'done',
      scheme: 'refused, nothing changed',
      applied: 'done',
      held: 'done',
      settings: 'refused, nothing changed',
      sheets: 'refused, nothing changed',
      units: 'refused, nothing changed',
    },
    unreadable: {
      game: 'refused, nothing changed',
      scheme: 'refused, nothing changed',
      applied: 'refused, nothing changed',
      held: 'refused, nothing changed',
      settings: 'refused, nothing changed',
      sheets: 'refused, nothing changed',
      units: 'refused, nothing changed',
    },
  };

  for (const how of ['newer', 'unreadable'] as const) {
    it(`is refused, removing nothing, for each kind it can't change, when that file is ${how}`, async () => {
      const outcomes: Record<string, Outcome> = {};
      for (const kind of KINDS) {
        await rm(root, { recursive: true, force: true });
        await mkdir(root, { recursive: true });
        const { data, kept } = await everyKind();
        await BREAK[how](fileOf(kind, kept));
        const before = await files();
        const refused = await data.deleteGame(TYPED.id).then(
          () => false,
          () => true,
        );
        await data.flush();
        const same = JSON.stringify(await files()) === JSON.stringify(before);
        // keyed-write-ok: the key is one of the KINDS listed above, never data
        outcomes[kind] = refused
          ? same
            ? 'refused, nothing changed'
            : 'refused, something changed'
          : 'done';
      }
      expect(outcomes).toEqual(EXPECTED[how]);
    });
  }
});
