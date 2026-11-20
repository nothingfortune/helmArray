import { helldivers2 } from '@helmarray/core';
import type { Game, Scheme } from '@helmarray/core';
import { gameKeysPreset, xboxControllerPreset } from '@helmarray/core';
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
        name: 'HELLDIVERS™ 2',
        appId: '553850',
        gameId: 'helldivers2',
        schemes: [{ id: hd2Scheme.id, name: 'Xbox controller', output: 'pad' }],
        activeSchemeId: hd2Scheme.id,
        applied: null,
        nativeKeys: true,
        hasCover: true,
        hasHeader: true,
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
      appId: '1',
      gameId: null,
      schemes: [],
      activeSchemeId: null,
      applied: null,
      nativeKeys: false,
      hasCover: true,
      hasHeader: false,
    });
  });

  it('keeps a known game Steam does not list, with the placeholder (Steam absent)', () => {
    const entries = mergeLibrary({
      steam: [],
      games: [HD2, { game: BY_HAND, builtIn: false }],
      schemes: none,
      activeSchemeOf: () => null,
    });
    expect(entries.map((e) => [e.name, e.appId, e.gameId, e.hasCover, e.hasHeader])).toEqual([
      ['Helldivers 2', '553850', 'helldivers2', false, false],
      ['Zed Racing', null, 'by-hand', false, false],
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
    expect(entries[0]?.name).toBe('Skiff (Steam)');
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

  it('ignores an active scheme id that is not one of the game schemes', () => {
    const own = gameKeysPreset(SKIFF);
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
    const own = gameKeysPreset(SKIFF);
    const input = (schemeId: string) => ({
      steam: [],
      games: [{ game: SKIFF, builtIn: false }],
      schemes: new Map([['skiff', [own]]]),
      activeSchemeOf: () => null,
      appliedOf: () => ({ schemeId, at: 1234 }),
    });
    expect(mergeLibrary(input(own.id))[0]?.applied).toEqual({ schemeId: own.id, at: 1234 });
    expect(mergeLibrary(input('gone'))[0]?.applied).toBeNull();
    expect(mergeLibrary({ ...input(own.id), appliedOf: () => null })[0]?.applied).toBeNull();
  });

  it('asks the store which scheme of each game was applied last', async () => {
    const own = gameKeysPreset(SKIFF);
    const lastApplied = vi.fn((gameId: string) =>
      Promise.resolve(gameId === 'skiff' ? { schemeId: own.id, at: 77 } : null),
    );
    const { library } = service({
      games: () => Promise.resolve([HD2, { game: SKIFF, builtIn: false }]),
      listSchemes: (gameId) => Promise.resolve(gameId === 'skiff' ? [own] : []),
      lastApplied,
    });
    const entries = await library.list();
    expect(entries.find((e) => e.gameId === 'skiff')?.applied).toEqual({
      schemeId: own.id,
      at: 77,
    });
    expect(entries.find((e) => e.gameId === 'helldivers2')?.applied).toBeNull();
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
