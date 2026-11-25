// The app's data, under one folder (`app.getPath('userData')`): the games added by hand, every
// scheme, the settings, and the plan last applied for each scheme. Every file goes through
// core's `store()` / `load()`, so it carries its schema version and old files are brought up to
// date on read. Pure of Electron: the folder is handed in, so tests run over a temp one.
//
//   games/<id>.json     a game added by hand, or your copy of a built-in game under its id (yours
//                       wins; deleting it brings helmArray's back). Built-in games ship inside
//                       the app and are never written.
//   schemes/<id>.json   one scheme
//   settings.json       the active game, and the active scheme of each game; the games read from
//                       their own file that were deleted, kept out of those found by their file
//   units.json          what each unit was last written with: which scheme, of which game, when
//   sheets.json         the bindings each game holds as far as helmArray knows (its baseline),
//                       where they differ from what it ships; moved only by *Done* and by
//                       Apply writing the game's file
//   applied/<id>.json   the plan last applied for scheme <id>; `<game>.held.json`, what a game
//                       holds after the scheme applied to it last was deleted
//
// Rules the store keeps:
// - A write is atomic: the bytes go to a temp file that is then renamed over the real one.
// - A file that can't be read is reported (`problems()`, `onProblem`), never silently replaced:
//   one saved by a newer helmArray is left exactly as it is and the write is refused; one that
//   is corrupt is kept beside itself as `<name>.corrupt-<id>` before the new one is written.
// - A scheme or a game being edited is saved a moment after the last change (`saveScheme`,
//   `saveGame`), together with its other edits; `flush()` writes whatever is waiting and is called
//   on quit. A game is checked (core's `gameProblem`) before it is taken, and again when read.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  AppSettings,
  ApplyWho,
  Game,
  Hand,
  Baselines,
  GameBinding,
  Plan,
  Scheme,
  StoredKind,
  StoredKinds,
  UnitsHeld,
} from '@helmarray/core';
import {
  AZERON_USES,
  NOTHING_HELD,
  NO_BASELINES,
  heldBy,
  settleBaseline,
  recordApply,
} from '@helmarray/core';
import {
  DEFAULT_SETTINGS,
  copyScheme,
  currentVersion,
  gameKeysPreset,
  gameProblem,
  load,
  own,
  store,
  xboxControllerPreset,
} from '@helmarray/core';
import type { GameEntry, Preset } from '../shared/api';
import { MAX_ID_LENGTH, isSafeId } from '../shared/ids';

/**
 * Everything the store keeps, by kind, and what deleting a game added by hand does to what it
 * keeps for that game. Every kind is listed (a new kind is a type error here until it is), and
 * `deleteGame` does exactly this for each, so no data kept per game can be forgotten and inherited
 * by a game added later under the same id.
 */
export const ON_GAME_DELETED: Readonly<Record<StoredKind, string>> = {
  game: 'removed: its file',
  scheme: 'removed: every scheme of the game',
  applied: 'removed: the plan applied for each of its schemes, and what the game held',
  settings:
    'removed: no longer the active game, and no scheme picked for it. A game read from its own file is then kept out of the games found by their file (`dismissFile`, by the services), and that stays',
  sheets: 'removed: its baseline (the bindings the game held)',
  units:
    'kept as history, marked: what each unit was last written with is still true, but the record is marked as of a deleted game, so a game added later under the id is never taken for it',
};

/** A file the store could not use, in a sentence the person can act on. */
export interface StoreProblem {
  /** The file, relative to the data folder, with forward slashes: `schemes/x.json`. */
  file: string;
  message: string;
}

/** What the store refuses, in one plain sentence. */
export class StoreError extends Error {}

/** How long after the last change a scheme is written. */
export const AUTOSAVE_MS = 500;

export interface DataStoreOptions {
  /** The data folder. Made when something is first written. */
  root: string;
  /** The games that ship with the app. A game added by hand can't take one's id. */
  builtInGames: readonly Game[];
  /** Wait after the last `saveScheme` of a scheme before it is written. */
  debounceMs?: number;
  /**
   * Runs `job` after `ms`, and returns the way to call it off. The job is the write itself, so a
   * test's scheduler can wait for it to finish instead of looking at the disk until it has.
   * Defaults to `setTimeout`.
   */
  schedule?(job: () => Promise<void>, ms: number): () => void;
  /** Told of every file that couldn't be read or written. Must not throw. */
  onProblem?(problem: StoreProblem): void;
  /** Told of something done to a file the person needs no word of, for the log. Must not throw. */
  onNote?(file: string, message: string): void;
  /** A short unique text, for new scheme ids and for names of quarantined files. */
  newId?(): string;
}

export interface ActiveSelection {
  gameId: string | null;
  schemeId: string | null;
}

// --- ids and shapes -------------------------------------------------------------------------

export { isSafeId };

type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether this is what a setup plays with. */
const isDevices = (value: unknown): value is Scheme['devices'] =>
  isRecord(value) &&
  (AZERON_USES as readonly unknown[]).includes(value['azerons']) &&
  typeof value['keyboard'] === 'boolean' &&
  typeof value['mouse'] === 'boolean' &&
  typeof value['controller'] === 'boolean';

