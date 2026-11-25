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
// Elite with no file of its own is read from the preset it ships (its install folder through
// Steam), as the file Apply would make from it: read only, like any other.

import type { Game, GameFileFormat } from '@helmarray/core';
import { gameProblem, mergeHarvest } from '@helmarray/core';
import type { GameFileDisk } from './game-file-disk';
import type { GameFileKind } from './game-file';
import type { InstallDirOf } from './game-file';
import { GAME_FILE_KINDS, decodeText, madeFileOf } from './game-file';

/** A game whose file format helmArray reads and writes, and how the Library tells it is that game. */
export interface FileGame {
  id: string;
  name: string;
  /** Its Steam app id, so its tile is Steam's own (with the cover), when Steam lists it. */
  steamAppId: number;
  format: GameFileFormat;
  /**
   * Its sticks must send keys (`Game.needsKeyStick`). A read of its file carries it, and a first
   * read takes it: the head start, or a game typed in by hand when its file is first read into it.
   * On data read from the file before, the flag is yours (the merge rule).
   */
  needsKeyStick?: true;
}

/**
 * The games helmArray has an adapter for. The ids are the ones the part 2 tests and the e2e seeds
 * use. The Steam app ids are each game's store page: store.steampowered.com/app/1128920
 * (EVERSPACE™ 2) and store.steampowered.com/app/359320 (Elite Dangerous), read 2026-11-25.
 *
 * Everspace 2's sticks must send keys. The legacy repo's games/SpaceSims/everspace/game.yaml sets
 * `lint.require_keyboard_stick: true` ("a stick in gamepad/analog mode made the game flip between
 * gamepad and keyboard/mouse input and stuttered the frame rate. Keyboard mode only"), and
 * reference/legacy/CLAUDE.md, *Hard-won constraints* 1, says why: an Xbox stick stuttered, and a
 * stick moving the mouse spins the ship.
 */
export const FILE_GAMES: readonly FileGame[] = [
  {
    id: 'everspace2',
    name: 'Everspace 2',
    steamAppId: 1128920,
    format: 'unreal-ini',
    needsKeyStick: true,
  },
  { id: 'elite-dangerous', name: 'Elite Dangerous', steamAppId: 359320, format: 'elite-binds' },
];

/**
 * A file read: the game as its file has it, or why it couldn't be had: `missing`, no file; or
 * `unreadable`, a file that can't be read or has nothing helmArray can use.
 */
export type FileRead =
  { ok: true; game: Game } | { ok: false; reason: 'missing' | 'unreadable'; message: string };

/** What `found` finds. */
export interface Found {
  /** Each game whose file is there and usable, as a first read leaves it: one core takes. */
  games: Game[];
  /** Each game whose file is there and can't be used, by its Steam id, with why in a sentence. */
  unreadable: { steamAppId: number; message: string }[];
  /**
   * Each game read from its file that was deleted (`dismissed`) and whose file is there and usable:
   * not found, but set up afresh from its Steam tile.
   */
  restorable: { steamAppId: number; gameId: string }[];
  /**
   * Each game whose file isn't there (Everspace 2 saves its Input.ini only once a control is changed
   * in its menu), by its Steam id, with why in a sentence: its tile stays *Set up*.
   */
  missing: { steamAppId: number; message: string }[];
}

export interface HarvestDeps {
  disk: GameFileDisk;
  /** The folders to look in, first found wins: the user's `%LOCALAPPDATA%`. */
  localAppData: readonly string[];
  /** The game's install folder: what a game with no file of its own is read from (Elite's preset). */
  installDir?: InstallDirOf;
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
   * (by id or Steam id): each as a first read leaves it, ready to save, or why its file can't be
   * used. One `dismissed` (deleted after it was read) isn't found, only said to be restorable.
   */
  found(
    known: readonly Pick<Game, 'id' | 'steamAppId'>[],
    dismissed: readonly string[],
  ): Promise<Found>;
  /** The id of the game with a file format that this game is (by its id or Steam id), or null. */
  fileGameOf(game: Pick<Game, 'id' | 'steamAppId'>): string | null;
}

