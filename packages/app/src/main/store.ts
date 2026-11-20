// The app's data, under one folder (`app.getPath('userData')`): the games added by hand, every
// scheme, the settings, and the plan last applied for each scheme. Every file goes through
// core's `store()` / `load()`, so it carries its schema version and old files are brought up to
// date on read. Pure of Electron: the folder is handed in, so tests run over a temp one.
//
//   games/<id>.json     a game added by hand (built-in games ship inside the app)
//   schemes/<id>.json   one scheme
//   settings.json       the active game, and the active scheme of each game
//   applied/<id>.json   the plan last applied for scheme <id>
//
// Rules the store keeps:
// - A write is atomic: the bytes go to a temp file that is then renamed over the real one.
// - A file that can't be read is reported (`problems()`, `onProblem`), never silently replaced:
//   one saved by a newer helmArray is left exactly as it is and the write is refused; one that
//   is corrupt is kept beside itself as `<name>.corrupt-<id>` before the new one is written.
// - A scheme being edited is saved a moment after the last change (`saveScheme`), together with
//   its other edits; `flush()` writes whatever is waiting and is called on quit.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppSettings, Game, Plan, Scheme, StoredKind, StoredKinds } from '@helmarray/core';
import { AZERON_USES } from '@helmarray/core';
import {
  DEFAULT_SETTINGS,
  currentVersion,
  gameKeysPreset,
  load,
  own,
  store,
  xboxControllerPreset,
} from '@helmarray/core';
import type { GameEntry, Preset } from '../shared/api';

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
  /** A short unique text, for new scheme ids and for names of quarantined files. */
  newId?(): string;
}

export interface ActiveSelection {
  gameId: string | null;
  schemeId: string | null;
}

// --- ids and shapes -------------------------------------------------------------------------

/** An id that is safe as a file name: ids come from windows and from files, so nothing else. */
const MAX_ID_LENGTH = 100;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** Windows treats these as devices, with or without an extension: never a file name. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
export const isSafeId = (value: unknown): value is string =>
  typeof value === 'string' && SAFE_ID.test(value) && !value.endsWith('.') && !RESERVED.test(value);

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
    Array.isArray(value['accepted'])
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
  Object.values(value['activeScheme']).every((id) => typeof id === 'string');

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

const CHECKS: { [K in StoredKind]: (value: unknown) => value is StoredKinds[K] } = {
  scheme: isScheme,
  game: isGame,
  settings: isSettings,
  applied: isPlan,
};

const THING: Record<StoredKind, string> = {
  scheme: 'scheme',
  game: 'game',
  settings: 'settings file',
  applied: 'applied plan',
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
  private readonly newId: () => string;

  private settings: AppSettings = { ...DEFAULT_SETTINGS, activeScheme: {} };
  private readonly open = new Map<string, StoreProblem>();
  /** Writes happen one at a time, in the order asked. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Schemes edited and not yet safely on disk: what a read of them must give back. */
  /** The settings are changed one call at a time. */
  private settingsTurn: Promise<unknown> = Promise.resolve();
  private createTurn: Promise<unknown> = Promise.resolve();
  /** Changes still under way, for `flush()` to wait for. */
  private readonly ops = new Set<Promise<void>>();
  private readonly unsaved = new Map<string, Scheme>();
  /** The way to call off each scheme's waiting write. */
  private readonly timers = new Map<string, () => void>();

  private constructor(options: DataStoreOptions) {
    this.root = options.root;
    this.builtIn = options.builtInGames;
    this.debounceMs = options.debounceMs ?? AUTOSAVE_MS;
    this.schedule = options.schedule ?? timerSchedule;
    this.onProblem = options.onProblem ?? (() => undefined);
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

  /** The built-in games, then the ones added by hand, each group by name. */
  async listGames(): Promise<GameEntry[]> {
    const taken = new Set(this.builtIn.map((game) => game.id));
    const added: GameEntry[] = [];
    for (const { id, value } of await this.readAll('game', 'games')) {
      if (taken.has(id)) {
        this.report(`games/${id}.json`, 'A game built into helmArray already has this id.');
        continue;
      }
      added.push({ game: value, builtIn: false });
    }
    added.sort(
      (a, b) => a.game.name.localeCompare(b.game.name) || a.game.id.localeCompare(b.game.id),
    );
    const builtIn = [...this.builtIn]
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((game): GameEntry => ({ game, builtIn: true }));
    return [...builtIn, ...added];
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
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
    // A change still looking things up isn't queued to write yet: wait for it first.
    while (this.ops.size > 0) await Promise.allSettled([...this.ops]);
    await Promise.all([...this.unsaved.keys()].map((id) => this.writeScheme(id)));
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
   * time each applied plan's file was written, which only a successful apply does.
   */
  async lastApplied(gameId: string): Promise<{ schemeId: string; at: number } | null> {
    let best: { schemeId: string; at: number } | null = null;
    for (const scheme of await this.listSchemes(gameId)) {
      if ((await this.getApplied(scheme.id)) === null) continue;
      let at: number;
      try {
        at = (await stat(join(this.root, 'applied', `${scheme.id}.json`))).mtimeMs;
      } catch {
        continue;
      }
      if (best === null || at > best.at) best = { schemeId: scheme.id, at };
    }
    return best;
  }
}
