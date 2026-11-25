// Reading a game's own file into its data (docs/plans/02-architecture.md, *Harvesting a game's
// defaults*). Read only: the game's file is opened for reading and nothing else, whatever comes of
// it. Pure: the disk is handed in (game-file-disk.ts is the real one), and core's `mergeHarvest`
// decides what the data takes.
//
// Two ways in:
//   - `found`: each game helmArray has a file format for, whose file is there and whose data the
//     app doesn't have yet. The Library lists it as a game helmArray knows, and it is saved the
//     first time it is used (a scheme made from it, or an edit): the head start, so *Game's own
//     keys* works from its tile with no click more than a game that ships with helmArray.
//   - `read`: the Game screen's *Read from the game's file*, for a game that has one: the file's
//     harvest, and what the game holds from helmArray, for the screen to merge and show.
// A file that isn't there, can't be read or isn't one the adapter can read is said in a sentence.

import type { Game, GameFileFormat } from '@helmarray/core';
import { mergeHarvest } from '@helmarray/core';
import type { GameFileDisk } from './game-file-disk';
import type { GameFileKind } from './game-file';
import { GAME_FILE_KINDS, decodeText } from './game-file';

/** A game whose file format helmArray reads and writes, and how the Library tells it is that game. */
export interface FileGame {
  id: string;
  name: string;
  /** Its Steam app id, so its tile is Steam's own (with the cover), when Steam lists it. */
  steamAppId: number;
  format: GameFileFormat;
}

/**
 * The games helmArray has an adapter for. The ids are the ones the part 2 tests and the e2e seeds
 * use. The Steam app ids are each game's store page: store.steampowered.com/app/1128920
 * (EVERSPACE™ 2) and store.steampowered.com/app/359320 (Elite Dangerous), read 2026-11-25.
 */
export const FILE_GAMES: readonly FileGame[] = [
  { id: 'everspace2', name: 'Everspace 2', steamAppId: 1128920, format: 'unreal-ini' },
  { id: 'elite-dangerous', name: 'Elite Dangerous', steamAppId: 359320, format: 'elite-binds' },
];

/** A file read: the game as its file has it, or why it couldn't be had. */
export type FileRead = { ok: true; game: Game } | { ok: false; message: string };

export interface HarvestDeps {
  disk: GameFileDisk;
  /** The folders to look in, first found wins: the user's `%LOCALAPPDATA%`. */
  localAppData: readonly string[];
  kinds?: Readonly<Partial<Record<GameFileFormat, GameFileKind>>>;
  games?: readonly FileGame[];
  trace?(line: string): void;
}

export interface GameHarvester {
  /** The file format of a game: its own, else the one helmArray knows it by (id or Steam id). */
  formatOf(game: Pick<Game, 'id' | 'steamAppId' | 'file'>): GameFileFormat | null;
  /** The game as its file has it now. Reads, never writes. */
  read(game: Pick<Game, 'id' | 'name' | 'steamAppId' | 'file'>): Promise<FileRead>;
  /**
   * The games helmArray has a file format for whose file is found, and that none of `known` is
   * (by id or Steam id): each as a first read leaves it, ready to save.
   */
  found(known: readonly Pick<Game, 'id' | 'steamAppId'>[]): Promise<Game[]>;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const clause = (text: string): string => text.replace(/[.\s]+$/, '');

export function createGameHarvester(deps: HarvestDeps): GameHarvester {
  const kinds = deps.kinds ?? GAME_FILE_KINDS;
  const games = deps.games ?? FILE_GAMES;
  const trace = (line: string) => {
    try {
      deps.trace?.(line);
    } catch {
      // The log must never take a read down.
    }
  };

  const known = (game: Pick<Game, 'id' | 'steamAppId'>): FileGame | undefined =>
    games.find((g) => g.id === game.id || g.steamAppId === game.steamAppId);

  const formatOf: GameHarvester['formatOf'] = (game) =>
    game.file?.format ?? known(game)?.format ?? null;

  const read: GameHarvester['read'] = async (game) => {
    const format = formatOf(game);
    const kind = format === null ? undefined : kinds[format];
    if (kind === undefined)
      return { ok: false, message: `helmArray can't read ${game.name}'s controls file.` };
    const missing = {
      ok: false as const,
      message: `helmArray can't find ${game.name}'s controls file: change any control in the game's own menu once, then read it again.`,
    };
    const path = kind.find(deps.localAppData, deps.disk.folders);
    if (path === null) return missing;
    let bytes: Uint8Array | null;
    try {
      bytes = await deps.disk.read(path);
    } catch (error) {
      return {
        ok: false,
        message: `helmArray couldn't read ${game.name}'s controls file (${clause(messageOf(error))}).`,
      };
    }
    if (bytes === null) return missing;
    let text: string;
    try {
      text = decodeText(bytes);
    } catch {
      return { ok: false, message: `${game.name}'s controls file isn't text helmArray can read.` };
    }
    try {
      const { game: harvested } = kind.harvest(text, { id: game.id, name: game.name });
      trace(`${game.id}: read ${path}`);
      return { ok: true, game: harvested };
    } catch (error) {
      trace(`${game.id}: couldn't read ${path}: ${messageOf(error)}`);
      return { ok: false, message: `${game.name}'s controls file isn't one helmArray can read.` };
    }
  };

  const found: GameHarvester['found'] = async (have) => {
    const out: Game[] = [];
    for (const game of games) {
      const taken = have.some((g) => g.id === game.id || g.steamAppId === game.steamAppId);
      if (taken) continue;
      const got = await read({ ...game, file: { format: game.format } });
      if (!got.ok) continue;
      out.push({ ...mergeHarvest(null, got.game).game, steamAppId: game.steamAppId });
    }
    return out;
  };

  return { formatOf, read, found };
}
