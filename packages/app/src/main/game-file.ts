// The game-file target of Apply: a game whose file helmArray writes gets the plan's bindings, both
// sets, through its adapter (@helmarray/games). Pure: the disk, the running programs and the clock
// are handed in (game-file-disk.ts is the real disk).
//
// What a write does, in order, and what it never does:
//   1. Finds the file (the adapter's `find`, over the folders the app hands in) and reads it. A
//      file that isn't there is not refused: the units are written, and the game's bindings are
//      set by hand (the bind sheet), with one sentence saying why. One that can't be read, or isn't
//      UTF-8 text, is refused, in a sentence. (Elite with no file of its own but the preset it
//      ships: the file is made, below.)
//   2. Writes the plan's bindings into the text in memory. An action the file doesn't have (one
//      added by hand on the Game screen) has no line to write: its bindings are set by hand, and
//      only those (`byHand`). So are the controller bindings of a file with no controller in it
//      (`padByHand`: Elite's names the controller's device id, and helmArray never makes one up).
//      A file that can't take the rest (a key it can't name) is refused, with the adapter's
//      reasons. Text that comes out the same is not written at all: the game already holds the
//      bindings.
//   3. Refuses while the game runs: it rewrites its file when it quits. A game whose programs
//      helmArray doesn't know can't be told running, so its file is never written: its bindings
//      are set by hand (the bind sheet).
//   4. Keeps a copy of the file as it was, in helmArray's backups folder (`<game>/<when> <name>`,
//      the newest last by name), read back before going on; the oldest beyond `keep` are removed.
//   5. Writes the file, reads it back, and harvests both what it holds and what was meant: they
//      must be the same. A write that fails, or reads back otherwise, puts the copy back.
// Steps 1 to 3 are also the preview (`look`), so the drawer says before Apply what Apply says.
//
// A file made (`GameFileKind.make`: Elite, when the player has no file of its own and its install
// folder holds the preset it ships). Step 1 reads the shipped preset (never written) and the
// pointer (Elite's `StartPreset.4.start`), and makes the new file's text in memory; the drawer
// says so in one sentence. Then, the game closed: a copy of the pointer is kept (step 4); the new
// file is written, then the bindings into it, and it is read back as in step 5; the pointer is
// changed to name it last, and read back. A failure at any step puts the pointer back as it was
// and removes the new file, so the game reads its preset as before. The text always counts as
// changed: the game doesn't read the new file until the pointer names it.

import { isDeepStrictEqual } from 'node:util';
import type {
  ActionId,
  BindingSet,
  Game,
  GameBinding,
  GameFileFormat,
  ModeId,
  Plan,
} from '@helmarray/core';
import type { FolderReader, Harvest } from '@helmarray/games';
import {
  ELITE_NEW_PRESET,
  GameFileError,
  eliteHoldsPad,
  findEliteBinds,
  findEliteNewBinds,
  findEverspace2Ini,
  harvestEliteBinds,
  harvestUnrealIni,
  newEliteBinds,
  writeEliteBinds,
  writeStartPreset,
  writeUnrealIni,
} from '@helmarray/games';
import type { ReadyCheck } from '../shared/api';
import type { GameFileDisk } from './game-file-disk';
import { programRunning } from './processes';

/**
 * A file helmArray makes for a game that has none of its own, from one the game ships, and the
 * file that tells the game which to read (the pointer), changed last to name it.
 */
export interface MadeFile {
  /** The file the game ships, read only: the new one is made from it. */
  from: string;
  /** What `from` is, in words: "the game's keyboard and mouse preset". */
  fromWords: string;
  /** The new file. */
  path: string;
  /** The pointer. */
  pointer: string;
  /** The new file's text, from the shipped one's; throws a `GameFileError` when it can't be made. */
  build(text: string): string;
  /** The pointer's text, naming the new file. */
  point(text: string): string;
}