/** Whether this has the shape of a scheme. A look at the top level, not a full audit. */
export function isScheme(value: unknown): value is Scheme {
  return (
    isRecord(value) &&
    isSafeId(value['id']) &&
    isSafeId(value['gameId']) &&
    typeof value['name'] === 'string' &&
    isDevices(value['devices']) &&
    (value['output'] === 'pad' || value['output'] === 'keys') &&
    typeof value['writeGameFile'] === 'boolean' &&
    isRecord(value['padMap']) &&
    isRecord(value['map']) &&
    isRecord(value['behaviour']) &&
    isRecord(value['ledger']) &&
    Array.isArray(value['accepted']) &&
    (value['keyLabels'] === undefined || isRecord(value['keyLabels']))
  );
}

const isGame = (value: unknown): value is Game =>
  isRecord(value) &&
  isSafeId(value['id']) &&
  typeof value['name'] === 'string' &&
  Array.isArray(value['modes']) &&
  Array.isArray(value['actions']);

const isSettings = (value: unknown): value is AppSettings =>
  isRecord(value) &&
  (value['activeGameId'] === null || typeof value['activeGameId'] === 'string') &&
  isRecord(value['activeScheme']) &&
  Object.values(value['activeScheme']).every((id) => typeof id === 'string') &&
  (value['dismissed'] === undefined ||
    (Array.isArray(value['dismissed']) && value['dismissed'].every(isSafeId)));

/** A unit of a plan: absent for a unit the setup doesn't use, else a profile. */
const isUnitOrNone = (value: unknown) => value === undefined || isRecord(value);

const isPlan = (value: unknown): value is Plan =>
  isRecord(value) &&
  isRecord(value['units']) &&
  isUnitOrNone(value['units']['left']) &&
  isUnitOrNone(value['units']['right']) &&
  Array.isArray(value['bindings']) &&
  Array.isArray(value['gameBindings']) &&
  Array.isArray(value['bindSheet']) &&
  isRecord(value['ledger']) &&
  Array.isArray(value['findings']);

/** One unit's last write: absent, or a scheme, its game, when, and the profile written. */
const isUnitWrite = (value: unknown) =>
  value === null ||
  (isRecord(value) &&
    typeof value['schemeId'] === 'string' &&
    typeof value['gameId'] === 'string' &&
    typeof value['schemeName'] === 'string' &&
    isDevices(value['devices']) &&
    (value['output'] === 'pad' || value['output'] === 'keys') &&
    typeof value['at'] === 'number' &&
    isRecord(value['profile']));

const isUnitsHeld = (value: unknown): value is UnitsHeld =>
  isRecord(value) && isUnitWrite(value['left']) && isUnitWrite(value['right']);

const isSignalOrNone = (value: unknown) =>
  value === null || (isRecord(value) && typeof value['kind'] === 'string');
const isGameBinding = (value: unknown): value is GameBinding =>
  isRecord(value) &&
  (value['set'] === 'keyboard' || value['set'] === 'controller') &&
  typeof value['mode'] === 'string' &&
  typeof value['action'] === 'string' &&
  isSignalOrNone(value['signal']) &&
  isSignalOrNone(value['native']);
const isBaselines = (value: unknown): value is Baselines =>
  isRecord(value) &&
  Array.isArray(value['games']) &&
  value['games'].every(
    (g: unknown) =>
      isRecord(g) &&
      typeof g['gameId'] === 'string' &&
      Array.isArray(g['held']) &&
      g['held'].every(isGameBinding),
  );

const CHECKS: { [K in StoredKind]: (value: unknown) => value is StoredKinds[K] } = {
  scheme: isScheme,
  game: isGame,
  settings: isSettings,
  applied: isPlan,
  units: isUnitsHeld,
  sheets: isBaselines,
};

const THING: Record<StoredKind, string> = {
  scheme: 'scheme',
  game: 'game',
  settings: 'settings file',
  applied: 'applied plan',
  units: 'record of what the units hold',
  sheets: 'list of bindings to set in the game',
};

// --- reading and writing files --------------------------------------------------------------

type Read<K extends StoredKind> =
  | { status: 'ok'; value: StoredKinds[K] }
  | { status: 'missing' }
  /** Saved by a newer helmArray: must be left exactly as it is. */
  | { status: 'newer'; message: string }
  /** Not JSON, not this kind of file, or failing its migration: kept aside before replacing. */
  | { status: 'corrupt'; message: string }
  /** The disk wouldn't give it up (permissions, a lock): nothing is known, so nothing is done. */
  | { status: 'unreadable'; message: string };

/** A sentence from `gameProblem` as the second half of one: its first word lowered unless a name. */
const lowerFirst = (text: string) =>
  /^(The|This|Every|Two|Whether) /.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
