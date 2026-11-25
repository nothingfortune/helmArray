// The main process, wired as index.ts wires it (through `composeServices`), with only its edges
// faked: the HID bus (a `FakeHid` over `FakeUnit`s), the running programs, Steam's files and the
// clock. Everything between is real: the store on a real temp folder, the hands file, the
// devices service and its gate, the coordinator, Apply, the exchange log, the IPC argument checks
// and `window.helm` itself (the preload's `createHelmApi`, over an in-memory bridge).
//
// A test drives it the way the windows do (`world.helm`), plays the owner at the edges (plugs and
// unplugs, opens the Azeron app, presses the profile button) and reads the result from the same
// places the windows would, and from the fakes.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Game, GameFileFormat, Hand, Plan, Scheme } from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
  CYBORG2_LEFT,
  CYBORG2_RIGHT,
  blankKeysScheme,
  resolve,
  unitOf,
} from '@helmarray/core';
import { encodeRecord, storedFromWritten, toHex, unitRecords } from '@helmarray/azeron';
import type { FakeUnitOptions } from '@helmarray/azeron';
import { createHelmApi } from '../../../packages/app/src/preload/api';
import type { IpcBridge } from '../../../packages/app/src/preload/api';
import { CHANNELS } from '../../../packages/app/src/shared/api';
import type { AppState, HelmApi } from '../../../packages/app/src/shared/api';
import { BUILT_IN_GAMES } from '../../../packages/app/src/main/built-in-games';
import { GAME_FILE_KINDS } from '../../../packages/app/src/main/game-file';
import type { GameFileKind } from '../../../packages/app/src/main/game-file';
import { nodeGameFileDisk } from '../../../packages/app/src/main/game-file-disk';
import type { GameFileDisk } from '../../../packages/app/src/main/game-file-disk';
import { composeServices } from '../../../packages/app/src/main/compose';
import type { RunningServices, Services } from '../../../packages/app/src/main/compose';
import { POLL_MS, RUNNING_MS } from '../../../packages/app/src/main/devices';
import { registerHelmIpc } from '../../../packages/app/src/main/ipc';
import type { IpcRegistry } from '../../../packages/app/src/main/ipc';
import type { SteamReaders } from '../../../packages/app/src/main/steam-library';
import {
  acceptFinding,
  assign,
  isAcceptable,
} from '../../../packages/app/src/renderer/screens/editor-model';
import { FakeHid, PEDALS, XBOX_PAD, hidPath } from './fake-hid';
import type { Bystander, PluggedUnit } from './fake-hid';

/** The two units' permanent ids, as the fake units report them. */
export const LEFT_ID = 49229;
export const RIGHT_ID = 29993;
const DEVICE = { left: CYBORG2_LEFT, right: CYBORG2_RIGHT } as const;
export const HELLDIVERS2 = 'helldivers2';
const HELLDIVERS2_APP_ID = '553850';

/** What these tests take each game whose file helmArray writes to run as (the app knows none). */
export const GAME_PROGRAMS: Readonly<Record<GameFileFormat, string>> = {
  'unreal-ini': 'Everspace2-test.exe',
  'elite-binds': 'Elite-test.exe',
};
const testKind = (format: GameFileFormat): GameFileKind => ({
  ...GAME_FILE_KINDS[format],
  processNames: [GAME_PROGRAMS[format]],
});
const TEST_GAME_KINDS: Record<GameFileFormat, GameFileKind> = {
  'unreal-ini': testKind('unreal-ini'),
  'elite-binds': testKind('elite-binds'),
};

/** Where `createKeysScheme` puts each action. */
export const KEYS_PLACEMENTS: readonly [control: string, action: string][] = [
  ['L.index_1', 'move_forward'],
  ['L.index_2', 'move_back'],
  ['L.middle_1', 'strafe_left'],
  ['L.middle_2', 'strafe_right'],
  ['R.index_1', 'fire_primary'],
  ['R.middle_1', 'stratagem'],
];

// The edges ---------------------------------------------------------------------------------

/** The clock: the devices service and the coordinator read it, and a test moves it. */
export class Clock {
  private ms = Date.UTC(2026, 10, 19, 12, 0, 0);
  readonly now = (): number => this.ms;
  advance(ms: number): void {
    this.ms += ms;
  }
}

/**
 * A scheduler the test fires by hand, in place of `setTimeout`: the devices service says "again
 * in 1000 ms" and nothing happens until the test fires it. `fire(ms)` runs what was asked for
 * that interval, once.
 */