/** A game file format helmArray writes: how to find the file, read it, write it, and see the game run. */
export interface GameFileKind {
  /** The file the game reads, or null when there is none. */
  find(localAppData: readonly string[], folders: FolderReader): string | null;
  /**
   * When `find` finds none: the file to make and what from, or null when none can be made. Given
   * the game's install folder when it is known.
   */
  make?(
    where: { installDir: string | null; localAppData: readonly string[] },
    folders: FolderReader,
  ): MadeFile | null;
  harvest(text: string, game: { id: string; name: string }): Harvest;
  /** The text with the bindings in it; throws a `GameFileError` naming what it can't write. */
  write(text: string, rows: readonly GameBinding[]): string;
  /**
   * Whether the file can take a controller binding. False: it has no controller in it, so its
   * controller bindings are set by hand. Always, when not given.
   */
  holdsPad?(text: string): boolean;
  /**
   * The game's programs, as the list of running programs names them. Null: not known, so whether
   * the game runs can't be told and its file is never written.
   */
  processNames: readonly string[] | null;
}

/**
 * The formats, each the one game it is written for. Where each file is: the adapters
 * (packages/games: unreal-ini.ts and elite-binds.ts, from the legacy repo's game.yaml for each).
 *
 * The games' programs are not known: nothing in reference/, the legacy repo or its notes names the
 * program either game runs as. Until the owner says (the name Task Manager shows while each runs),
 * both games' bindings stay on the bind sheet.
 */
export const GAME_FILE_KINDS: Readonly<Record<GameFileFormat, GameFileKind>> = {
  'unreal-ini': {
    find: (localAppData, folders) => findEverspace2Ini(localAppData, folders),
    harvest: harvestUnrealIni,
    write: writeUnrealIni,
    processNames: null,
  },
  'elite-binds': {
    // Only the player's own file is written: with no install folder, a preset the game ships is
    // never found here.
    find: (localAppData, folders) =>
      findEliteBinds({ installDir: null, localAppData }, folders)?.binds ?? null,
    // With none, one is made from the preset the game ships (elite-binds.ts says where each fact
    // comes from), and StartPreset names it.
    make: (where, folders) => {
      const found = findEliteNewBinds(where, folders);
      return found === null
        ? null
        : {
            from: found.from,
            fromWords: "the game's keyboard and mouse preset",
            path: found.path,
            pointer: found.startPreset,
            build: newEliteBinds,
            point: (text) => writeStartPreset(text, ELITE_NEW_PRESET),
          };
    },
    harvest: harvestEliteBinds,
    write: (text, rows) => writeEliteBinds(text, rows),
    // Its controller bindings name the controller's device id, known only from one already there.
    holdsPad: eliteHoldsPad,
    processNames: null,
  },
};

/** A binding's key: its set, mode and action. */
export const keyOf = (b: BindingKey): string => `${b.set}|${b.mode}|${b.action}`;

/** Each controller set of an action that puts it on a controller button, once, in the plan's order. */
function padKeys(rows: readonly GameBinding[]): BindingKey[] {
  const out = new Map<string, BindingKey>();
  for (const r of rows)
    if (r.set === 'controller' && r.signal?.kind === 'pad')
      out.set(keyOf(r), { set: r.set, mode: r.mode, action: r.action });
  return [...out.values()];
}

/** How many copies of a game's file are kept. The canvas's Settings offers 5 first. */
export const BACKUPS_KEPT = 5;

/** The game's install folder for a format (Steam's, for the game helmArray knows it by), or null. */
export type InstallDirOf = (format: GameFileFormat) => Promise<string | null>;

