// A game's own file read into its data, through the services as index.ts wires them: Everspace
// 2's Input.ini and Elite's Custom.4.1.binds (copies of reference/game-files, in a temp folder
// standing for %LOCALAPPDATA%), with Steam listing both games.
//
// The head start: a game helmArray has a file format for, whose file is there, is a game it knows
// from its tile, and is saved the first time a scheme is made from it. *Game's own keys* then
// places the file's own keys. Then the Game screen's read: what the file has now, merged into
// what the person has (core's mergeHarvest, as the screen does it), never losing an edit, and
// never taking what helmArray itself wrote into the file for a default.

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Game, Scheme } from '@helmarray/core';
import { gameProblem, mergeHarvest } from '@helmarray/core';
import { harvestEliteBinds, harvestUnrealIni, writeUnrealIni } from '@helmarray/games';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assign } from '../../packages/app/src/renderer/screens/editor-model';
import { addAction, newGame } from '../../packages/app/src/renderer/screens/game-model';
import type {
  ApplyPreview,
  ApplyResult,
  GameEntry,
  LibraryEntry,
} from '../../packages/app/src/shared/api';
import { World } from './support/world';
import type { SteamApp } from './support/world';

const REFERENCE = new URL('../../reference/game-files/', import.meta.url);
const ES2_BYTES = await readFile(new URL('everspace2-Input.before.ini', REFERENCE));
const ELITE_BYTES = await readFile(new URL('elite-Custom.4.1.binds', REFERENCE));
const ES2 = 'everspace2';
const ES2_WHO = { id: ES2, name: 'Everspace 2' };
const ES2_HARVEST = harvestUnrealIni(ES2_BYTES.toString('utf8'), ES2_WHO).game;

/** Steam's own entries for the two games, as its app manifests name them. */
const STEAM: SteamApp[] = [
  { appId: '1128920', name: 'EVERSPACE™ 2', installDir: 'EVERSPACE 2' },
  { appId: '359320', name: 'Elite Dangerous', installDir: 'Elite Dangerous' },
];

/** Each game's file where the game keeps it. Elite's StartPreset names the player's own file. */
async function placeFiles(world: World): Promise<{ ini: string; binds: string }> {
  const dir = join(world.localAppData, 'ES2', 'Saved', 'Config', 'Windows');
  await mkdir(dir, { recursive: true });
  const ini = join(dir, 'Input.ini');
  await writeFile(ini, ES2_BYTES);
  const bindings = join(
    world.localAppData,
    'Frontier Developments',
    'Elite Dangerous',
    'Options',
    'Bindings',
  );
  await mkdir(bindings, { recursive: true });
  const binds = join(bindings, 'Custom.4.1.binds');
  await writeFile(binds, ELITE_BYTES);
  await writeFile(join(bindings, 'StartPreset.4.start'), 'Custom\r\nCustom\r\nCustom\r\nCustom');
  return { ini, binds };
}

const savedGames = async (world: World) =>
  readdir(join(world.dataDir, 'games')).catch(() => [] as string[]);
const tileOf = (library: LibraryEntry[], appId: string) => library.find((e) => e.appId === appId);
const entryOf = (games: GameEntry[], id: string) => games.find((e) => e.game.id === id);