export class Scheduler {
  private readonly pending: { fn: () => void; ms: number; cancelled: boolean }[] = [];

  readonly schedule = (fn: () => void, ms: number): (() => void) => {
    const entry = { fn, ms, cancelled: false };
    this.pending.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };

  /** How many are waiting for this interval. */
  waiting(ms: number): number {
    return this.pending.filter((e) => e.ms === ms && !e.cancelled).length;
  }

  fire(ms: number): void {
    const due = this.pending.filter((e) => e.ms === ms && !e.cancelled);
    for (const entry of due) {
      entry.cancelled = true;
      entry.fn();
    }
  }
}

/** The running programs. */
export class FakeProcesses {
  azeronOpen = false;
  /** Other programs running: a game. */
  others: string[] = [];
  /** The list can't be had (`tasklist` failed): the look throws. */
  failing = false;
  /** How many times the list was asked for. */
  looks = 0;
  async list(): Promise<string[]> {
    this.looks++;
    if (this.failing) return Promise.reject(new Error('tasklist could not run'));
    return Promise.resolve([
      'System',
      'explorer.exe',
      'steam.exe',
      ...(this.azeronOpen ? ['Azeron Software.exe'] : []),
      ...this.others,
    ]);
  }
}

const bytes = (text: string) => new TextEncoder().encode(text);

/** A game Steam lists as installed: its app id, Steam's name for it and its folder. */
export interface SteamApp {
  appId: string;
  name: string;
  installDir: string;
  /**
   * Installed in a second Steam library on this world's real temp folder (`World.steamLibrary`),
   * so its install folder is on the disk the games' files are read from; else in Steam's own
   * folder, in memory only.
   */
  onDisk?: true;
}

const manifest = (app: SteamApp) =>
  `"AppState"\n{\n\t"appid"\t"${app.appId}"\n\t"name"\t"${app.name}"\n\t"installdir"\t"${app.installDir}"\n}\n`;

/**
 * Steam with Helldivers 2 installed, and any other games given, in an in-memory disk. A game
 * `onDisk` is in the library at `library`, which libraryfolders.vdf lists as Steam would.
 */
function fakeSteam(others: readonly SteamApp[], library: string): SteamReaders {
  const steam = 'c:/steam';
  const second = library.replaceAll('\\', '/');
  const files: Record<string, string> = {
    [`${steam}/steamapps/libraryfolders.vdf`]: `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${library.replaceAll('\\', '\\\\')}"\n\t}\n}\n`,
  };
  for (const app of [
    { appId: HELLDIVERS2_APP_ID, name: 'HELLDIVERS 2', installDir: 'Helldivers 2' },
    ...others,
  ])
    files[`${app.onDisk === true ? second : steam}/steamapps/appmanifest_${app.appId}.acf`] =
      manifest(app);
  return {
    readRegistrySteamPath: () => Promise.resolve(steam),
    readFile: (path) => {
      const file = files[path];
      return Promise.resolve(file === undefined ? undefined : bytes(file));
    },
    listDir: (path) => {
      const prefix = `${path.replace(/\/$/, '')}/`;
      const names = new Set(
        Object.keys(files)
          .filter((file) => file.startsWith(prefix))
          .map((file) => file.slice(prefix.length).split('/')[0] as string),
      );
      return Promise.resolve(names.size > 0 ? [...names] : undefined);
    },
  };
}

// The world ---------------------------------------------------------------------------------

export interface WorldOptions {
  /**
   * What `hands.json` says before the app starts: unit id to hand. Default: LEFT_ID is the left
   * unit and RIGHT_ID the right one. `null` writes no file at all, and `'unreadable'` puts a
   * folder where the file should be, so it can't be read.
   */
  hands?: Record<number, Hand> | null | 'unreadable';
  /** What the unit with RIGHT_ID holds and runs when it is plugged in. Default: stock. */
  right?: Pick<FakeUnitOptions, 'slots' | 'running'>;
  /** Games Steam lists besides Helldivers 2. */
  steam?: readonly SteamApp[];
}