export interface GameFileDeps {
  disk: GameFileDisk;
  /** The folders to look in, first found wins: the user's `%LOCALAPPDATA%`. */
  localAppData: readonly string[];
  /** The game's install folder, looked up afresh each time: where a file to make is made from. */
  installDir?: InstallDirOf;
  /** helmArray's backups folder; each game's copies go in a folder of its own inside. */
  backupsDir: string;
  /** A fresh list of the running programs' image names, every call; a list that fails throws. */
  listProcesses(): Promise<string[]>;
  now(): number;
  kinds?: Readonly<Partial<Record<GameFileFormat, GameFileKind>>>;
  keep?: number;
  trace?(line: string): void;
}

/**
 * Where the app finds games' files and how it tells a game running, as index.ts (or a test) hands
 * them to the services. Without it no game's file is written.
 */
export interface GameFilesOptions {
  /** The folders to look in: the user's `%LOCALAPPDATA%`. */
  localAppData: readonly string[];
  /** The formats; `GAME_FILE_KINDS` when not given. */
  kinds?: Readonly<Partial<Record<GameFileFormat, GameFileKind>>>;
  /** The disk; the real one when not given. */
  disk?: GameFileDisk;
}

/**
 * The file to make for a game whose own file isn't found, or null: the kind can't make one, or
 * the install folder or what it is made from isn't there. A look-up that fails is said in the log.
 */
export async function madeFileOf(
  kind: GameFileKind,
  format: GameFileFormat,
  where: {
    installDir?: InstallDirOf | undefined;
    localAppData: readonly string[];
    folders: FolderReader;
  },
  trace: (line: string) => void,
  gameId: string,
): Promise<MadeFile | null> {
  if (kind.make === undefined) return null;
  let installDir: string | null = null;
  try {
    installDir = (await where.installDir?.(format)) ?? null;
  } catch (error) {
    trace(`couldn't find ${gameId}'s install folder: ${messageOf(error)}`);
  }
  return kind.make({ installDir, localAppData: where.localAppData }, where.folders);
}

/** One of a game's bindings, by the action and the set: what a plan has rows for. */
export interface BindingKey {
  set: BindingSet;
  mode: ModeId;
  action: ActionId;
}

/** What the drawer is told of the game's file before Apply. */
export interface FileLook {
  /** `file`: helmArray writes it; `sheet`: it doesn't, and the bindings are set by hand. */
  via: 'file' | 'sheet';
  /**
   * One sentence, null when there is none to say: with `sheet`, why the bindings are set by hand
   * when helmArray would write the file but can't find it; with `file`, that the file is made
   * (the game has none of its own) and what from.
   */
  note: string | null;
  /** The file's name, once found: `Input.ini`. */
  name: string | null;
  /** The file already holds these bindings: nothing is written. */
  same: boolean;
  /**
   * The actions the file doesn't have (added by hand on the Game screen): their bindings aren't
   * written, and are set by hand. Empty unless the file is written.
   */
  byHand: ActionId[];
  /**
   * The controller bindings the file can't hold, having no controller in it: set by hand, in the
   * game's own menu. Only when the file is written, and there are some.
   */
  padByHand?: BindingKey[];
  /** The game closed, and the file found, read and able to take the bindings: one check each. */
  checks: ReadyCheck[];
}

/** How a write of the game's file ended, in one sentence. */
export interface FileOutcome {
  ok: boolean;
  /** The file was changed (and a copy of the old one kept). */
  written: boolean;
  /**
   * Nothing written because the file isn't there (gone since the drawer looked): not a failure but
   * the same as a file missing from the start, the bindings set by hand; `message` says why.
   */
  missing?: true;
  message: string;
}

export interface GameFileTarget {
  look(game: Game, plan: Plan): Promise<FileLook>;
  write(game: Game, plan: Plan): Promise<FileOutcome>;
}

/** Why a game's bindings are set by hand when its file isn't there: the game makes it later. */
const missingSentence = (game: Game): string =>
  `helmArray can't find ${game.name}'s controls file, so set these in the game's own menu (changing any control there makes the game save one).`;
