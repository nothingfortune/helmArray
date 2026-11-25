// Reading a game's own file into its data, over a temp folder: copies of the games' own files
// (reference/game-files, read only) where each game keeps its file, the real disk, and a disk
// wrapped to fail or to count what is asked of it.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gameProblem, mergeHarvest } from '@helmarray/core';
import { harvestEliteBinds, harvestUnrealIni } from '@helmarray/games';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameFileDisk } from './game-file-disk';
import { nodeGameFileDisk } from './game-file-disk';
import type { HarvestDeps } from './game-harvest';
import { FILE_GAMES, createGameHarvester } from './game-harvest';

const REFERENCE = new URL('../../../../reference/game-files/', import.meta.url);
const ES2_BYTES = await readFile(new URL('everspace2-Input.before.ini', REFERENCE));
const ELITE_BYTES = await readFile(new URL('elite-Custom.4.1.binds', REFERENCE));
const ES2 = { id: 'everspace2', name: 'Everspace 2' };
const ELITE = { id: 'elite-dangerous', name: 'Elite Dangerous' };
const ES2_HARVEST = harvestUnrealIni(ES2_BYTES.toString('utf8'), ES2).game;
const ELITE_HARVEST = harvestEliteBinds(ELITE_BYTES.toString('utf8'), ELITE).game;

let root: string;
let local: string;
let iniPath: string;
let bindsDir: string;
let lines: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'helm-harvest-'));
  local = join(root, 'local');
  const ini = join(local, 'ES2', 'Saved', 'Config', 'Windows');
  await mkdir(ini, { recursive: true });
  iniPath = join(ini, 'Input.ini');
  await writeFile(iniPath, ES2_BYTES);
  bindsDir = join(local, 'Frontier Developments', 'Elite Dangerous', 'Options', 'Bindings');
  await mkdir(bindsDir, { recursive: true });
  await writeFile(join(bindsDir, 'Custom.4.1.binds'), ELITE_BYTES);
  await writeFile(join(bindsDir, 'StartPreset.4.start'), 'Custom\r\nCustom\r\nCustom\r\nCustom');
  lines = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function harvester(over: Partial<HarvestDeps> = {}) {
  return createGameHarvester({
    disk: nodeGameFileDisk,
    localAppData: [local],
    trace: (line) => lines.push(line),
    ...over,
  });
}

/** The real disk, counting what is written and removed: a read must do neither. */
function watched(): { disk: GameFileDisk; touched: string[] } {
  const touched: string[] = [];
  return {
    touched,
    disk: {
      ...nodeGameFileDisk,
      write: (path) => {
        touched.push(`write ${path}`);
        return Promise.resolve();
      },
      remove: (path) => {
        touched.push(`remove ${path}`);
        return Promise.resolve();
      },
      makeDir: (dir) => {
        touched.push(`makeDir ${dir}`);
        return Promise.resolve();
      },
    },
  };
}

describe('the games helmArray reads the file of', () => {
  it('are Everspace 2 and Elite Dangerous, each by its Steam store id; Everspace 2 needs its sticks to send keys', () => {
    expect(FILE_GAMES).toEqual([
      {
        id: 'everspace2',
        name: 'Everspace 2',
        steamAppId: 1128920,
        format: 'unreal-ini',
        needsKeyStick: true,
      },
      {
        id: 'elite-dangerous',
        name: 'Elite Dangerous',
        steamAppId: 359320,
        format: 'elite-binds',
      },
    ]);
  });

  it("knows a game's format by its own, else by its id, else by its Steam id", () => {
    const h = harvester();
    expect([
      h.formatOf({ id: 'x', file: { format: 'elite-binds' } }),
      h.formatOf({ id: 'everspace2' }),
      h.formatOf({ id: 'mine', steamAppId: 359320 }),
      h.formatOf({ id: 'helldivers2', steamAppId: 553850 }),
      h.formatOf({ id: 'mine' }),
    ]).toEqual(['elite-binds', 'unreal-ini', 'elite-binds', null, null]);
  });
});