export class World {
  readonly clock = new Clock();
  readonly scheduler = new Scheduler();
  readonly processes = new FakeProcesses();
  readonly hid = new FakeHid();
  /** The unit with LEFT_ID, whatever hand `hands.json` gives it. */
  readonly left: PluggedUnit;
  /** The unit with RIGHT_ID. */
  readonly right: PluggedUnit;
  /** Not Azeron units: the rudder pedals and an Xbox controller, on the same bus. */
  readonly pedals: Bystander;
  readonly xboxPad: Bystander;
  /** Every state the app told the windows, in order. */
  readonly states: AppState[] = [];
  /**
   * The disk under the game-file target: the real one on this world's folder, which a test may
   * swap for one that fails.
   */
  gameDisk: GameFileDisk = nodeGameFileDisk;

  private services: Services | null = null;
  private running: RunningServices | null = null;
  private helmApi: HelmApi | null = null;

  private constructor(
    /** The folder everything of this world is in. */
    readonly root: string,
    right: WorldOptions['right'] = {},
    private readonly steamApps: readonly SteamApp[] = [],
  ) {
    this.left = this.hid.plugUnit({ serial: '8&2a1b3c4d&0&0000', deviceId: LEFT_ID });
    this.right = this.hid.plugUnit({ serial: '8&1f2e3d4c&0&0000', deviceId: RIGHT_ID, ...right });
    this.pedals = this.hid.plugBystander('The rudder pedals', PEDALS.vendorId, PEDALS.productId, 1);
    this.xboxPad = this.hid.plugBystander(
      'The Xbox controller',
      XBOX_PAD.vendorId,
      XBOX_PAD.productId,
      1,
    );
  }

  static async create(options: WorldOptions = {}): Promise<World> {
    const world = new World(
      await mkdtemp(join(tmpdir(), 'helm-integration-')),
      options.right,
      options.steam,
    );
    const hands =
      options.hands === undefined ? { [LEFT_ID]: 'left', [RIGHT_ID]: 'right' } : options.hands;
    await mkdir(world.dataDir, { recursive: true });
    if (hands === 'unreadable') await mkdir(world.handsFile);
    else if (hands !== null) await writeFile(world.handsFile, `${JSON.stringify(hands)}\n`);
    return world;
  }

  get dataDir(): string {
    return join(this.root, 'userData');
  }
  get logDir(): string {
    return join(this.root, 'logs');
  }
  get handsFile(): string {
    return join(this.dataDir, 'hands.json');
  }
  /** A Steam library on this world's folder: where a game Steam lists `onDisk` is installed. */
  get steamLibrary(): string {
    return join(this.root, 'SteamLibrary');
  }
  /** The install folder of a game Steam lists `onDisk`, by its folder name. */
  installDirOf(folder: string): string {
    return join(this.steamLibrary, 'steamapps', 'common', folder);
  }
  /** Where the games keep their files here: this world's `%LOCALAPPDATA%`. */
  get localAppData(): string {
    return join(this.root, 'local');
  }

  /** `window.helm`: what a page calls. */
  get helm(): HelmApi {
    if (!this.helmApi) throw new Error('The app is not running: call boot() first.');
    return this.helmApi;
  }

  /** The services, for what the windows cannot ask (the store, as the file side of it). */
  get app(): Services {
    if (!this.services) throw new Error('The app is not running: call boot() first.');
    return this.services;
  }

  /** The state the windows were last told. */
  get state(): AppState {
    return this.app.helm.state();
  }