/** What the drawer says of a file helmArray makes. */
const makeSentence = (game: Game, made: MadeFile): string =>
  `${game.name} has no controls file of its own yet, so helmArray makes one from ${made.fromWords} and sets the game to use it.`;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const clause = (text: string): string => text.replace(/[.\s]+$/, '');
const upperFirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);
/** The file's text, a byte order mark kept as its first character; throws if it isn't UTF-8. */
export const decodeText = (bytes: Uint8Array): string =>
  new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const decode = decodeText;
const encoder = new TextEncoder();
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);
const baseName = (path: string): string => path.split(/[\\/]/).at(-1) ?? path;

/** Whether a name in the backups folder is one of helmArray's copies (`backupName`). */
const isCopy = (entry: string): boolean =>
  /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.\d{3}[ -]/.test(entry);
/**
 * A backup's name: when it was taken (to the millisecond, UTC), then the file's name, so the newest
 * sorts last. A second copy in the same millisecond takes `-01`, which sorts after the first.
 */
function backupName(at: number, name: string, n: number): string {
  const when = new Date(at).toISOString().replace('T', ' ').replace(/:/g, '.').replace('Z', '');
  return n === 0 ? `${when} ${name}` : `${when}-${String(n).padStart(2, '0')} ${name}`;
}

/** A file to make, as read and made in memory: the pointer as it is, and as it will be. */
interface Making {
  file: MadeFile;
  /** The new file's text before the bindings: the shipped one's, made the game's own. */
  base: string;
  pointerName: string;
  pointerBefore: Uint8Array;
  pointerAfter: string;
}

type Prepared =
  | { status: 'sheet'; note: string | null }
  | { status: 'blocked'; processNames: readonly string[]; name: string | null; problem: string }
  | {
      status: 'ready';
      kind: GameFileKind;
      processNames: readonly string[];
      path: string;
      name: string;
      /** The file as it was; for a file to make, the shipped one it is made from. */
      before: Uint8Array;
      after: string;
      same: boolean;
      byHand: ActionId[];
      padByHand: BindingKey[];
      making: Making | null;
    };
type Ready = Prepared & { status: 'ready' };