describe('reading a game file', () => {
  it("gives Everspace 2 as its Input.ini has it, under the game's own id and name", async () => {
    expect(await harvester().read({ id: 'es2-mine', name: 'ES2', steamAppId: 1128920 })).toEqual({
      ok: true,
      game: harvestUnrealIni(ES2_BYTES.toString('utf8'), { id: 'es2-mine', name: 'ES2' }).game,
    });
  });

  it("gives Elite as the player's own .binds has it", async () => {
    expect(await harvester().read({ ...ELITE, file: { format: 'elite-binds' } })).toEqual({
      ok: true,
      game: ELITE_HARVEST,
    });
  });

  it('writes, removes and makes nothing, and leaves the file as it was', async () => {
    const { disk, touched } = watched();
    await harvester({ disk }).read(ES2);
    expect([touched, (await readFile(iniPath)).equals(ES2_BYTES)]).toEqual([[], true]);
  });

  it('says how to make the file when the game has saved none yet', async () => {
    await rm(iniPath);
    expect(await harvester().read(ES2)).toEqual({
      ok: false,
      reason: 'missing',
      message:
        "helmArray can't find Everspace 2's controls file: change any control in the game's own menu once, then read it again.",
    });
  });

  it('says the same when the file goes between finding it and reading it', async () => {
    const disk = { ...nodeGameFileDisk, read: () => Promise.resolve(null) };
    expect(await harvester({ disk }).read(ES2)).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "helmArray can't find Everspace 2's controls file",
      ) as string,
    });
  });

  it("says why when the file can't be read", async () => {
    const disk = {
      ...nodeGameFileDisk,
      // A sentence's own full stop and space are dropped: it goes inside one.
      read: () => Promise.reject(new Error('EBUSY: resource busy or locked. ')),
    };
    expect(await harvester({ disk }).read(ES2)).toEqual({
      ok: false,
      reason: 'unreadable',
      message:
        "helmArray couldn't read Everspace 2's controls file (EBUSY: resource busy or locked).",
    });
  });

  it("says so when the file isn't UTF-8 text", async () => {
    await writeFile(iniPath, Buffer.from([0xff, 0xfe, 0x00, 0xd8]));
    expect(await harvester().read(ES2)).toEqual({
      ok: false,
      reason: 'unreadable',
      message: "Everspace 2's controls file isn't text helmArray can read.",
    });
  });

  it("says so, and notes why, when the adapter can't read it", async () => {
    const kinds = {
      'unreal-ini': {
        find: () => iniPath,
        harvest: () => {
          throw new Error('no section');
        },
        write: (t: string) => t,
        processNames: null,
      },
    };
    expect({ read: await harvester({ kinds }).read(ES2), lines }).toEqual({
      read: {
        ok: false,
        reason: 'unreadable',
        message: "Everspace 2's controls file isn't one helmArray can read.",
      },
      lines: [`everspace2: couldn't read ${iniPath}: no section`],
    });
  });

  it('notes the file it read', async () => {
    await harvester().read(ES2);
    expect(lines).toEqual([`everspace2: read ${iniPath}`]);
  });

  it('says it reads no file for a game it has no format for', async () => {
    expect(await harvester().read({ id: 'skiff', name: 'Skiff' })).toEqual({
      ok: false,
      reason: 'unreadable',
      message: "helmArray can't read Skiff's controls file.",
    });
  });

  it('says it reads no file for a format it is not given', async () => {
    expect(await harvester({ kinds: {} }).read(ES2)).toEqual({
      ok: false,
      reason: 'unreadable',
      message: "helmArray can't read Everspace 2's controls file.",
    });
  });

  it('never reads a preset Elite ships: only the player’s own file', async () => {
    await rm(join(bindsDir, 'Custom.4.1.binds'));
    expect((await harvester().read(ELITE)).ok).toBe(false);
  });
});