  /**
   * Starts the app: composes the services, registers the IPC channels, starts them, and waits for
   * both units to have been read. A second call is a restart of the app over the same folders.
   */
  async boot(): Promise<void> {
    if (this.services) throw new Error('Already running: call quit() first.');
    // The folders exist before the app runs, as they do: Electron makes userData itself.
    await mkdir(this.dataDir, { recursive: true });
    const stateListeners = new Set<(event: unknown, ...args: unknown[]) => void>();
    const services = await composeServices({
      dataDir: this.dataDir,
      logDir: this.logDir,
      hid: this.hid,
      listProcesses: () => this.processes.list(),
      steam: fakeSteam(this.steamApps, this.steamLibrary),
      builtInGames: BUILT_IN_GAMES,
      gameFiles: {
        localAppData: [this.localAppData],
        kinds: TEST_GAME_KINDS,
        // Through `gameDisk` as it is at each call, so a test can swap it with the app running.
        disk: {
          folders: nodeGameFileDisk.folders,
          read: (path) => this.gameDisk.read(path),
          write: (path, bytes) => this.gameDisk.write(path, bytes),
          list: (dir) => this.gameDisk.list(dir),
          remove: (path) => this.gameDisk.remove(path),
          makeDir: (dir) => this.gameDisk.makeDir(dir),
        },
      },
      broadcast: (state) => {
        this.states.push(structuredClone(state));
        for (const listener of stateListeners) listener({}, structuredClone(state));
      },
      processPollMs: 60 * 60 * 1000,
      tuning: {
        devices: {
          schedule: this.scheduler.schedule,
          now: this.clock.now,
          pollMs: POLL_MS,
          runningMs: RUNNING_MS,
        },
        coordinator: { now: this.clock.now, recheckMs: 0 },
        gameFiles: { now: this.clock.now },
      },
    });

    // Electron's `ipcMain` and `ipcRenderer`, as two ends of one in-memory wire. What crosses it
    // is structured-cloned, as it is on the real one.
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipcMain: IpcRegistry = {
      handle: (channel, listener) => void handlers.set(channel, listener),
      removeHandler: (channel) => void handlers.delete(channel),
    };
    const bridge: IpcBridge = {
      invoke: async (channel, ...args) => {
        const handler = handlers.get(channel);
        if (!handler) throw new Error(`No handler for '${channel}'.`);
        return structuredClone(await handler({}, ...structuredClone(args)));
      },
      on: (channel, listener) => {
        if (channel === CHANNELS.stateChanged) stateListeners.add(listener);
      },
      removeListener: (channel, listener) => {
        if (channel === CHANNELS.stateChanged) stateListeners.delete(listener);
      },
    };
    registerHelmIpc(
      ipcMain,
      services.handlers(() => Promise.resolve()),
    );
    this.services = services;
    this.helmApi = createHelmApi(bridge);
    this.running = services.start();
    await this.until('both units to be read', () => {
      const { devices } = this.state;
      return devices.length === 2 && devices.every((chip) => chip.state === 'ready' && chip.read);
    });
    await this.idle();
  }

  /** Quits the app the way it quits: edits to disk, the units let go. The folders stay. */
  async quit(): Promise<void> {
    const running = this.running;
    this.running = null;
    this.services = null;
    this.helmApi = null;
    if (running) await running.shutdown();
  }

  /** Quits, and removes the folder. */
  async dispose(): Promise<void> {
    await this.quit();
    await rm(this.root, { recursive: true, force: true });
  }

  // Time ----------------------------------------------------------------------------------------

  /**
   * Waits until `ready()` holds, firing the devices service's poll timer between looks (the app
   * would have, a second at a time). A real wait, because the store and the log are on the real
   * disk; it ends in an error that says what was waited for.
   */
  async until(
    what: string,
    ready: () => boolean | Promise<boolean>,
    timeoutMs = 5000,
  ): Promise<void> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      if (await ready()) return;
      if (Date.now() > end) throw new Error(`Gave up waiting for ${what}.`);
      this.scheduler.fire(POLL_MS);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  /**
   * Lets what is already under way finish: the devices service's own jobs (a read, the question
   * about the running slot), the log lines, and the state being worked out from all of it.
   */
  async idle(): Promise<void> {
    // A job asked for now runs after every job asked for before it.
    await this.app.devices.exclusive(() => Promise.resolve());
    await this.app.log.flush();
    await this.app.helm.plansChanged();
  }

  /** The devices service asks each unit which slot it runs, as it does every few seconds. */
  async runningSlotTick(): Promise<void> {
    this.clock.advance(RUNNING_MS);
    this.scheduler.fire(RUNNING_MS);
    await this.idle();
  }

  /** The Azeron app opens or closes, and the watcher looks at the running programs. */
  async setAzeronApp(open: boolean): Promise<void> {
    this.processes.azeronOpen = open;
    await this.running?.processes.refresh();
  }

  // The owner, in the UI ------------------------------------------------------------------------

  /** Picks a game's preset: what a click on its card does. */
  async createScheme(preset: 'xbox' | 'keys', gameId = HELLDIVERS2): Promise<Scheme> {
    return this.helm.createScheme(gameId, preset);
  }

  /** The built-in game, as the editor holds it. */
  async game(gameId = HELLDIVERS2): Promise<Game> {
    const entry = (await this.helm.listGames()).find((g) => g.game.id === gameId);
    if (!entry) throw new Error(`No game ${gameId}.`);
    return entry.game;
  }

  /** What the editor shows of a scheme: the plan it resolves to, and the game's findings in it. */
  async planOf(scheme: Scheme): Promise<Plan> {
    return resolve(scheme, await this.game(scheme.gameId), BUILT_IN_DEVICES);
  }

