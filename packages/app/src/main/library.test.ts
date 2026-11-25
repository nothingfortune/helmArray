import { helldivers2 } from '@helmarray/core';
import type { Game, Scheme } from '@helmarray/core';
import { blankKeysScheme, xboxControllerPreset } from '@helmarray/core';
import { describe, expect, it, vi } from 'vitest';
import type { GameEntry } from '../shared/api';
import { coverUrl } from '../shared/cover';
import { resolveCover } from './cover-protocol';
import { coverFilesOf, createLibraryService, mergeLibrary } from './library';
import type { LibraryDeps } from './library';
import type { SteamGame, SteamLibrary } from './steam-library';

const HD2: GameEntry = { game: helldivers2, builtIn: true };
const SKIFF: Game = {
  id: 'skiff',
  name: 'Skiff',
  steamAppId: 4242,
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
const BY_HAND: Game = {
  id: 'by-hand',
  name: 'Zed Racing',
  modes: [{ id: 'a', name: 'A' }],
  actions: [],
};

const steam = (appId: string, name: string, extra: Partial<SteamGame> = {}): SteamGame => ({
  appId,
  name,
  ...extra,
});
const none = new Map<string, readonly Scheme[]>();

describe('the merged library', () => {
  it('joins a Steam game and a game helmArray knows on the Steam app id', () => {
    const hd2Scheme = xboxControllerPreset(helldivers2);
    const entries = mergeLibrary({
      steam: [steam('553850', 'HELLDIVERS™ 2', { cover: 'a/p.jpg', header: 'a/h.jpg' })],
      games: [HD2],
      schemes: new Map([['helldivers2', [hd2Scheme]]]),
      activeSchemeOf: () => hd2Scheme.id,
    });
    expect(entries).toEqual([
      {
        // helmArray's name for the game, not Steam's trademarked capitals.
        name: 'Helldivers 2',
        inSteam: true,
        appId: '553850',
        gameId: 'helldivers2',
        schemes: [
          { id: hd2Scheme.id, name: 'Xbox controller', output: 'pad', devices: hd2Scheme.devices },
        ],
        activeSchemeId: hd2Scheme.id,
        applied: null,
        nativeKeys: true,
        shipsDefaults: true,
        hasCover: true,
        hasHeader: true,
        actionCount: helldivers2.actions.length,
      },
    ]);
  });

  it('keeps a Steam game helmArray has no definition for, unknown and with no schemes', () => {
    const entry = mergeLibrary({
      steam: [steam('1', 'Unknown Game', { cover: 'c.jpg' })],
      games: [HD2],
      schemes: none,
      activeSchemeOf: () => null,
    }).find((e) => e.appId === '1');
    expect(entry).toEqual({
      name: 'Unknown Game',
      inSteam: true,
      appId: '1',
      gameId: null,
      schemes: [],
      activeSchemeId: null,
      applied: null,
      nativeKeys: false,
      shipsDefaults: false,
      hasCover: true,
      hasHeader: false,
      actionCount: 0,
    });
  });

  it("says why a Steam game's own file can't be used, on its tile only while helmArray has no data for it", () => {
    const note = "Everspace 2's controls file has nothing helmArray can read.";
    const entries = mergeLibrary({
      steam: [steam('1128920', 'EVERSPACE 2'), steam('553850', 'HELLDIVERS 2')],
      games: [HD2],
      schemes: none,
      activeSchemeOf: () => null,
      fileNotes: new Map([
        ['1128920', note],
        ['553850', 'never shown: helmArray has data for it'],
      ]),
    });
    expect(entries.map((e) => [e.appId, e.fileNote])).toEqual([
      ['553850', undefined],
      ['1128920', note],
    ]);
  });

  it('marks a Steam tile whose game, read from its file, was deleted: Set up reads it afresh', () => {
    const entries = mergeLibrary({
      steam: [steam('1128920', 'EVERSPACE 2'), steam('553850', 'HELLDIVERS 2')],
      games: [HD2],
      schemes: none,
      activeSchemeOf: () => null,
      restorable: new Map([
        ['1128920', 'everspace2'],
        ['553850', 'never shown: helmArray has data for it'],
      ]),
    });
    expect(entries.map((e) => [e.appId, e.gameId, e.restores])).toEqual([
      ['553850', 'helldivers2', undefined],
      ['1128920', null, 'everspace2'],
    ]);
  });

  it('keeps a known game Steam does not list, with the placeholder (Steam absent)', () => {
    const entries = mergeLibrary({
      steam: [],
      games: [HD2, { game: BY_HAND, builtIn: false }],
      schemes: none,
      activeSchemeOf: () => null,
    });
    expect(
      entries.map((e) => [e.name, e.appId, e.gameId, e.hasCover, e.hasHeader, e.inSteam]),
    ).toEqual([
      ['Helldivers 2', '553850', 'helldivers2', false, false, false],
      ['Zed Racing', null, 'by-hand', false, false, false],
    ]);
  });

  it("compares the app ids as text, a game's number against Steam's string", () => {
    const entries = mergeLibrary({
      steam: [steam('4242', 'Skiff (Steam)')],
      games: [{ game: SKIFF, builtIn: false }],
      schemes: none,
      activeSchemeOf: () => null,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.gameId).toBe('skiff');
    // The game's name is helmArray's: Steam's is only for a game helmArray doesn't know.
    expect(entries[0]?.name).toBe('Skiff');
  });

  it('lists known games first and unsupported ones after, each by name', () => {
    const names = mergeLibrary({
      steam: [steam('9', 'Zebra'), steam('553850', 'Helldivers 2'), steam('3', 'apple')],
      games: [HD2, { game: BY_HAND, builtIn: false }],
      schemes: none,
      activeSchemeOf: () => null,
    }).map((e) => e.name);
    expect(names).toEqual(['Helldivers 2', 'Zed Racing', 'apple', 'Zebra']);
  });

  it("offers the game's own keys only for a game with native keys", () => {
    const entries = mergeLibrary({
      steam: [],
      games: [HD2, { game: SKIFF, builtIn: false }],
      schemes: none,
      activeSchemeOf: () => null,
    });
    expect(entries.find((e) => e.gameId === 'helldivers2')?.nativeKeys).toBe(true);
    expect(entries.find((e) => e.gameId === 'skiff')?.nativeKeys).toBe(false);
  });

  it('says defaults are found for a game shipping a key or an Xbox control, not otherwise', () => {
    // Skiff ships its boost on Xbox A and on no key.
    const bare: Game = {
      ...SKIFF,
      id: 'bare',
      actions: SKIFF.actions.map((a) => ({ ...a, native: {} })),
    };
    const entries = mergeLibrary({
      steam: [],
      games: [HD2, { game: SKIFF, builtIn: false }, { game: bare, builtIn: false }],
      schemes: none,
      activeSchemeOf: () => null,
    });
    expect(Object.fromEntries(entries.map((e) => [e.gameId, e.shipsDefaults]))).toEqual({
      helldivers2: true,
      skiff: true,
      bare: false,
    });
  });

  it('ignores an active scheme id that is not one of the game schemes', () => {
    const own = blankKeysScheme(SKIFF);
    const [entry] = mergeLibrary({
      steam: [],
      games: [{ game: SKIFF, builtIn: false }],
      schemes: new Map([['skiff', [own]]]),
      activeSchemeOf: () => 'gone',
    });
    expect(entry?.activeSchemeId).toBeNull();
    expect(entry?.schemes).toHaveLength(1);
  });

  it('carries the scheme applied last and when, only while that scheme is still the game own', () => {
    const own = blankKeysScheme(SKIFF);
    const input = (schemeId: string) => ({
      steam: [],
      games: [{ game: SKIFF, builtIn: false }],
      schemes: new Map([['skiff', [own]]]),
      activeSchemeOf: () => null,
      appliedOf: () => ({ schemeId, at: 1234, changes: 2 }),
    });
    expect(mergeLibrary(input(own.id))[0]?.applied).toEqual({
      schemeId: own.id,
      at: 1234,
      changes: 2,
    });
    expect(mergeLibrary(input('gone'))[0]?.applied).toBeNull();
    expect(mergeLibrary({ ...input(own.id), appliedOf: () => null })[0]?.applied).toBeNull();
  });

  it('asks the store which scheme of each game was applied last, and how it has changed since', async () => {
    const own = blankKeysScheme(SKIFF);
    const lastApplied = vi.fn((gameId: string) =>
      Promise.resolve(gameId === 'skiff' ? { schemeId: own.id, at: 77 } : null),
    );
    const changesOf = vi.fn((schemeId: string) => Promise.resolve(schemeId === own.id ? 3 : 0));
    const { library } = service({
      games: () => Promise.resolve([HD2, { game: SKIFF, builtIn: false }]),
      listSchemes: (gameId) => Promise.resolve(gameId === 'skiff' ? [own] : []),
      lastApplied,
      changesOf,
    });
    const entries = await library.list();
    expect(entries.find((e) => e.gameId === 'skiff')?.applied).toEqual({
      schemeId: own.id,
      at: 77,
      changes: 3,
    });
    expect(entries.find((e) => e.gameId === 'helldivers2')?.applied).toBeNull();
  });

  it('names what each scheme plays with', () => {
    const leftOnly = {
      ...blankKeysScheme(SKIFF),
      devices: { ...blankKeysScheme(SKIFF).devices, azerons: 'left' as const },
    };
    const [entry] = mergeLibrary({
      steam: [],
      games: [{ game: SKIFF, builtIn: false }],
      schemes: new Map([['skiff', [leftOnly]]]),
      activeSchemeOf: () => null,
    });
    expect(entry?.schemes[0]?.devices).toEqual(leftOnly.devices);
  });

  it('sends no file path to a window', () => {
    const text = JSON.stringify(
      mergeLibrary({
        steam: [steam('553850', 'H', { cover: 'c:/steam/p.jpg', header: 'c:/steam/h.jpg' })],
        games: [HD2],
        schemes: none,
        activeSchemeOf: () => null,
      }),
    );
    expect(text).not.toContain('c:/steam');
  });
});

describe('the cover files', () => {
  it('are exactly the paths the Steam read returned, per app id', () => {
    const library: SteamLibrary = {
      games: [steam('1', 'A', { cover: 'x/p.jpg', header: 'x/h.jpg' }), steam('2', 'B')],
    };
    const files = coverFilesOf(library);
    expect(resolveCover(coverUrl('1', 'portrait'), files)?.path).toBe('x/p.jpg');
    expect(resolveCover(coverUrl('1', 'header'), files)?.path).toBe('x/h.jpg');
    expect(resolveCover(coverUrl('2', 'portrait'), files)).toBeNull();
    expect(resolveCover(coverUrl('3', 'portrait'), files)).toBeNull();
  });
});

function service(over: Partial<LibraryDeps> = {}) {
  let games: SteamGame[] = [steam('553850', 'Helldivers 2', { cover: 'x/p.jpg' })];
  let schemes: Scheme[] = [];
  const readSteam = vi.fn(() => Promise.resolve<SteamLibrary>({ games }));
  const deps: LibraryDeps = {
    readSteam,
    games: () => Promise.resolve([HD2]),
    listSchemes: () => Promise.resolve(schemes),
    activeSchemeOf: () => null,
    lastApplied: () => Promise.resolve(null),
    ...over,
  };
  return {
    library: createLibraryService(deps),
    readSteam,
    setSteam: (next: SteamGame[]) => void (games = next),
    setSchemes: (next: Scheme[]) => void (schemes = next),
  };
}

describe('the library service', () => {
  it('reads Steam once and keeps it', async () => {
    const { library, readSteam } = service();
    await library.list();
    await library.list();
    await library.coverFiles();
    expect(readSteam).toHaveBeenCalledTimes(1);
  });

  it('shares one read between asks made at the same time', async () => {
    const { library, readSteam } = service();
    await Promise.all([library.list(), library.list(), library.coverFiles()]);
    expect(readSteam).toHaveBeenCalledTimes(1);
  });

  it("passes on what the games' files say of a tile: why one can't be used, and which is set up afresh", async () => {
    const { library } = service({
      games: () => Promise.resolve([]),
      readSteam: () =>
        Promise.resolve({ games: [steam('1128920', 'EVERSPACE 2'), steam('359320', 'Elite')] }),
      fileNotes: () => Promise.resolve(new Map([['359320', 'No file.']])),
      restorable: () => Promise.resolve(new Map([['1128920', 'everspace2']])),
    });
    expect((await library.list()).map((e) => [e.appId, e.fileNote, e.restores])).toEqual([
      ['359320', 'No file.', undefined],
      ['1128920', undefined, 'everspace2'],
    ]);
  });

  it('reads the schemes afresh on every ask, so a new scheme shows at once', async () => {
    const { library, setSchemes } = service();
    expect((await library.list())[0]?.schemes).toEqual([]);
    setSchemes([xboxControllerPreset(helldivers2)]);
    expect((await library.list())[0]?.schemes.map((s) => s.name)).toEqual(['Xbox controller']);
  });

  it('reads Steam again on a refresh, and the cover files follow the new read', async () => {
    const { library, readSteam, setSteam } = service();
    await library.list();
    setSteam([steam('553850', 'Helldivers 2', { cover: 'y/new.jpg' }), steam('5', 'New game')]);
    const entries = await library.list(true);
    expect(readSteam).toHaveBeenCalledTimes(2);
    expect(entries.map((e) => e.name)).toContain('New game');
    expect(resolveCover(coverUrl('553850', 'portrait'), await library.coverFiles())?.path).toBe(
      'y/new.jpg',
    );
  });

  it('does not keep a failed read: the next ask tries again', async () => {
    const readSteam = vi
      .fn<LibraryDeps['readSteam']>()
      .mockRejectedValueOnce(new Error('disk'))
      .mockResolvedValue({ games: [] });
    const { library } = service({ readSteam });
    await expect(library.list()).rejects.toThrow('disk');
    expect((await library.list()).map((e) => e.name)).toEqual(['Helldivers 2']);
    expect(readSteam).toHaveBeenCalledTimes(2);
  });
});

describe('the action count', () => {
  it('counts the actions of a game helmArray knows, and is 0 for a game added with none yet', () => {
    const empty = {
      ...HD2,
      game: { ...HD2.game, id: 'empty', name: 'Empty', steamAppId: 7, actions: [] },
    };
    const entries = mergeLibrary({
      steam: [steam('553850', 'HELLDIVERS™ 2'), steam('7', 'Empty'), steam('8', 'Unknown')],
      games: [HD2, empty],
      schemes: none,
      activeSchemeOf: () => null,
    });
    expect(entries.map((e) => [e.name, e.actionCount])).toEqual([
      ['Empty', 0],
      ['Helldivers 2', helldivers2.actions.length],
      ['Unknown', 0],
    ]);
  });
});