describe('J1 on Everspace 2 from its tile, with no game data: its file is the head start', () => {
  let world: World;
  let ini: string;
  let before: LibraryEntry[];
  let listed: GameEntry[];
  let savedBefore: string[];
  let scheme: Scheme;
  let saved: Game;
  let preview: ApplyPreview;
  let result: ApplyResult;

  beforeAll(async () => {
    world = await World.create({ steam: STEAM });
    ({ ini } = await placeFiles(world));
    await world.boot();
    before = await world.helm.listLibrary();
    listed = await world.helm.listGames();
    await world.idle();
    savedBefore = await savedGames(world);
    // Tile, then *Game's own keys*: the scheme is made, which saves the game.
    scheme = await world.helm.createScheme(ES2, 'keys');
    await world.helm.setActive(ES2, scheme.id);
    await world.app.data.flush();
    saved = JSON.parse(await readFile(join(world.dataDir, 'games', `${ES2}.json`), 'utf8')) as Game;
    await world.keepFindings(scheme.id);
    ({ preview, result } = await world.previewAndApply(scheme.id));
  });

  afterAll(async () => {
    await world.dispose();
  });

  it("lists Everspace 2 on Steam's own tile as a game helmArray knows, ready for its own keys", () => {
    const tile = tileOf(before, '1128920');
    expect({
      name: tile?.name,
      gameId: tile?.gameId,
      inSteam: tile?.inSteam,
      schemes: tile?.schemes,
      nativeKeys: tile?.nativeKeys,
      actions: tile?.actionCount,
    }).toEqual({
      name: 'Everspace 2',
      gameId: ES2,
      inSteam: true,
      schemes: [],
      nativeKeys: true,
      actions: ES2_HARVEST.actions.length,
    });
  });

  it('lists Elite on its Steam tile the same way', () => {
    const tile = tileOf(before, '359320');
    expect([tile?.gameId, tile?.nativeKeys]).toEqual(['elite-dangerous', true]);
  });

  it('saves nothing just for looking: the games are read, not kept, until one is used', () => {
    expect({
      saved: savedBefore,
      found: listed.filter((e) => e.found === true).map((e) => e.game.id),
    }).toEqual({ saved: [], found: [ES2, 'elite-dangerous'] });
  });

  it("saves the game's data when a scheme is made from it: the file's, with its Steam id, and its sticks sending keys", () => {
    expect({
      saved: { ...saved, schemaVersion: undefined },
      problem: gameProblem(saved),
    }).toEqual({
      saved: {
        ...mergeHarvest(null, ES2_HARVEST).game,
        steamAppId: 1128920,
        needsKeyStick: true,
        schemaVersion: undefined,
      },
      problem: null,
    });
  });

  it('lists it as yours from then on, and no longer as found', async () => {
    const entry = entryOf(await world.helm.listGames(), ES2);
    expect([entry?.found, entry?.builtIn, entry?.readsFile]).toEqual([undefined, false, true]);
  });

  it("places the game's own keys from the file: each button sends the key the file has", async () => {
    const plan = await world.planOf(await world.scheme(scheme.id));
    const native = new Map(ES2_HARVEST.actions.map((a) => [a.id, a.native?.key]));
    const keys = plan.bindings.filter((b) => b.signal.kind === 'key');
    expect({
      placed: keys.length > 10,
      wrong: keys.filter((b) => JSON.stringify(native.get(b.action)) !== JSON.stringify(b.signal)),
    }).toEqual({ placed: true, wrong: [] });
  });

  it('applies: the units are written, and the file already holds the game’s own keys', () => {
    expect({
      file: preview.game.file,
      units: result.units.map((u) => u.status),
      gameFile: result.gameFile,
    }).toEqual({
      file: { name: 'Input.ini', same: true },
      units: ['applied', 'applied'],
      gameFile: { ok: true, message: 'Everspace 2 already has these controls.' },
    });
  });

  it('never wrote the game’s file to read it', async () => {
    expect((await readFile(ini)).equals(ES2_BYTES)).toBe(true);
  });

  it("sends keys from both sticks with the game's own keys, and says an Xbox stick won't do", async () => {
    const xbox = await world.helm.createScheme(ES2, 'xbox');
    const errorsOf = async (id: string) =>
      (await world.planOf(await world.scheme(id))).findings
        .filter((f) => f.severity === 'error' && f.rule === 'stick-not-keyboard')
        .map((f) => f.control);
    expect({ keys: await errorsOf(scheme.id), xbox: await errorsOf(xbox.id) }).toEqual({
      keys: [],
      xbox: ['L.stick', 'R.stick'],
    });
  });
});