describe('the games found by their file', () => {
  it('are each game whose file is there, as a first read leaves it, with its Steam id', async () => {
    const found = await harvester().found([]);
    expect(found).toEqual({
      games: [
        { ...mergeHarvest(null, ES2_HARVEST).game, steamAppId: 1128920, needsKeyStick: true },
        { ...mergeHarvest(null, ELITE_HARVEST).game, steamAppId: 359320 },
      ],
      unreadable: [],
      restorable: [],
    });
  });

  it('are games that can be saved, with every action and a default key to start from', async () => {
    const { games: found } = await harvester().found([]);
    expect(
      found.map((g) => [
        gameProblem(g),
        g.actions.length > 0,
        g.actions.some((a) => a.native?.key !== undefined),
        g.file,
      ]),
    ).toEqual([
      [null, true, true, { format: 'unreal-ini' }],
      [null, true, true, { format: 'elite-binds' }],
    ]);
  });

  it('leave out a game the app has data for already, by its id or by its Steam id', async () => {
    const found = await harvester().found([
      { id: 'everspace2' },
      { id: 'my-elite', steamAppId: 359320 },
    ]);
    expect(found).toEqual({ games: [], unreadable: [], restorable: [] });
  });

  it('start Everspace 2 with its sticks sending keys, and Elite with no such rule', async () => {
    const { games: found } = await harvester().found([]);
    expect(found.map((g) => [g.id, g.needsKeyStick])).toEqual([
      ['everspace2', true],
      ['elite-dangerous', undefined],
    ]);
  });

  it("leave out a game whose file isn't there", async () => {
    await rm(iniPath);
    expect((await harvester().found([])).games.map((g) => g.id)).toEqual(['elite-dangerous']);
  });

  it('look in nothing but the folders given', async () => {
    expect(await harvester({ localAppData: [join(root, 'elsewhere')] }).found([])).toEqual({
      games: [],
      unreadable: [],
      restorable: [],
    });
  });
});

describe('a game read from its file and deleted', () => {
  it('is not found again, but said to be there to set up afresh from its tile', async () => {
    const found = await harvester().found([], ['everspace2']);
    expect({
      games: found.games.map((g) => g.id),
      restorable: found.restorable,
    }).toEqual({
      games: ['elite-dangerous'],
      restorable: [{ steamAppId: 1128920, gameId: 'everspace2' }],
    });
  });

  it('is not there to set up from its file when its file is gone', async () => {
    await rm(iniPath);
    expect((await harvester().found([], ['everspace2'])).restorable).toEqual([]);
  });

  it("still says why, when its file is there and can't be used", async () => {
    await writeFile(iniPath, '');
    const found = await harvester().found([], ['everspace2']);
    expect([found.restorable, found.unreadable.map((u) => u.steamAppId)]).toEqual([[], [1128920]]);
  });

  it('is not there to set up when the app has data for that game again', async () => {
    expect(
      (await harvester().found([{ id: 'mine', steamAppId: 1128920 }], ['everspace2'])).restorable,
    ).toEqual([]);
  });
});

describe('the game a file game is', () => {
  it('is found by its id or its Steam id, and is no game for any other', () => {
    const h = harvester();
    expect([
      h.fileGameOf({ id: 'everspace2' }),
      h.fileGameOf({ id: 'everspace_2', steamAppId: 1128920 }),
      h.fileGameOf({ id: 'elite-dangerous', steamAppId: 359320 }),
      h.fileGameOf({ id: 'helldivers2', steamAppId: 553850 }),
      h.fileGameOf({ id: 'mine' }),
    ]).toEqual(['everspace2', 'everspace2', 'elite-dangerous', null, null]);
  });
});