  /**
   * A "Game's own keys" scheme as the preset made it before it placed anything (and as a scheme
   * saved then still is): key output, no button carrying an action, the sticks not set. Saved, as
   * the store has it.
   */
  async createBlankKeysScheme(): Promise<Scheme> {
    const created = await this.createScheme('keys');
    const blank: Scheme = {
      ...created,
      map: blankKeysScheme(await this.game()).map,
      behaviour: {},
    };
    await this.helm.saveScheme(blank);
    return this.scheme(created.id);
  }

  /**
   * A blank "Game's own keys" scheme (`createBlankKeysScheme`) with the six actions Helldivers 2
   * needs to start put on buttons (four on the left unit, two on the right), and the stick findings
   * kept: ready to apply.
   */
  async createKeysScheme(): Promise<Scheme> {
    const created = await this.createBlankKeysScheme();
    const game = await this.game();
    const placed = KEYS_PLACEMENTS.reduce(
      (scheme, [control, action]) =>
        assign(scheme, { mode: 'default', control, press: 'tap' }, action, game),
      created,
    );
    await this.helm.saveScheme(placed);
    return this.keepFindings(created.id);
  }

  /** "Keep, I know" on every error the editor lets the player keep, then save, as the editor does. */
  async keepFindings(schemeId: string): Promise<Scheme> {
    const scheme = await this.scheme(schemeId);
    const plan = await this.planOf(scheme);
    const kept = plan.findings
      .filter((finding) => finding.severity === 'error' && isAcceptable(finding))
      .reduce((s, finding) => acceptFinding(s, finding), scheme);
    await this.helm.saveScheme(kept);
    return kept;
  }

  /** The scheme as the store has it now (edits not yet on disk included). */
  async scheme(schemeId: string): Promise<Scheme> {
    const scheme = await this.helm.getScheme(schemeId);
    if (!scheme) throw new Error(`No scheme ${schemeId}.`);
    return scheme;
  }

  /** The editor saves an edit. */
  async edit(schemeId: string, change: (scheme: Scheme, game: Game) => Scheme): Promise<Scheme> {
    const next = change(await this.scheme(schemeId), await this.game());
    await this.helm.saveScheme(next);
    return next;
  }

  /** The drawer opens (`previewApply`) and Apply is pressed with what it showed. */
  async previewAndApply(schemeId: string) {
    const preview = await this.helm.previewApply(schemeId);
    const result = await this.helm.apply(schemeId, preview.fingerprint);
    return { preview, result };
  }

  /** The app is told a plugged-in unit has come back, and waits for it to be read. */
  async waitForBothUnits(): Promise<void> {
    await this.until('both units to be read', () => {
      const { devices } = this.state;
      return devices.length === 2 && devices.every((chip) => chip.state === 'ready' && chip.read);
    });
  }

  // What is on disk -----------------------------------------------------------------------------

  /** The text of `hands.json` as parsed. */
  async savedHands(): Promise<unknown> {
    return JSON.parse(await readFile(this.handsFile, 'utf8')) as unknown;
  }

  /** The exchange log, oldest line first. */
  async logLines(): Promise<string[]> {
    return this.app.log.recent(1000);
  }
}

// What a unit should hold ---------------------------------------------------------------------

/** What a fake unit stores for `hand`'s half of `plan`, written into `slot`, by input id, in hex. */
export function expectedSlot(plan: Plan, hand: Hand, slot: number): Record<number, string> {
  return Object.fromEntries(
    unitRecords(unitOf(plan, hand), DEVICE[hand]).map((record) => {
      const written = encodeRecord(slot, record);
      return [written[1] ?? 0, toHex(storedFromWritten(written))];
    }),
  );
}

/** What a fake unit holds in `slot`, by input id, in hex; undefined when it has no such slot. */
export function heldSlot(unit: PluggedUnit, slot: number): Record<number, string> | undefined {
  const held = unit.unit.slots.get(slot);
  return held
    ? Object.fromEntries([...held.records].map(([id, record]) => [id, toHex(record)]))
    : undefined;
}

/** Which slots a unit holds, by number and name, and which it runs. */
export function holding(unit: PluggedUnit): { slots: Record<number, string>; running: number } {
  return {
    slots: Object.fromEntries([...unit.unit.slots].map(([n, slot]) => [n, slot.name])),
    running: unit.unit.running,
  };
}

export { hidPath };
