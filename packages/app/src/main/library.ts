// The Library's data: the Steam games merged with the games helmArray knows. Pure: Steam, the
// store and the schemes arrive as functions, so tests hand in fakes.
//
// Only the Steam read is kept (it walks the disk and is slow); schemes are read fresh on every
// call, so the status lines are right the moment a scheme is made.

import type { Game, Scheme } from '@helmarray/core';
import type { GameEntry, LibraryEntry, LibrarySchemeRef } from '../shared/api';
import type { CoverFiles } from './cover-protocol';
import type { SteamGame, SteamLibrary } from './steam-library';

export interface LibraryInput {
  steam: readonly SteamGame[];
  games: readonly GameEntry[];
  schemes: ReadonlyMap<string, readonly Scheme[]>;
  activeSchemeOf(gameId: string): string | null;
}

const refOf = (scheme: Scheme): LibrarySchemeRef => ({
  id: scheme.id,
  name: scheme.name,
  output: scheme.output,
});

const hasNativeKeys = (game: Game): boolean =>
  game.actions.some((a) => a.native?.key !== undefined);

/**
 * One entry per Steam game and per known game, matched on the Steam app id. Known games come
 * first (by name), then the ones helmArray has no definition for (by name).
 */
export function mergeLibrary(input: LibraryInput): LibraryEntry[] {
  const known = new Map<string, Game>();
  for (const { game } of input.games) {
    // Compared as text: Steam's ids are strings, a game's is a number. The first game wins.
    if (game.steamAppId !== undefined && !known.has(String(game.steamAppId)))
      known.set(String(game.steamAppId), game);
  }

  const entryOf = (game: Game | undefined, steam: SteamGame | undefined): LibraryEntry => {
    const appId = steam?.appId ?? (game?.steamAppId !== undefined ? String(game.steamAppId) : null);
    const schemes = game ? (input.schemes.get(game.id) ?? []).map(refOf) : [];
    const active = game ? input.activeSchemeOf(game.id) : null;
    return {
      name: steam?.name ?? game?.name ?? '',
      appId,
      gameId: game?.id ?? null,
      schemes,
      activeSchemeId: active !== null && schemes.some((s) => s.id === active) ? active : null,
      nativeKeys: game ? hasNativeKeys(game) : false,
      hasCover: steam?.cover !== undefined,
      hasHeader: steam?.header !== undefined,
    };
  };

  const used = new Set<string>();
  const entries: LibraryEntry[] = [];
  for (const steam of input.steam) {
    const game = known.get(steam.appId);
    if (game) used.add(game.id);
    entries.push(entryOf(game, steam));
  }
  // Games Steam doesn't list: not installed, or added by hand.
  for (const { game } of input.games) {
    if (!used.has(game.id)) {
      used.add(game.id);
      entries.push(entryOf(game, undefined));
    }
  }

  const byName = (a: LibraryEntry, b: LibraryEntry) =>
    a.name.localeCompare(b.name) || (a.appId ?? '').localeCompare(b.appId ?? '');
  return [
    ...entries.filter((e) => e.gameId !== null).sort(byName),
    ...entries.filter((e) => e.gameId === null).sort(byName),
  ];
}

/** The cover files of a Steam read, keyed by app id. The only files the cover protocol serves. */
export function coverFilesOf(steam: SteamLibrary): CoverFiles {
  const files = new Map<string, { portrait?: string; header?: string }>();
  for (const game of steam.games) {
    const entry: { portrait?: string; header?: string } = {};
    if (game.cover !== undefined) entry.portrait = game.cover;
    if (game.header !== undefined) entry.header = game.header;
    files.set(game.appId, entry);
  }
  return files;
}

export interface LibraryDeps {
  readSteam(): Promise<SteamLibrary>;
  games(): Promise<GameEntry[]>;
  listSchemes(gameId: string): Promise<Scheme[]>;
  activeSchemeOf(gameId: string): string | null;
}

export interface LibraryService {
  /** The merged library. `refresh` reads Steam again first. */
  list(refresh?: boolean): Promise<LibraryEntry[]>;
  /** The cover files from the Steam read the last `list` (or this) used. */
  coverFiles(): Promise<CoverFiles>;
}

export function createLibraryService(deps: LibraryDeps): LibraryService {
  let kept: Promise<SteamLibrary> | undefined;
  const steam = (refresh: boolean): Promise<SteamLibrary> => {
    if (refresh || kept === undefined) {
      const read = deps.readSteam();
      kept = read;
      // A failed read isn't kept: the next ask tries again.
      read.catch(() => {
        if (kept === read) kept = undefined;
      });
    }
    return kept;
  };

  return {
    async list(refresh = false) {
      const library = await steam(refresh);
      const games = await deps.games();
      const schemes = new Map<string, readonly Scheme[]>();
      for (const { game } of games) schemes.set(game.id, await deps.listSchemes(game.id));
      return mergeLibrary({
        steam: library.games,
        games,
        schemes,
        activeSchemeOf: deps.activeSchemeOf,
      });
    },
    async coverFiles() {
      return coverFilesOf(await steam(false));
    },
  };
}