const codeOf = (error: unknown): string | undefined => (error as { code?: string }).code;
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function readStored<K extends StoredKind>(kind: K, path: string): Promise<Read<K>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return { status: 'missing' };
    return { status: 'unreadable', message: `The file couldn't be opened (${messageOf(error)}).` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: 'corrupt', message: `This ${THING[kind]} is damaged and can't be read.` };
  }
  const version = isRecord(raw) ? raw['schemaVersion'] : undefined;
  if (typeof version === 'number' && Number.isInteger(version) && version > currentVersion(kind)) {
    return {
      status: 'newer',
      message: `This ${THING[kind]} was saved by a newer helmArray. Update helmArray to open it.`,
    };
  }
  try {
    const value = load(kind, raw);
    if (!CHECKS[kind](value)) {
      return { status: 'corrupt', message: `This isn't a ${THING[kind]} helmArray can read.` };
    }
    return { status: 'ok', value: value as StoredKinds[K] };
  } catch (error) {
    return { status: 'corrupt', message: messageOf(error) };
  }
}

/** Renaming over a file can fail for a moment on Windows while something else has it open. */
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, 'utf8');
    for (let attempt = 1; ; attempt++) {
      try {
        await rename(temp, path);
        return;
      } catch (error) {
        const code = codeOf(error);
        if (attempt >= 5 || code === undefined || !RETRY_CODES.has(code)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
      }
    }
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

// --- the store ------------------------------------------------------------------------------

/**
 * The applied plan a game keeps once the scheme applied to it last is deleted: never a scheme's
 * id (those end in `-<preset>-<id>`), and safe as a file name whatever the game's id.
 */
const heldId = (gameId: string): string =>
  `${gameId.slice(0, MAX_ID_LENGTH - '.held'.length)}.held`;

/** The app's scheduler: a timer, its job's promise left to run (the job reports its own failure). */
const timerSchedule = (job: () => Promise<void>, ms: number): (() => void) => {
  const timer = setTimeout(() => void job(), ms);
  return () => clearTimeout(timer);
};

export class DataStore {
  private readonly root: string;
  private readonly builtIn: readonly Game[];
  private readonly debounceMs: number;
  private readonly schedule: (job: () => Promise<void>, ms: number) => () => void;
  private readonly onProblem: (problem: StoreProblem) => void;
  private readonly onNote: (file: string, message: string) => void;
  private readonly newId: () => string;

  private settings: AppSettings = { ...DEFAULT_SETTINGS, activeScheme: {} };
  private readonly open = new Map<string, StoreProblem>();
  /** Writes happen one at a time, in the order asked. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Schemes edited and not yet safely on disk: what a read of them must give back. */
  /** The settings are changed one call at a time. */
  private settingsTurn: Promise<unknown> = Promise.resolve();
  private unitsTurn: Promise<unknown> = Promise.resolve();
  private sheetsTurn: Promise<unknown> = Promise.resolve();
  private createTurn: Promise<unknown> = Promise.resolve();
  /** Changes still under way, for `flush()` to wait for. */
  private readonly ops = new Set<Promise<void>>();
  private readonly unsaved = new Map<string, Scheme>();
  /** The way to call off each scheme's waiting write. */
  private readonly timers = new Map<string, () => void>();
  /** Games edited and not yet safely on disk, and the way to call off each one's waiting write. */
  private readonly unsavedGames = new Map<string, Game>();
  private readonly gameTimers = new Map<string, () => void>();

  private constructor(options: DataStoreOptions) {
    this.root = options.root;
    this.builtIn = options.builtInGames;
    this.debounceMs = options.debounceMs ?? AUTOSAVE_MS;
    this.schedule = options.schedule ?? timerSchedule;
    this.onProblem = options.onProblem ?? (() => undefined);
    this.onNote = options.onNote ?? (() => undefined);
    this.newId = options.newId ?? (() => randomUUID().slice(0, 8));
  }

  /** Opens the store, reading the settings. A settings file that can't be read is reported. */
  static async open(options: DataStoreOptions): Promise<DataStore> {
    const data = new DataStore(options);
    const found = await data.read('settings', 'settings.json');
    if (found.status === 'ok') data.settings = found.value;
    return data;
  }

  // Problems ----------------------------------------------------------------------------------

  /** Every file that couldn't be used and hasn't been read or written well since. */
  problems(): StoreProblem[] {
    return [...this.open.values()];
  }

  private report(file: string, message: string): void {
    const problem = { file, message };
    this.open.set(file, problem);
    try {
      this.onProblem(problem);
    } catch {
      // A listener must never take the store down.
    }
  }

  /** Reads one file; a problem is reported, a good or missing file clears an earlier report. */
  private async read<K extends StoredKind>(kind: K, file: string): Promise<Read<K>> {
    const found = await readStored(kind, join(this.root, file));
    if (found.status === 'ok' || found.status === 'missing') this.open.delete(file);
    else this.report(file, found.message);
    return found;
  }

  /**
   * Reads the file `<folder>/<id>.json` of a kind that carries its own id (a scheme, a game):
   * the document, or null when there is none, it can't be used, or it names another id than
   * its file does (reported, so nothing is ever saved under the wrong name). Every read of such
   * a file goes through here.
   */
  private async readFiled<K extends 'scheme' | 'game'>(
    kind: K,
    folder: string,
    id: string,
  ): Promise<StoredKinds[K] | null> {
    const file = `${folder}/${id}.json`;
    const found = await this.read(kind, file);
    if (found.status !== 'ok') return null;
    if (found.value.id !== id) {
      this.report(file, `This ${THING[kind]} is filed under a different name than its own.`);
      return null;
    }
    return found.value;
  }

  /** Reads every `.json` in a folder of the data folder. Files that can't be used are reported. */
  private async readAll<K extends 'scheme' | 'game'>(
    kind: K,
    folder: string,
  ): Promise<{ id: string; value: StoredKinds[K] }[]> {
    let names: string[];
    try {
      names = await readdir(join(this.root, folder));
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return [];
      this.report(folder, `The folder couldn't be read (${messageOf(error)}).`);
      return [];
    }
    const found: { id: string; value: StoredKinds[K] }[] = [];
    for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
      const id = name.slice(0, -'.json'.length);
      if (!isSafeId(id)) continue;
      const value = await this.readFiled(kind, folder, id);
      if (value !== null) found.push({ id, value });
    }
    return found;
  }

  // Writing -----------------------------------------------------------------------------------

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /**
   * Writes one file through core's `store()`, atomically. Refuses to touch a file a newer
   * helmArray wrote or one the disk won't read; keeps a corrupt one aside first.
   */
  private put<K extends StoredKind>(kind: K, file: string, doc: StoredKinds[K]): Promise<void> {
    // The document is turned into its text now, before the wait for its turn, so what is written
    // is what was handed in, whatever the caller does to it afterwards.
    let text: string;
    try {
      text = `${JSON.stringify(store(kind, doc), null, 2)}\n`;
    } catch (error) {
      return Promise.reject(new StoreError(`${file} can't be saved: ${messageOf(error)}`));
    }
    return this.enqueue(async () => {
      const path = join(this.root, file);
      const there = await readStored(kind, path);
      if (there.status === 'newer' || there.status === 'unreadable') {
        this.report(file, there.message);
        throw new StoreError(`${file} was left as it was: ${there.message}`);
      }
      if (there.status === 'corrupt') {
        const aside = `${path}.corrupt-${this.newId()}`;
        try {
          await rename(path, aside);
        } catch (error) {
          this.report(file, there.message);
          throw new StoreError(`${file} is damaged and couldn't be set aside: ${messageOf(error)}`);
        }
        this.report(file, `${there.message} It was kept as ${aside.slice(this.root.length + 1)}.`);
      } else {
        this.open.delete(file);
      }
      try {
        await writeAtomic(path, text);
      } catch (error) {
        this.report(file, `The file couldn't be written (${messageOf(error)}).`);
        throw new StoreError(`${file} couldn't be written: ${messageOf(error)}`);
      }
    });
  }

  // Games -------------------------------------------------------------------------------------

  /**
   * The built-in games, then the ones added by hand, each group by name. A built-in game you have
   * edited is your copy, in its place (`edited`). Edits not yet written are included.
   */
  async listGames(): Promise<GameEntry[]> {
    const mine = new Map<string, Game>();
    for (const { id, value } of await this.readAll('game', 'games')) {
      const problem = gameProblem(value);
      if (problem !== null) {
        this.report(`games/${id}.json`, `This game can't be used: ${lowerFirst(problem)}`);
        continue;
      }
      mine.set(id, value);
    }
    for (const [id, game] of this.unsavedGames) mine.set(id, structuredClone(game));
    const byName = (a: GameEntry, b: GameEntry) =>
      a.game.name.localeCompare(b.game.name) || a.game.id.localeCompare(b.game.id);
    const builtIn = this.builtIn
      .map((game): GameEntry => {
        const copy = mine.get(game.id);
        return copy ? { game: copy, builtIn: true, edited: true } : { game, builtIn: true };
      })
      .sort(byName);
    const taken = new Set(this.builtIn.map((game) => game.id));
    const added = [...mine.values()]
      .filter((game) => !taken.has(game.id))
      .map((game): GameEntry => ({ game, builtIn: false }))
      .sort(byName);
    return [...builtIn, ...added];
  }

  /**
   * Autosave of a game: a game added by hand, or your copy of a built-in one (same id). Checked
   * first: throws at once, writing nothing, with what is wrong in one sentence. Written once
   * `debounceMs` has passed with no further edit of this game.
   */
  saveGame(game: Game): void {
    if (!isSafeId((game as { id?: unknown } | null)?.id))
      throw new StoreError("This game's id can't be used as a file name.");
    const problem = gameProblem(game);
    if (problem !== null) throw new StoreError(problem);
    const copy = structuredClone(game);
    this.unsavedGames.set(copy.id, copy);
    this.gameTimers.get(copy.id)?.();
    this.gameTimers.set(
      copy.id,
      this.schedule(() => {
        this.gameTimers.delete(copy.id);
        return this.writeGame(copy.id);
      }, this.debounceMs),
    );
  }

  /** Writes the waiting edit of one game. A failure is reported; the edit stays in memory. */
  private async writeGame(id: string): Promise<void> {
    const game = this.unsavedGames.get(id);
    if (!game) return;
    try {
      await this.put('game', `games/${id}.json`, game);
    } catch {
      return; // `put` has reported it.
    }
    if (this.unsavedGames.get(id) === game) this.unsavedGames.delete(id);
  }

  /**
   * Deletes a game you added, with its schemes, or drops your copy of a built-in one (*back to
   * helmArray's*), whose schemes stay. An edit still waiting is dropped with it.
   */
  deleteGame(gameId: string): Promise<void> {
    if (!isSafeId(gameId)) return Promise.reject(new StoreError('There is no such game.'));
    this.gameTimers.get(gameId)?.();
    this.gameTimers.delete(gameId);
    const waiting = this.unsavedGames.delete(gameId);
    const builtIn = this.builtIn.some((game) => game.id === gameId);
    const file = `games/${gameId}.json`;
    // In the write queue: a write of this game already under way finishes first, then this.
    const run = this.enqueue(async () => {
      let removed = true;
      try {
        await rm(join(this.root, file));
      } catch (error) {
        if (codeOf(error) !== 'ENOENT') {
          this.report(file, `The file couldn't be removed (${messageOf(error)}).`);
          throw new StoreError(`${file} couldn't be removed: ${messageOf(error)}`);
        }
        removed = false;
      }
      this.open.delete(file);
      if (!removed && !waiting) {
        throw new StoreError(
          builtIn
            ? "You haven't changed this game: it is already helmArray's."
            : 'There is no such game.',
        );
      }
    });
    // A game added by hand is gone, and everything kept for it (`ON_GAME_DELETED`): a game added
    // later under its id must not take any of it over. A built-in game stays, with all of it.
    const done = builtIn ? run : run.then(() => this.dropGameData(gameId));
    return this.track(done);
  }

  /** What deleting a game added by hand does to each kind kept for it: see `ON_GAME_DELETED`. */
  private readonly onGameDeleted: Record<StoredKind, (gameId: string) => Promise<void>> = {
    // Removed by `deleteGame` itself, before the rest.
    game: () => Promise.resolve(),
    // Each scheme's applied plan goes with it (`deleteScheme`).
    scheme: (gameId) => this.dropSchemes(gameId),
    applied: (gameId) =>
      this.enqueue(() => rm(join(this.root, 'applied', `${heldId(gameId)}.json`), { force: true })),
    settings: (gameId) => this.forget(gameId),
    sheets: (gameId) =>
      this.changeBaselines((baselines) => ({
        games: baselines.games.filter((g) => g.gameId !== gameId),
      })),
    units: (gameId) => this.markDeleted(gameId),
  };

  /** Everything kept for a game added by hand, in the order of `ON_GAME_DELETED`. */
  private async dropGameData(gameId: string): Promise<void> {
    for (const kind of Object.keys(ON_GAME_DELETED) as StoredKind[]) {
      await this.onGameDeleted[kind](gameId);
    }
  }

  /** Deletes every scheme of a game (and each one's applied plan). */
  private async dropSchemes(gameId: string): Promise<void> {
    for (const scheme of await this.listSchemes(gameId)) await this.deleteScheme(scheme.id);
  }

  /** Marks each unit's record of a deleted game as history (`UnitWrite.gameDeleted`). */
  private markDeleted(gameId: string): Promise<void> {
    const run = this.unitsTurn.then(async () => {
      const held = await this.unitsHeld();
      const mark = (write: UnitsHeld['left']) =>
        write !== null && write.gameId === gameId && write.gameDeleted !== true
          ? { ...write, gameDeleted: true as const }
          : write;
      const next = { left: mark(held.left), right: mark(held.right) };
      if (next.left === held.left && next.right === held.right) return;
      await this.put('units', 'units.json', next);
    });
    this.unitsTurn = run.catch(() => undefined);
    return run;
  }

  /** Drops a game from the settings: no longer the active game, and no scheme picked for it. */
  private forget(gameId: string): Promise<void> {
    const run = this.settingsTurn.then(async () => {
      const before = this.settings;
      if (before.activeGameId !== gameId && own(before.activeScheme, gameId) === undefined) return;
      const next: AppSettings = {
        ...before,
        activeGameId: before.activeGameId === gameId ? null : before.activeGameId,
        activeScheme: Object.fromEntries(
          Object.entries(before.activeScheme).filter(([id]) => id !== gameId),
        ),
      };
      this.settings = next;
      try {
        await this.put('settings', 'settings.json', next);
      } catch (error) {
        if (this.settings === next) this.settings = before;
        throw error;
      }
    });
    this.settingsTurn = run.catch(() => undefined);
    return run;
  }

  private async findGame(gameId: string): Promise<Game | undefined> {
    return (await this.listGames()).find((entry) => entry.game.id === gameId)?.game;
  }

  // Schemes -----------------------------------------------------------------------------------

  /** One scheme: the edit waiting to be written if there is one, otherwise the file. */
  async getScheme(id: string): Promise<Scheme | null> {
    if (!isSafeId(id)) return null;
    const waiting = this.unsaved.get(id);
    if (waiting) return structuredClone(waiting);
    return this.readFiled('scheme', 'schemes', id);
  }

  /** The schemes of one game, each by name. Edits not yet written are included. */
  async listSchemes(gameId: string): Promise<Scheme[]> {
    const byId = new Map<string, Scheme>();
    for (const { id, value } of await this.readAll('scheme', 'schemes')) byId.set(id, value);
    for (const [id, scheme] of this.unsaved) byId.set(id, structuredClone(scheme));
    return [...byId.values()]
      .filter((scheme) => scheme.gameId === gameId)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /**
   * Using a preset copies it: a new scheme with a new id, written at once. The preset itself,
   * which lives in core, is never edited.
   */
  createSchemeFromPreset(gameId: string, preset: Preset): Promise<Scheme> {
    // One creation at a time: each picks its name only after the one before it is written, so
    // two made at once can't both take `Xbox controller`.
    const run = this.createTurn.then(() => this.makeScheme(gameId, preset));
    this.createTurn = run.catch(() => undefined);
    return this.track(run);
  }

  private async makeScheme(gameId: string, preset: Preset): Promise<Scheme> {
    const game = await this.findGame(gameId);
    if (!game) throw new StoreError('There is no such game.');
    if (!isSafeId(game.id)) throw new StoreError("This game's id can't be used in a file name.");
    let copy: Scheme;
    if (preset === 'xbox') copy = xboxControllerPreset(game);
    else if (preset === 'keys') copy = gameKeysPreset(game);
    else throw new StoreError('There is no such preset.');
    copy = structuredClone(copy);
    // The game's id as far as it fits: the whole id must pass `isSafeId`, whatever the game's is.
    const suffix = `-${preset}-${this.newId()}`;
    copy.id = `${game.id.slice(0, Math.max(1, MAX_ID_LENGTH - suffix.length))}${suffix}`;
    copy.name = await this.freeName(game.id, copy.name);
    await this.put('scheme', `schemes/${copy.id}.json`, copy);
    return copy;
  }

  /** *Copy a scheme*: everything, the keys it was given included, under a name of its own. */
  copyScheme(schemeId: string): Promise<Scheme> {
    const run = this.createTurn.then(async () => {
      const scheme = await this.getScheme(schemeId);
      if (scheme === null) throw new StoreError('There is no such scheme.');
      const suffix = `-copy-${this.newId()}`;
      const id = `${scheme.gameId.slice(0, Math.max(1, MAX_ID_LENGTH - suffix.length))}${suffix}`;
      const copy = copyScheme(
        scheme,
        id,
        await this.freeName(scheme.gameId, `${scheme.name} copy`),
      );
      await this.put('scheme', `schemes/${copy.id}.json`, copy);
      return copy;
    });
    this.createTurn = run.catch(() => undefined);
    return this.track(run);
  }

  /**
   * Deletes a scheme: its file, any edit of it still waiting, and the game's choice of it as the
   * active one. Its applied plan goes too, unless it is what the game holds (the scheme applied
   * to it last): then the plan is kept as the game's own (`<game>.held`), so the next Apply still
   * measures the game's bindings against what the game really has.
   */
  deleteScheme(schemeId: string): Promise<void> {
    const run = this.settingsTurn.then(() => this.removeScheme(schemeId));
    this.settingsTurn = run.catch(() => undefined);
    return this.track(run);
  }

  private async removeScheme(schemeId: string): Promise<void> {
    const scheme = isSafeId(schemeId) ? await this.getScheme(schemeId) : null;
    if (scheme === null) throw new StoreError('There is no such scheme.');
    this.timers.get(schemeId)?.();
    this.timers.delete(schemeId);
    this.unsaved.delete(schemeId);
    const holds = (await this.lastApplied(scheme.gameId))?.schemeId === schemeId;
    const applied = join(this.root, 'applied', `${schemeId}.json`);
    // In the write queue: a write of this scheme already under way finishes first.
    await this.enqueue(async () => {
      if (holds) await rename(applied, join(this.root, 'applied', `${heldId(scheme.gameId)}.json`));
      else await rm(applied, { force: true });
      await rm(join(this.root, 'schemes', `${schemeId}.json`), { force: true });
    });
    if (own(this.settings.activeScheme, scheme.gameId) !== schemeId) return;
    const before = this.settings;
    const next: AppSettings = {
      ...before,
      activeScheme: Object.fromEntries(
        Object.entries(before.activeScheme).filter(([id]) => id !== scheme.gameId),
      ),
    };
    this.settings = next;
    try {
      await this.put('settings', 'settings.json', next);
    } catch (error) {
      if (this.settings === next) this.settings = before;
      throw error;
    }
  }

  /** `Xbox controller`, or `Xbox controller 2` when the game already has a scheme by that name. */
  private async freeName(gameId: string, name: string): Promise<string> {
    const used = new Set((await this.listSchemes(gameId)).map((scheme) => scheme.name));
    let candidate = name;
    for (let n = 2; used.has(candidate); n++) candidate = `${name} ${n}`;
    return candidate;
  }

  /**
   * Autosave: remembers the edit and writes it once `debounceMs` has passed with no further
   * edit of this scheme. Throws at once, writing nothing, when this isn't a scheme.
   */
  saveScheme(scheme: Scheme): void {
    if (!isScheme(scheme)) throw new StoreError("That isn't a scheme helmArray can save.");
    const copy = structuredClone(scheme);
    this.unsaved.set(copy.id, copy);
    this.timers.get(copy.id)?.();
    this.timers.set(
      copy.id,
      this.schedule(() => {
        this.timers.delete(copy.id);
        return this.writeScheme(copy.id);
      }, this.debounceMs),
    );
  }

  /** Writes the waiting edit of one scheme. A failure is reported; the edit stays in memory. */
  private async writeScheme(id: string): Promise<void> {
    const scheme = this.unsaved.get(id);
    if (!scheme) return;
    try {
      await this.put('scheme', `schemes/${id}.json`, scheme);
    } catch {
      return; // `put` has reported it.
    }
    // An edit that came in while this was being written stays waiting.
    if (this.unsaved.get(id) === scheme) this.unsaved.delete(id);
  }

  /** Writes every waiting edit now, and waits for all writes to finish. Used on quit. */
  async flush(): Promise<void> {
    for (const cancel of [...this.timers.values(), ...this.gameTimers.values()]) cancel();
    this.timers.clear();
    this.gameTimers.clear();
    // A change still looking things up isn't queued to write yet: wait for it first.
    while (this.ops.size > 0) await Promise.allSettled([...this.ops]);
    await Promise.all([
      ...[...this.unsaved.keys()].map((id) => this.writeScheme(id)),
      ...[...this.unsavedGames.keys()].map((id) => this.writeGame(id)),
    ]);
    await this.chain;
  }

  /** Remembers a change that is under way until it is done, so `flush()` can wait for it. */
  private track<T>(change: Promise<T>): Promise<T> {
    const done: Promise<void> = change
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => void this.ops.delete(done));
    this.ops.add(done);
    return change;
  }

  // Settings ----------------------------------------------------------------------------------

  /** The active game, and that game's active scheme. */
  active(): ActiveSelection {
    const gameId = this.settings.activeGameId;
    const schemeId = gameId === null ? null : (own(this.settings.activeScheme, gameId) ?? null);
    return { gameId, schemeId };
  }

  /** One game's own active scheme, whether or not the game is the active one. */
  activeSchemeOf(gameId: string): string | null {
    return own(this.settings.activeScheme, gameId) ?? null;
  }

  /** Makes this game, and this scheme of it, the active ones. `null` leaves the game with none. */
  setActive(gameId: string, schemeId: string | null): Promise<void> {
    // One change at a time, in the order asked: each reads the settings the one before left.
    const run = this.settingsTurn.then(() => this.changeActive(gameId, schemeId));
    this.settingsTurn = run.catch(() => undefined);
    return this.track(run);
  }

  private async changeActive(gameId: string, schemeId: string | null): Promise<void> {
    if (!(await this.findGame(gameId))) throw new StoreError('There is no such game.');
    if (schemeId !== null) {
      const scheme = await this.getScheme(schemeId);
      if (scheme?.gameId !== gameId) throw new StoreError("That scheme isn't one of this game's.");
    }
    const before = this.settings;
    // The other games' choices stay; this game's is replaced, or dropped for null.
    const others = Object.entries(before.activeScheme).filter(([id]) => id !== gameId);
    const next: AppSettings = {
      ...before,
      activeGameId: gameId,
      activeScheme: Object.fromEntries(
        schemeId === null ? others : [...others, [gameId, schemeId]],
      ),
    };
    this.settings = next;
    try {
      await this.put('settings', 'settings.json', next);
    } catch (error) {
      // Refused: go back, unless a later call has already built on this one.
      if (this.settings === next) this.settings = before;
      throw error;
    }
  }

  /** The games read from their own file that were deleted: not found from their file again. */
  dismissedFiles(): string[] {
    return [...(this.settings.dismissed ?? [])];
  }

  /** Keeps a game read from its own file out of those found by their file, once it is deleted. */
  dismissFile(gameId: string): Promise<void> {
    return this.changeDismissed(gameId, (list) => [...new Set([...list, gameId])]);
  }

  /** Lets a game be found by its file again: it is set up again from its tile. */
  restoreFile(gameId: string): Promise<void> {
    return this.changeDismissed(gameId, (list) => list.filter((id) => id !== gameId));
  }

  private changeDismissed(
    gameId: string,
    change: (list: readonly string[]) => readonly string[],
  ): Promise<void> {
    if (!isSafeId(gameId)) return Promise.reject(new StoreError('There is no such game.'));
    const run = this.settingsTurn.then(async () => {
      const before = this.settings;
      const list = before.dismissed ?? [];
      const after = change(list);
      // The same ids: nothing to write.
      if (after.length === list.length) return;
      const next: AppSettings = { ...before, dismissed: [...after] };
      this.settings = next;
      try {
        await this.put('settings', 'settings.json', next);
      } catch (error) {
        if (this.settings === next) this.settings = before;
        throw error;
      }
    });
    this.settingsTurn = run.catch(() => undefined);
    return this.track(run);
  }

  // Applied plans -----------------------------------------------------------------------------

  /** Remembers the plan just applied for this scheme. */
  saveApplied(schemeId: string, plan: Plan): Promise<void> {
    if (!isSafeId(schemeId)) return Promise.reject(new StoreError("That isn't a scheme id."));
    if (!isPlan(plan))
      return Promise.reject(new StoreError("That isn't a plan helmArray can save."));
    return this.track(this.put('applied', `applied/${schemeId}.json`, plan));
  }

  /** The plan last applied for this scheme, or null when none was (or it can't be read). */
  async getApplied(schemeId: string): Promise<Plan | null> {
    if (!isSafeId(schemeId)) return null;
    const found = await this.read('applied', `applied/${schemeId}.json`);
    return found.status === 'ok' ? found.value : null;
  }

  /**
   * Which of this game's schemes was applied last, and when (milliseconds since 1970), or null
   * when none was. The units hold one layout, so this is the layout they hold; the order is the
   * time each applied plan's file was written, which only a successful apply does. A deleted
   * scheme the game still holds answers by its kept plan's id (`<game>.held`), which names no
   * scheme.
   */
  async lastApplied(gameId: string): Promise<{ schemeId: string; at: number } | null> {
    let best: { schemeId: string; at: number } | null = null;
    const ids = [...(await this.listSchemes(gameId)).map((s) => s.id), heldId(gameId)];
    for (const id of ids) {
      if ((await this.getApplied(id)) === null) continue;
      let at: number;
      try {
        at = (await stat(join(this.root, 'applied', `${id}.json`))).mtimeMs;
      } catch {
        continue;
      }
      if (best === null || at > best.at) best = { schemeId: id, at };
    }
    return best;
  }

  // What the units hold -------------------------------------------------------------------------

  /** What each unit was last written with. Nothing when no unit ever was, or it can't be read. */
  async unitsHeld(): Promise<UnitsHeld> {
    const found = await this.read('units', 'units.json');
    return found.status === 'ok' ? found.value : { ...NOTHING_HELD };
  }

  /**
   * After an apply: each unit of the plan that came out holding it now holds this scheme; every
   * other unit keeps its last write (`recordApply`). One change at a time, in the order asked.
   */
  recordApply(
    plan: Pick<Plan, 'units'>,
    outcomes: readonly { hand: Hand; status: string }[],
    who: ApplyWho,
  ): Promise<void> {
    const run = this.unitsTurn.then(async () => {
      const next = recordApply(await this.unitsHeld(), plan, outcomes, who);
      await this.put('units', 'units.json', next);
    });
    this.unitsTurn = run.catch(() => undefined);
    return this.track(run);
  }

  // What each game holds -----------------------------------------------------------------------

  /**
   * Every game's baseline: the bindings it holds as far as helmArray knows. None (what each game
   * ships) when the file can't be read. A version-1 file's reminders were dropped by its migration:
   * the log says how many, and the file is written again without them.
   */
  async baselines(): Promise<Baselines> {
    const found = await this.read('sheets', 'sheets.json');
    if (found.status !== 'ok') return NO_BASELINES;
    const { droppedReminders } = found.value;
    const baselines: Baselines = { games: found.value.games };
    if (droppedReminders !== undefined) {
      this.note(
        'sheets.json',
        `an earlier helmArray kept ${droppedReminders} game${droppedReminders === 1 ? "'s" : "s'"} reminders, not what the games hold; they were dropped, and each game is taken to hold what it ships`,
      );
      await this.changeBaselines(() => baselines).catch(() => undefined);
    }
    return baselines;
  }

  /** The bindings one game holds as far as helmArray knows, or null: what it ships. */
  async heldBindings(gameId: string): Promise<GameBinding[] | null> {
    return heldBy(await this.baselines(), gameId);
  }

  private note(file: string, message: string): void {
    try {
      this.onNote(file, message);
    } catch {
      // A listener must never take the store down.
    }
  }

  /** One change to sheets.json at a time, in the order asked. */
  private changeBaselines(change: (baselines: Baselines) => Baselines): Promise<void> {
    const run = this.sheetsTurn.then(async () => {
      const found = await this.read('sheets', 'sheets.json');
      const now = found.status === 'ok' ? found.value : NO_BASELINES;
      // A version-1 file's count of dropped reminders is said once (`baselines`), never kept.
      await this.put('sheets', 'sheets.json', change({ games: now.games }));
    });
    this.sheetsTurn = run.catch(() => undefined);
    return this.track(run);
  }

  /**
   * The game now holds these bindings: *Done* on what was left to set by hand, or its file
   * written by Apply. The only thing that moves a game's baseline.
   */
  settleBaseline(gameId: string, bindings: readonly GameBinding[]): Promise<void> {
    return this.changeBaselines((baselines) => settleBaseline(baselines, gameId, bindings));
  }
}