describe('a file with nothing helmArray can read', () => {
  const NOTHING_ES2 = "Everspace 2's controls file has nothing helmArray can read.";
  const NOTHING_ELITE = "Elite Dangerous's controls file has nothing helmArray can read.";
  const binds = () => join(bindsDir, 'Custom.4.1.binds');

  it.each([
    ['empty', ''],
    ['blank lines only', '\r\n\r\n   \r\n'],
    ['comments only', '; Everspace 2 input\r\n; nothing here\r\n'],
    ['its section with no binding lines', '[/Script/ES2.CustomPlayerInput]\r\n\r\n'],
    [
      'lines the adapter ignores',
      '[/Script/Engine.InputSettings]\r\nbAltEnterTogglesFullscreen=True\r\n[/Script/ES2.CustomPlayerInput]\r\nKeybindingsConfig=(Action=Boost)\r\n',
    ],
  ])('is no read of Everspace 2 when the file is %s', async (_what, text) => {
    await writeFile(iniPath, text);
    expect(await harvester().read(ES2)).toEqual({
      ok: false,
      reason: 'unreadable',
      message: NOTHING_ES2,
    });
  });

  it.each([
    ['empty', ''],
    [
      'a root with no controls',
      '<?xml version="1.0" encoding="UTF-8" ?>\r\n<Root PresetName="Custom" MajorVersion="4" MinorVersion="1">\r\n</Root>\r\n',
    ],
  ])('is no read of Elite when the file is %s', async (_what, text) => {
    await writeFile(binds(), text);
    expect(await harvester().read(ELITE)).toEqual({
      ok: false,
      reason: 'unreadable',
      message: NOTHING_ELITE,
    });
  });

  it('is no read when the adapter gives a game core refuses: actions in no mode it has', async () => {
    const kinds = {
      'unreal-ini': {
        find: () => iniPath,
        harvest: () => ({
          game: {
            id: 'everspace2',
            name: 'Everspace 2',
            modes: [],
            actions: [{ id: 'Boost', name: 'Boost', mode: 'flight', required: false }],
          },
          kept: [],
        }),
        write: (t: string) => t,
        processNames: null,
      },
    };
    expect({ read: await harvester({ kinds }).read(ES2), lines }).toEqual({
      read: { ok: false, reason: 'unreadable', message: NOTHING_ES2 },
      lines: [
        `everspace2: ${iniPath} has nothing helmArray can use: the game needs at least one mode.`,
      ],
    });
  });

  it('is no read of a file whose modes are there but no action', async () => {
    const kinds = {
      'unreal-ini': {
        find: () => iniPath,
        harvest: () => ({
          game: {
            id: 'everspace2',
            name: 'Everspace 2',
            modes: [{ id: 'flight', name: 'Flight' }],
            actions: [],
          },
          kept: [],
        }),
        write: (t: string) => t,
        processNames: null,
      },
    };
    expect({ read: await harvester({ kinds }).read(ES2), lines }).toEqual({
      read: { ok: false, reason: 'unreadable', message: NOTHING_ES2 },
      lines: [`everspace2: ${iniPath} has nothing helmArray can use: there is no action in it.`],
    });
  });

  it('says a missing file is missing, not unreadable', async () => {
    await rm(iniPath);
    expect((await harvester().read(ES2)) as { reason?: string }).toMatchObject({
      reason: 'missing',
    });
  });

  it('leaves the game out of those found, and says which Steam game had a file it could not read', async () => {
    await writeFile(iniPath, '');
    const found = await harvester().found([]);
    expect({ games: found.games.map((g) => g.id), unreadable: found.unreadable }).toEqual({
      games: ['elite-dangerous'],
      unreadable: [{ steamAppId: 1128920, message: NOTHING_ES2 }],
    });
  });

  it('says nothing of a game whose file is not there: it is not found, and that is all', async () => {
    await rm(iniPath);
    expect((await harvester().found([])).unreadable).toEqual([]);
  });

  it('says nothing of a game the app has data for already, whatever its file holds', async () => {
    await writeFile(iniPath, '');
    expect((await harvester().found([{ id: 'everspace2' }])).unreadable).toEqual([]);
  });

  it('never reports a game core refuses, for any file found', async () => {
    const found = await harvester().found([]);
    expect(found.games.map((g) => gameProblem(g))).toEqual([null, null]);
  });
});