describe("reading Everspace 2's file again, from the Game screen", () => {
  let world: World;
  let ini: string;

  beforeAll(async () => {
    world = await World.create({ steam: STEAM });
    ({ ini } = await placeFiles(world));
    await world.boot();
    await world.helm.createScheme(ES2, 'xbox');
  });

  afterAll(async () => {
    await world.dispose();
  });

  const mine = async () => await world.game(ES2);

  /** What the Game screen does: read, merge into what it has, and save the result. */
  async function readAgain(game: Game) {
    const read = await world.helm.readGameFile(ES2);
    if (!read.ok) throw new Error(read.message);
    return mergeHarvest(game, read.file, read.held);
  }

  it('finds nothing to change when neither the file nor the data has', async () => {
    expect((await readAgain(await mine())).changes).toEqual([]);
  });

  it('keeps the key you set, and takes a default the game changed since, in one save', async () => {
    const game = await mine();
    const yours: Game = {
      ...game,
      actions: game.actions.map((a) =>
        a.id === 'Boost' ? { ...a, native: { ...a.native, key: { kind: 'key', code: 'G' } } } : a,
      ),
    };
    await world.helm.saveGame(yours);
    // The game rebound Fire primary's key in its own menu.
    const fire = ES2_HARVEST.actions.find((a) => a.native?.key !== undefined && a.id !== 'Boost');
    await writeFile(
      ini,
      writeUnrealIni(ES2_BYTES.toString('utf8'), [
        {
          set: 'keyboard',
          mode: fire?.mode ?? '',
          action: fire?.id ?? '',
          signal: { kind: 'key', code: 'J' },
          native: null,
        },
      ]),
    );
    const merged = await readAgain(await mine());
    await world.helm.saveGame(merged.game);
    const after = await mine();
    expect({
      boost: after.actions.find((a) => a.id === 'Boost')?.native?.key,
      fire: after.actions.find((a) => a.id === fire?.id)?.native?.key,
      changes: merged.changes.map((c) => [c.kind, 'action' in c ? c.action : null]),
    }).toEqual({
      boost: { kind: 'key', code: 'G' },
      fire: { kind: 'key', code: 'J' },
      // In the game's order: the rebound action comes first in the file.
      changes: [
        ['changed', fire?.id],
        ['kept', 'Boost'],
      ],
    });
  });

  it('says how to make the file when it is gone, and changes nothing', async () => {
    const bytes = await readFile(ini);
    await rm(ini);
    const read = await world.helm.readGameFile(ES2);
    await writeFile(ini, bytes);
    expect(read).toEqual({
      ok: false,
      reason: 'missing',
      message:
        "helmArray can't find Everspace 2's controls file: change any control in the game's own menu once, then read it again.",
    });
  });

  it('reads no file for a game helmArray has no format for', async () => {
    expect(await world.helm.readGameFile('helldivers2')).toEqual({
      ok: false,
      message: "helmArray can't read Helldivers 2's controls file.",
    });
  });

  it('says there is no such game for an id it has none for', async () => {
    expect(await world.helm.readGameFile('nothing-here')).toEqual({
      ok: false,
      message: 'There is no such game.',
    });
  });
});

describe('Everspace 2 applied, then its file read again', () => {
  let world: World;
  let ini: string;
  let scheme: Scheme;
  let written: Buffer;
  let merged: ReturnType<typeof mergeHarvest>;
  let game: Game;

  beforeAll(async () => {
    world = await World.create({ steam: STEAM });
    ({ ini } = await placeFiles(world));
    await world.boot();
    scheme = await world.helm.createScheme(ES2, 'keys');
    game = await world.game(ES2);
    // Boost onto another button: it takes a key from the pool, which Apply writes into the file.
    await world.helm.saveScheme(
      assign(
        await world.scheme(scheme.id),
        { mode: 'flight', control: 'R.index_2', press: 'tap' },
        'Boost',
        game,
      ),
    );
    await world.keepFindings(scheme.id);
    await world.previewAndApply(scheme.id);
    written = await readFile(ini);
    const read = await world.helm.readGameFile(ES2);
    if (!read.ok) throw new Error(read.message);
    merged = mergeHarvest(game, read.file, read.held);
  });

  afterAll(async () => {
    await world.dispose();
  });

  it("wrote Boost's new key into the file", () => {
    const inFile = harvestUnrealIni(written.toString('utf8'), ES2_WHO).game.actions.find(
      (a) => a.id === 'Boost',
    );
    expect(inFile?.native?.key).not.toEqual({ kind: 'key', code: 'LShift' });
  });

  it("doesn't take the key helmArray wrote for a default: nothing changes", () => {
    expect([
      merged.changes,
      merged.game.actions.find((a) => a.id === 'Boost')?.native?.key,
    ]).toEqual([[], { kind: 'key', code: 'LShift' }]);
  });
});