export function createGameFileTarget(deps: GameFileDeps): GameFileTarget {
  const kinds = deps.kinds ?? GAME_FILE_KINDS;
  const keep = deps.keep ?? BACKUPS_KEPT;
  const trace = (line: string) => {
    try {
      deps.trace?.(line);
    } catch {
      // The log must never take a write down.
    }
  };

  /** Steps 1 and 2: the file found, read, and the bindings written into its text in memory. */
  const prepare = async (game: Game, plan: Plan): Promise<Prepared> => {
    const format = plan.gameFile?.format;
    const kind = format === undefined ? undefined : kinds[format];
    if (format === undefined || kind === undefined) return { status: 'sheet', note: null };
    if (kind.processNames === null || kind.processNames.length === 0) {
      trace(`${game.id}: its file isn't written, since whether it runs can't be told`);
      return { status: 'sheet', note: null };
    }
    const processNames = kind.processNames;
    // Not a refusal: the units are written, and the game's half is set by hand.
    const missing: Prepared = { status: 'sheet', note: missingSentence(game) };
    const blocked = (name: string | null, problem: string): Prepared => ({
      status: 'blocked',
      processNames,
      name,
      problem,
    });
    const found = kind.find(deps.localAppData, deps.disk.folders);
    const made =
      found !== null
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
    const path = made?.path ?? found;
    if (path === null) return missing;
    const name = baseName(path);
    const fileWords = made === null ? `${game.name}'s controls file` : made.fromWords;
    let before: Uint8Array | null;
    try {
      before = await deps.disk.read(made?.from ?? path);
    } catch (error) {
      return blocked(name, `helmArray couldn't read ${fileWords} (${clause(messageOf(error))}).`);
    }
    if (before === null) return missing;
    let text: string;
    try {
      text = decode(before);
    } catch {
      return blocked(name, `${upperFirst(fileWords)} isn't text helmArray can read.`);
    }
    let making: Making | null = null;
    if (made !== null) {
      const pointerName = baseName(made.pointer);
      const pointerWords = `${pointerName}, the file that picks ${game.name}'s controls`;
      let pointerBefore: Uint8Array | null;
      try {
        pointerBefore = await deps.disk.read(made.pointer);
      } catch (error) {
        return blocked(
          name,
          `helmArray couldn't read ${pointerWords} (${clause(messageOf(error))}).`,
        );
      }
      if (pointerBefore === null) return missing;
      let pointerText: string;
      try {
        pointerText = decode(pointerBefore);
      } catch {
        return blocked(name, `${pointerWords}, isn't text helmArray can read.`);
      }
      try {
        text = made.build(text);
      } catch (error) {
        const problems = error instanceof GameFileError ? error.problems : [messageOf(error)];
        // Stryker disable next-line StringLiteral: a file is refused only with a problem in it, so there is always a first
        const first = clause(problems[0] ?? '');
        return blocked(name, `${game.name}'s controls file can't be made: ${lowerFirst(first)}.`);
      }
      making = {
        file: made,
        base: text,
        pointerName,
        pointerBefore,
        pointerAfter: made.point(pointerText),
      };
    }
    let after: string;
    let byHand: ActionId[];
    let padByHand: BindingKey[] = [];
    try {
      const has = new Set(
        kind.harvest(text, { id: game.id, name: game.name }).game.actions.map((a) => a.id),
      );
      byHand = [...new Set(plan.gameBindings.map((r) => r.action))].filter((id) => !has.has(id));
      const inFile = plan.gameBindings.filter((r) => has.has(r.action));
      // With no controller in the file, each controller binding to a controller button is set by
      // hand, the whole of its action's set: a set with no rows keeps what it has.
      if (kind.holdsPad?.(text) === false) padByHand = padKeys(inFile);
      const away = new Set(padByHand.map(keyOf));
      after = kind.write(
        text,
        inFile.filter((r) => !away.has(keyOf(r))),
      );
    } catch (error) {
      const problems = error instanceof GameFileError ? error.problems : [messageOf(error)];
      const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : '';
      // Stryker disable next-line StringLiteral: an adapter throws a GameFileError only with a problem in it, so there is always a first
      const first = clause(problems[0] ?? '');
      return blocked(name, `${game.name}'s controls file can't take this scheme: ${first}${more}.`);
    }
    return {
      status: 'ready',
      kind,
      processNames,
      path,
      name,
      before,
      after,
      // A file to make is never the same: the game doesn't read it until the pointer names it.
      same: making === null && after === text,
      byHand,
      padByHand,
      making,
    };
  };

  /** Step 3: whether the game is closed, as a check. */
  const closed = async (game: Game, names: readonly string[]): Promise<ReadyCheck> => {
    let running: boolean;
    try {
      running = programRunning(await deps.listProcesses(), names);
    } catch (error) {
      trace(`couldn't look for ${game.id}: ${messageOf(error)}`);
      return {
        ok: false,
        kind: 'game',
        text: `helmArray couldn't tell whether ${game.name} is running.`,
      };
    }
    return running
      ? { ok: false, kind: 'game', text: `Close ${game.name} to apply.` }
      : { ok: true, kind: 'game', text: `${game.name} is closed.` };
  };

  /** Step 4: a copy of the file as it was, read back; then the oldest beyond `keep` go. */
  const backUp = async (game: Game, name: string, bytes: Uint8Array): Promise<string> => {
    const dir = deps.disk.folders.join(deps.backupsDir, game.id);
    await deps.disk.makeDir(dir);
    const taken = new Set(await deps.disk.list(dir));
    const at = deps.now();
    let n = 0;
    while (taken.has(backupName(at, name, n))) n++;
    const copy = backupName(at, name, n);
    const path = deps.disk.folders.join(dir, copy);
    await deps.disk.write(path, bytes);
    const back = await deps.disk.read(path);
    if (back === null || !sameBytes(back, bytes)) throw new Error("the copy didn't read back");
    const copies = [...taken, copy].filter(isCopy).sort();
    for (const old of copies.slice(0, Math.max(0, copies.length - keep))) {
      try {
        await deps.disk.remove(deps.disk.folders.join(dir, old));
      } catch (error) {
        trace(`couldn't remove the old copy ${old}: ${messageOf(error)}`);
      }
    }
    return copy;
  };

  /**
   * Puts the file back as it was: `untouched` when it reads as it was without (a write refused
   * before it touched the file), `restored` when it reads so once put back, else `lost`.
   */
  const restore = async (
    path: string,
    before: Uint8Array,
  ): Promise<'untouched' | 'restored' | 'lost'> => {
    const reads = async () => {
      const back = await deps.disk.read(path);
      return back !== null && sameBytes(back, before);
    };
    try {
      if (await reads()) return 'untouched';
      await deps.disk.write(path, before);
      if (await reads()) return 'restored';
    } catch (error) {
      trace(`putting the file back failed: ${messageOf(error)}`);
    }
    return 'lost';
  };

  /** Step 5's check: the file read back holds what was meant, as the game will read it. */
  const holds = async (game: Game, ready: Ready): Promise<boolean> => {
    const back = await deps.disk.read(ready.path);
    if (back === null) return false;
    let text: string;
    try {
      text = decode(back);
    } catch {
      return false;
    }
    const who = { id: game.id, name: game.name };
    return isDeepStrictEqual(ready.kind.harvest(text, who), ready.kind.harvest(ready.after, who));
  };

  const look = async (game: Game, plan: Plan): Promise<FileLook> => {
    const ready = await prepare(game, plan);
    if (ready.status === 'sheet')
      return { via: 'sheet', note: ready.note, name: null, same: false, byHand: [], checks: [] };
    const check = await closed(game, ready.processNames);
    if (ready.status === 'blocked') {
      return {
        via: 'file',
        note: null,
        name: ready.name,
        same: false,
        byHand: [],
        checks: [check, { ok: false, kind: 'game-file', text: ready.problem }],
      };
    }
    return {
      via: 'file',
      note: ready.making === null ? null : makeSentence(game, ready.making.file),
      name: ready.name,
      same: ready.same,
      byHand: ready.byHand,
      ...(ready.padByHand.length === 0 ? {} : { padByHand: ready.padByHand }),
      checks: [check],
    };
  };

  /**
   * A file made: the pointer's copy kept, the new file written, then the bindings into it, read
   * back; the pointer changed to name it last, and read back. A failure puts the pointer back and
   * removes the new file.
   */
  const make = async (game: Game, ready: Ready, making: Making): Promise<FileOutcome> => {
    const file = `${game.name}'s controls file`;
    let copy: string;
    try {
      copy = await backUp(game, making.pointerName, making.pointerBefore);
    } catch (error) {
      trace(`${game.id}: no copy of ${making.file.pointer} could be kept: ${messageOf(error)}`);
      return {
        ok: false,
        written: false,
        message: `${file} wasn't made: helmArray couldn't keep a copy of ${making.pointerName} first (${clause(messageOf(error))}).`,
      };
    }
    trace(`${game.id}: kept a copy of ${making.file.pointer} as ${copy}`);
    let failure: string;
    let pointed = false;
    try {
      await deps.disk.write(ready.path, encoder.encode(making.base));
      await deps.disk.write(ready.path, encoder.encode(ready.after));
      if (await holds(game, ready)) {
        pointed = true;
        try {
          const pointer = encoder.encode(making.pointerAfter);
          await deps.disk.write(making.file.pointer, pointer);
          const back = await deps.disk.read(making.file.pointer);
          if (back !== null && sameBytes(back, pointer)) {
            trace(
              `${game.id}: made ${ready.path} from ${making.file.from}, and pointed ${making.file.pointer} at it`,
            );
            return {
              ok: true,
              written: true,
              message: `${game.name} now has the scheme's controls, in a controls file of its own made from ${making.file.fromWords}.`,
            };
          }
          failure = `${making.pointerName} didn't read back as it was written`;
        } catch (error) {
          failure = `${making.pointerName} couldn't be written (${clause(messageOf(error))})`;
        }
      } else failure = `${file} didn't read back as it was written`;
    } catch (error) {
      failure = `${file} couldn't be written (${clause(messageOf(error))})`;
    }
    trace(`${game.id}: ${failure}`);
    const lost = pointed && (await restore(making.file.pointer, making.pointerBefore)) === 'lost';
    let removed: boolean;
    try {
      await deps.disk.remove(ready.path);
      removed = (await deps.disk.read(ready.path)) === null;
    } catch (error) {
      trace(`${game.id}: couldn't remove ${ready.path}: ${messageOf(error)}`);
      removed = false;
    }
    if (lost)
      return {
        ok: false,
        written: false,
        message: `${failure}, and couldn't be put back: a copy of it is in helmArray's backups folder, as “${copy}”.`,
      };
    if (!removed)
      return {
        ok: false,
        written: false,
        message: `${failure}, and helmArray couldn't remove the ${ready.name} it began, though the game doesn't read it.`,
      };
    return { ok: false, written: false, message: `${failure}, so the game was left as it was.` };
  };

  const write = async (game: Game, plan: Plan): Promise<FileOutcome> => {
    const ready = await prepare(game, plan);
    if (ready.status === 'sheet') {
      // The file gone since the drawer looked: nothing is written, and the bindings are set by hand.
      return ready.note === null
        ? { ok: false, written: false, message: `helmArray doesn't write ${game.name}'s file.` }
        : { ok: false, written: false, missing: true, message: ready.note };
    }
    if (ready.status === 'blocked') return { ok: false, written: false, message: ready.problem };
    const check = await closed(game, ready.processNames);
    if (!check.ok) return { ok: false, written: false, message: check.text };
    if (ready.making !== null) return make(game, ready, ready.making);
    if (ready.same) {
      return { ok: true, written: false, message: `${game.name} already has these controls.` };
    }
    const file = `${game.name}'s controls file`;
    let copy: string;
    try {
      copy = await backUp(game, ready.name, ready.before);
    } catch (error) {
      trace(`${game.id}: no copy of ${ready.path} could be kept: ${messageOf(error)}`);
      return {
        ok: false,
        written: false,
        message: `${file} wasn't written: helmArray couldn't keep a copy of it first (${clause(messageOf(error))}).`,
      };
    }
    trace(`${game.id}: kept a copy of ${ready.path} as ${copy}`);
    let failure: string;
    try {
      await deps.disk.write(ready.path, encoder.encode(ready.after));
      if (await holds(game, ready)) {
        trace(`${game.id}: wrote ${ready.path}`);
        return {
          ok: true,
          written: true,
          message: `${game.name} now has the scheme's controls, and a copy of its old file is kept.`,
        };
      }
      failure = `${file} didn't read back as it was written`;
    } catch (error) {
      failure = `${file} couldn't be written (${clause(messageOf(error))})`;
    }
    trace(`${game.id}: ${failure}`);
    const back = await restore(ready.path, ready.before);
    if (back === 'untouched')
      return { ok: false, written: false, message: `${failure}, and it is as it was.` };
    if (back === 'restored')
      return { ok: false, written: false, message: `${failure}, so it was put back as it was.` };
    return {
      ok: false,
      written: false,
      message: `${failure}, and couldn't be put back: a copy of the old one is in helmArray's backups folder, as “${copy}”.`,
    };
  };

  return { look, write };
}