/**
 * Why a game helmArray reads the file of isn't found from it, when the game has saved no file yet:
 * Apply's sentence for the same (game-file.ts), as the Game screen of its *Set up* tile says it.
 */
const missingNote = (name: string): string =>
  `helmArray can't find ${name}'s controls file yet: changing any control in the game's own menu makes the game save one.`;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const clause = (text: string): string => text.replace(/[.\s]+$/, '');
const upperFirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
/** A sentence as the end of another: its first letter lowered. */
const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

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
    const file = `${game.name}'s controls file`;
    const unreadable = (message: string): FileRead => ({
      ok: false,
      reason: 'unreadable',
      message,
    });
    if (kind === undefined) return unreadable(`helmArray can't read ${file}.`);
    const missing: FileRead = {
      ok: false,
      reason: 'missing',
      message: `helmArray can't find ${file}: change any control in the game's own menu once, then read it again.`,
    };
    const own = kind.find(deps.localAppData, deps.disk.folders);
    // With no file of its own, the one Apply would make it from (Elite's shipped preset): read
    // only, as the head start, so the game is one helmArray knows before its first Apply.
    const made =
      own !== null || format === null
        ? null
        : await madeFileOf(
            kind,
            format,
            {
              installDir: deps.installDir,
              localAppData: deps.localAppData,
              folders: deps.disk.folders,
            },
            trace,
            game.id,
          );
    const path = made?.from ?? own;
    if (path === null) return missing;
    // What is read, in words: the game's file, or what its file would be made from.
    const what = made === null ? file : made.fromWords;
    const What = made === null ? file : upperFirst(made.fromWords);
    let bytes: Uint8Array | null;
    try {
      bytes = await deps.disk.read(path);
    } catch (error) {
      return unreadable(`helmArray couldn't read ${what} (${clause(messageOf(error))}).`);
    }
    if (bytes === null) return missing;
    let text: string;
    try {
      text = decodeText(bytes);
    } catch {
      return unreadable(`${What} isn't text helmArray can read.`);
    }
    let harvested: Game;
    try {
      // As the file Apply makes would have it.
      harvested = kind.harvest(made === null ? text : made.build(text), {
        id: game.id,
        name: game.name,
      }).game;
    } catch (error) {
      trace(`${game.id}: couldn't read ${path}: ${messageOf(error)}`);
      return unreadable(`${What} isn't one helmArray can read.`);
    }
    // Nothing a game can be made of (an empty file, one of lines the adapter ignores) is no read.
    const problem =
      harvested.actions.length === 0 ? 'There is no action in it.' : gameProblem(harvested);
    if (problem !== null) {
      trace(`${game.id}: ${path} has nothing helmArray can use: ${lowerFirst(problem)}`);
      return unreadable(`${file} has nothing helmArray can read.`);
    }
    trace(`${game.id}: read ${path}`);
    // The head start's rule goes with the file's game: a first read into a game takes it from here.
    const keyStick = known(game)?.needsKeyStick === true ? { needsKeyStick: true } : {};
    return { ok: true, game: { ...harvested, ...keyStick } };
  };

  const found: GameHarvester['found'] = async (have, dismissed) => {
    const out: Found = { games: [], unreadable: [], restorable: [], missing: [] };
    for (const game of games) {
      const taken = have.some((g) => g.id === game.id || g.steamAppId === game.steamAppId);
      if (taken) continue;
      const got = await read({ ...game, file: { format: game.format } });
      if (got.ok && dismissed.includes(game.id))
        out.restorable.push({ steamAppId: game.steamAppId, gameId: game.id });
      // The read carries the game's sticks-send-keys rule, which a first read keeps.
      else if (got.ok)
        out.games.push({ ...mergeHarvest(null, got.game).game, steamAppId: game.steamAppId });
      else if (got.reason === 'unreadable')
        out.unreadable.push({ steamAppId: game.steamAppId, message: got.message });
      else out.missing.push({ steamAppId: game.steamAppId, message: missingNote(game.name) });
    }
    return out;
  };

  return { formatOf, read, found, fileGameOf: (game) => known(game)?.id ?? null };
}