describe("Elite's file read from its tile", () => {
  let world: World;

  beforeAll(async () => {
    world = await World.create({ steam: STEAM });
    await placeFiles(world);
    await world.boot();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it("is the player's own file, every mode and action, saved once a scheme is made", async () => {
    await world.helm.createScheme('elite-dangerous', 'xbox');
    const game = await world.game('elite-dangerous');
    const harvest = harvestEliteBinds(ELITE_BYTES.toString('utf8'), {
      id: 'elite-dangerous',
      name: 'Elite Dangerous',
    }).game;
    expect({
      modes: game.modes,
      actions: game.actions.length,
      file: game.file,
      steam: game.steamAppId,
      found: entryOf(await world.helm.listGames(), 'elite-dangerous')?.found,
    }).toEqual({
      modes: harvest.modes,
      actions: harvest.actions.length,
      file: { format: 'elite-binds' },
      steam: 359320,
      found: undefined,
    });
  });
});

describe('Everspace 2 with an action added by hand, applied', () => {
  let world: World;
  let preview: ApplyPreview;
  let result: ApplyResult;

  beforeAll(async () => {
    world = await World.create({ steam: STEAM });
    await placeFiles(world);
    await world.boot();
    const scheme = await world.helm.createScheme(ES2, 'keys');
    const game = await world.game(ES2);
    const flight = game.actions.find((a) => a.id === 'Boost')?.mode ?? '';
    const withWave: Game = {
      ...game,
      actions: [...game.actions, { id: 'wave', name: 'Wave', mode: flight, required: false }],
    };
    await world.helm.saveGame(withWave);
    await world.helm.saveScheme(
      assign(
        await world.scheme(scheme.id),
        { mode: flight, control: 'R.index_2', press: 'tap' },
        'wave',
        withWave,
      ),
    );
    await world.keepFindings(scheme.id);
    ({ preview, result } = await world.previewAndApply(scheme.id));
    await world.idle();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it("isn't stopped by it: the file is written, and Wave is listed apart to set by hand", () => {
    expect({
      ready: preview.ready,
      byHand: preview.game.byHand?.map((r) => r.action),
      inFile: preview.game.rows.some((r) => r.action === 'wave'),
      ok: result.ok,
      gameFile: result.gameFile?.ok,
    }).toEqual({ ready: true, byHand: ['wave'], inFile: false, ok: true, gameFile: true });
  });

  it("keeps Wave, and only Wave, on the Library's reminder to set by hand", () => {
    const sheet = world.state.sheets.find((s) => s.gameId === ES2);
    expect([...new Set(sheet?.rows.map((r) => r.action))]).toEqual(['wave']);
  });
});

describe('Everspace 2 read from its file, used, edited and deleted', () => {
  let world: World;
  let afterDelete: { library: LibraryEntry[]; games: GameEntry[] };
  let afterRestart: { library: LibraryEntry[]; games: GameEntry[] };
  let settings: { dismissed?: string[] };
  let restored: { library: LibraryEntry[]; games: GameEntry[] };
  let settingsAfter: { dismissed?: string[] };
  const look = async () => ({
    library: await world.helm.listLibrary(),
    games: await world.helm.listGames(),
  });
  const readSettings = async () =>
    JSON.parse(await readFile(join(world.dataDir, 'settings.json'), 'utf8')) as {
      dismissed?: string[];
    };

  beforeAll(async () => {
    world = await World.create({ steam: STEAM });
    await placeFiles(world);
    await world.boot();
    await world.helm.createScheme(ES2, 'keys');
    // An edit of yours, so a fresh read is told from the data you had.
    const mine = entryOf(await world.helm.listGames(), ES2)?.game as Game;
    await world.helm.saveGame({ ...mine, name: 'My Everspace' });
    await world.app.data.flush();
    await world.helm.deleteGame(ES2);
    await world.idle();
    afterDelete = await look();
    settings = await readSettings();
    await world.quit();
    await world.boot();
    afterRestart = await look();
    // *Set up* on its Steam tile.
    await world.helm.restoreGame(ES2);
    restored = await look();
    settingsAfter = await readSettings();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('stays deleted: its tile is Set up under Steam’s name, and reads its file afresh from there', () => {
    const tile = tileOf(afterDelete.library, '1128920');
    expect({
      tile: [tile?.name, tile?.gameId, tile?.restores],
      found: entryOf(afterDelete.games, ES2),
    }).toEqual({ tile: ['EVERSPACE™ 2', null, ES2], found: undefined });
  });

  it('keeps it deleted in your data, and after the app starts again', () => {
    expect({
      dismissed: settings.dismissed,
      tile: tileOf(afterRestart.library, '1128920')?.gameId,
      found: entryOf(afterRestart.games, ES2),
    }).toEqual({ dismissed: [ES2], tile: null, found: undefined });
  });

  it('leaves Elite as it was: still found from its file', () => {
    expect(entryOf(afterDelete.games, 'elite-dangerous')?.found).toBe(true);
  });

  it('is found again once set up from its tile, fresh from the file, not as you had it', () => {
    const entry = entryOf(restored.games, ES2);
    expect({
      found: entry?.found,
      game: entry?.game,
      tile: tileOf(restored.library, '1128920')?.gameId,
      dismissed: settingsAfter.dismissed,
    }).toEqual({
      found: true,
      game: {
        ...mergeHarvest(null, ES2_HARVEST).game,
        steamAppId: 1128920,
        needsKeyStick: true,
      },
      tile: ES2,
      dismissed: [],
    });
  });
});

describe('a game typed in by hand under Everspace 2’s Steam id, deleted', () => {
  let world: World;
  let library: LibraryEntry[];

  beforeAll(async () => {
    world = await World.create({ steam: STEAM });
    await placeFiles(world);
    await world.boot();
    await world.helm.saveGame({
      id: 'everspace_2',
      name: 'Everspace 2',
      steamAppId: 1128920,
      modes: [{ id: 'default', name: 'Default' }],
      actions: [{ id: 'boost', name: 'Boost', mode: 'default', required: false }],
    });
    await world.app.data.flush();
    await world.helm.deleteGame('everspace_2');
    await world.idle();
    library = await world.helm.listLibrary();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it("doesn't come back as the game found by its file: its tile is Set up, from the file", () => {
    const tile = tileOf(library, '1128920');
    expect([tile?.gameId, tile?.restores]).toEqual([null, ES2]);
  });
});

describe('Everspace 2 typed in by hand before its file was read', () => {
  let world: World;
  let typed: Game;
  let flightTyped: Game;

  beforeAll(async () => {
    world = await World.create({ steam: STEAM });
    await placeFiles(world);
    await world.boot();
    // As *Set up* on its Steam tile makes it, then two actions typed in.
    typed = newGame('Everspace 2', [], 1128920);
    typed = addAction(typed, 'default', 'Boost [HOLD]').game;
    typed = addAction(typed, 'default', 'Wave').game;
    await world.helm.saveGame(typed);
    await world.idle();
    // The same, its actions in a mode with the file's id for flight.
    flightTyped = {
      ...typed,
      modes: [{ id: 'flight', name: 'Flight' }],
      actions: typed.actions.map((a) => ({ ...a, mode: 'flight' })),
    };
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('is the game the Library has for Everspace 2: its file is found under no second id', async () => {
    const games = await world.helm.listGames();
    const tile = tileOf(await world.helm.listLibrary(), '1128920');
    expect({
      id: typed.id,
      tile: tile?.gameId,
      found: games.filter((e) => e.found === true).map((e) => e.game.id),
      readsFile: entryOf(games, typed.id)?.readsFile,
    }).toEqual({
      id: 'everspace_2',
      tile: 'everspace_2',
      found: ['elite-dangerous'],
      readsFile: true,
    });
  });

  it("reads the file into that game, under that game's id", async () => {
    const read = await world.helm.readGameFile(typed.id);
    expect(read.ok && [read.file.id, read.file.actions.length]).toEqual([
      'everspace_2',
      ES2_HARVEST.actions.length,
    ]);
  });

  it("keeps an action typed in under a name the file has in the same mode, and says so: the file's isn't added beside it", async () => {
    const read = await world.helm.readGameFile(typed.id);
    // As the Game screen merges it.
    const { game, changes } = mergeHarvest(flightTyped, (read as { file: Game }).file);
    const boosts = game.actions.filter((a) => a.name === 'Boost [HOLD]').map((a) => a.id);
    expect({
      boosts,
      wave: game.actions.some((a) => a.id === 'wave'),
      all: game.actions.length,
      same: changes.filter((c) => c.kind === 'same-name'),
    }).toEqual({
      boosts: ['boost_hold'],
      wave: true,
      all: ES2_HARVEST.actions.length + 1,
      same: [{ kind: 'same-name', action: 'boost_hold', name: 'Boost [HOLD]', file: 'Boost' }],
    });
  });

  it('saves that read, and a second read adds nothing more', async () => {
    const first = await world.helm.readGameFile(typed.id);
    await world.helm.saveGame(mergeHarvest(flightTyped, (first as { file: Game }).file).game);
    await world.idle();
    const saved = entryOf(await world.helm.listGames(), typed.id)?.game as Game;
    const again = await world.helm.readGameFile(typed.id);
    const { game, changes } = mergeHarvest(saved, (again as { file: Game }).file);
    expect([game.actions.length, changes.map((c) => c.kind)]).toEqual([
      saved.actions.length,
      ['same-name'],
    ]);
  });
});

describe('Everspace 2 installed, with no Input.ini saved yet', () => {
  let world: World;
  let library: LibraryEntry[];
  let listed: GameEntry[];

  beforeAll(async () => {
    world = await World.create({ steam: STEAM });
    const { ini } = await placeFiles(world);
    await rm(ini);
    await world.boot();
    library = await world.helm.listLibrary();
    listed = await world.helm.listGames();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('leaves its tile on Set up, saying why in one sentence; Elite, whose file is there, is found', () => {
    expect([
      [tileOf(library, '1128920')?.gameId, tileOf(library, '1128920')?.fileNote],
      [tileOf(library, '359320')?.gameId, tileOf(library, '359320')?.fileNote],
    ]).toEqual([
      [
        null,
        "helmArray can't find Everspace 2's controls file yet: changing any control in the game's own menu makes the game save one.",
      ],
      ['elite-dangerous', undefined],
    ]);
  });

  it('lists it as no game found, and saves nothing', async () => {
    expect([entryOf(listed, ES2), await savedGames(world)]).toEqual([undefined, []]);
  });
});

describe('games whose file has nothing helmArray can read', () => {
  let world: World;
  let ini: string;
  let binds: string;
  let library: LibraryEntry[];
  let listed: GameEntry[];

  beforeAll(async () => {
    world = await World.create({ steam: STEAM });
    ({ ini, binds } = await placeFiles(world));
    // Everspace 2's holds comments and another section only; Elite's a root with no controls.
    await writeFile(
      ini,
      '; nothing\r\n[/Script/Engine.InputSettings]\r\nbAltEnterTogglesFullscreen=True\r\n',
    );
    await writeFile(
      binds,
      '<?xml version="1.0" encoding="UTF-8" ?>\r\n<Root PresetName="Custom">\r\n</Root>\r\n',
    );
    await world.boot();
    library = await world.helm.listLibrary();
    listed = await world.helm.listGames();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('leaves each on the Set up flow, with one sentence saying why', () => {
    expect(
      ['1128920', '359320'].map((appId) => {
        const tile = tileOf(library, appId);
        return [tile?.gameId, tile?.fileNote];
      }),
    ).toEqual([
      [null, "Everspace 2's controls file has nothing helmArray can read."],
      [null, "Elite Dangerous's controls file has nothing helmArray can read."],
    ]);
  });

  it('lists neither as a game found, and makes no scheme of either', async () => {
    expect({
      found: listed.filter((e) => e.found === true).map((e) => e.game.id),
      saved: await savedGames(world),
    }).toEqual({ found: [], saved: [] });
    await expect(world.helm.createScheme(ES2, 'xbox')).rejects.toThrow('There is no such game.');
  });

  it("refuses the Game screen's read of such a file, for a game you have, saying why", async () => {
    await world.helm.saveGame({ ...ES2_HARVEST, steamAppId: 1128920 });
    expect(await world.helm.readGameFile(ES2)).toEqual({
      ok: false,
      reason: 'unreadable',
      message: "Everspace 2's controls file has nothing helmArray can read.",
    });
  });
});
