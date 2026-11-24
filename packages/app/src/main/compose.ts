// The services behind the windows, put together: the data store, the hands, the exchange log, the
// Steam library, the devices service and its gate, the coordinator, Apply. index.ts calls this
// with the real edges (node-hid, the process list, Steam's files, Electron's folders); the main
// process integration tests call it with fakes at those same edges, so what they run is the
// wiring the app runs, not a copy of it.
//
// Pure of Electron: nothing here imports it. What needs Electron stays in index.ts (the windows,
// the tray, the `helm-cover://` protocol, the IPC registration, opening a folder in Explorer).

import { join } from 'node:path';
import type { Game } from '@helmarray/core';
import { heldPlan } from '@helmarray/core';
import type { AppState } from '../shared/api';
import { createActivePlans } from './active-plans';
import { createApplyService } from './apply-service';
import type { ApplyService } from './apply-service';
import { createCoordinator } from './coordinator';
import type { Coordinator, CoordinatorDeps } from './coordinator';
import { Devices } from './devices';
import type { DeviceDeps } from './devices';
import { createDevicesGate } from './devices-gate';
import type { DevicesGate } from './devices-gate';
import { createExchangeLog, diskLogFiles } from './exchange-log';
import type { ExchangeLog } from './exchange-log';
import { jsonFileStorage, openHandStore } from './hands';
import type { HandStore } from './hands';
import { findUnits, openUnit } from './hid-transport';
import type { HidBackend } from './hid-transport';
import type { HelmHandlers } from './ipc';
import { createLibraryService } from './library';
import type { LibraryService } from './library';
import { azeronAppRunning, watchProcesses } from './processes';
import type { ProcessWatcher } from './processes';
import { readSteamLibrary } from './steam-library';
import type { SteamReaders } from './steam-library';
import { planFor } from './scheme-plan';
import { DataStore } from './store';
import { pendingChanges } from './sync-state';
import { reminders, settleReminder } from './reminders';

/** The things a test sets to make time deterministic; the app leaves them all alone. */
export interface ComposeTuning {
  /** `Devices`' timers and clock: how it schedules its poll and its running-slot ask. */
  devices?: Pick<DeviceDeps, 'schedule' | 'pollMs' | 'runningMs' | 'now'>;
  /** The coordinator's clock and its re-check interval (0 turns the re-check off). */
  coordinator?: Pick<CoordinatorDeps, 'now' | 'recheckMs'>;
}

export interface ComposeOptions {
  /** Electron's userData: the data folder (schemes, games, settings) and `hands.json`. */
  dataDir: string;
  /** Where the exchange log is kept. */
  logDir: string;
  /** The HID bus: node-hid in the app. */
  hid: HidBackend;
  /** A fresh list of the running programs' image names, every call. */
  listProcesses(): Promise<string[]>;
  /** Steam's files and registry. */
  steam: SteamReaders;
  /** The games that ship with the app. */
  builtInGames: readonly Game[];
  /** Told every new state, to send to the windows. */
  broadcast(state: AppState): void;
  /** How often the running programs are looked at, to see the Azeron app open or close. */
  processPollMs: number;
  tuning?: ComposeTuning;
}

/** What `start()` leaves running. */
export interface RunningServices {
  /** The watcher of the running programs (`refresh()` looks now). */
  processes: ProcessWatcher;
  /** Lets go of everything on the way out: the units last, once edits are on disk. */
  shutdown(): Promise<void>;
}

export interface Services {
  data: DataStore;
  hands: HandStore;
  library: LibraryService;
  devices: Devices;
  gate: DevicesGate;
  helm: Coordinator;
  apply: ApplyService;
  log: ExchangeLog;
  /** What the windows may ask for. `openLogFolder` is Electron's, so the caller brings it. */
  handlers(openLogFolder: () => Promise<void>): HelmHandlers;
  /**
   * Starts following the units, and the running programs: the units are talked to only while the
   * Azeron app is closed, so the first look at the running programs starts the service and each
   * change after that stops or starts it.
   */
  start(): RunningServices;
}

/** Builds every service, in the order the app needs them. Nothing is started until `start()`. */
export async function composeServices(options: ComposeOptions): Promise<Services> {
  const { tuning } = options;
  await diskLogFiles.ensureDir(options.logDir);
  const log = createExchangeLog({ dir: options.logDir });

  let hands: HandStore;
  try {
    hands = await openHandStore(jsonFileStorage(join(options.dataDir, 'hands.json')));
  } catch (error) {
    // Unreadable file: the units are asked again this run rather than the app not starting.
    log.write('(app)', `the saved hands couldn't be read: ${String(error)}`);
    hands = await openHandStore({
      load: () => Promise.resolve(undefined),
      save: () => Promise.resolve(),
    });
  }

  // The schemes, games and settings. A file that can't be read is reported, never replaced.
  const data = await DataStore.open({
    root: options.dataDir,
    builtInGames: options.builtInGames,
    onProblem: (problem) => log.write('(app)', `${problem.file}: ${problem.message}`),
    onNote: (file, message) => log.write('(app)', `${file}: ${message}`),
  });

  // Apply, and what the pill compares the units with. Both read the store as it is now, edits
  // not yet written to disk included.
  const plans = {
    getScheme: (id: string) => data.getScheme(id),
    getGame: async (gameId: string) =>
      (await data.listGames()).find((entry) => entry.game.id === gameId)?.game,
  };
  // Steam's games and covers. The protocol serves only the files the Steam read returned.
  const library = createLibraryService({
    readSteam: () => readSteamLibrary(options.steam),
    games: () => data.listGames(),
    listSchemes: (gameId) => data.listSchemes(gameId),
    activeSchemeOf: (gameId) => data.activeSchemeOf(gameId),
    lastApplied: (gameId) => data.lastApplied(gameId),
    changesOf: async (schemeId) => {
      const now = await planFor(schemeId, plans);
      return pendingChanges(await data.getApplied(schemeId), now.ok ? now.plan : null);
    },
  });

  const hid = options.hid;
  // A fresh listing every time, never the watcher's last answer; a listing that fails throws.
  const azeronOpen = async () => azeronAppRunning(await options.listProcesses());
  const devices = new Devices({
    azeronAppRunning: azeronOpen,
    findUnits: () => findUnits(hid),
    openUnit: (path) => openUnit(hid, path),
    trace: (path, line) => log.write(path, line),
    ...tuning?.devices,
  });
  const gate = createDevicesGate(devices, (error) => log.write('(app)', String(error)));
  const helm: Coordinator = createCoordinator({
    devices: {
      snapshot: () => devices.snapshot(),
      onChange: (listener) => devices.onChange(() => listener()),
    },
    hands,
    gate,
    readLog: (lines) => log.recent(lines),
    active: () => data.active(),
    unitsHeld: () => data.unitsHeld(),
    sheets: () => reminders(data),
    plans: createActivePlans({
      ...plans,
      active: () => data.active(),
      getApplied: (id) => data.getApplied(id),
    }),
    // No state is worked out half way through a write; Apply asks for it when it is done.
    suspended: () => apply.busy(),
    trace: (unit, line) => log.write(unit, line),
    ...tuning?.coordinator,
  });
  helm.onState(options.broadcast);
  const apply = createApplyService({
    plans,
    devices,
    hands,
    azeronAppRunning: azeronOpen,
    saveApplied: (schemeId, plan) => data.saveApplied(schemeId, plan),
    recordUnits: (plan, outcomes, who) => data.recordApply(plan, outcomes, who),
    unitsHeld: () => data.unitsHeld(),
    saveScheme: (scheme) => data.saveScheme(scheme),
    setActive: (gameId, schemeId) => data.setActive(gameId, schemeId),
    // The game holds its baseline: what it ships, moved only by Done (never by an apply alone,
    // since the person may not have set the game's controls yet).
    gameHolds: async (gameId) => heldPlan(await data.heldBindings(gameId)),
    settled: () => helm.plansChanged(),
    trace: (line) => log.write('(apply)', line),
  });

  return {
    data,
    hands,
    library,
    devices,
    gate,
    helm,
    apply,
    log,
    handlers: (openLogFolder) => ({
      state: () => helm.state(),
      chooseHand: (unitId, hand) => helm.chooseHand(unitId, hand),
      recentLog: (lines) => helm.recentLog(lines),
      openLogFolder,
      listGames: () => data.listGames(),
      listLibrary: (refresh) => library.list(refresh),
      getScheme: (id) => data.getScheme(id),
      listSchemes: (gameId) => data.listSchemes(gameId),
      createScheme: (gameId, preset) => data.createSchemeFromPreset(gameId, preset),
      copyScheme: (schemeId) => data.copyScheme(schemeId),
      deleteScheme: async (schemeId) => {
        await data.deleteScheme(schemeId);
        // It may have been the active scheme, which the pill judges.
        await helm.activeChanged();
      },
      saveScheme: async (scheme) => {
        data.saveScheme(scheme);
        // The pill compares the edit with what was applied, at once; the file follows later.
        void helm.plansChanged();
      },
      setActive: async (gameId, schemeId) => {
        await data.setActive(gameId, schemeId);
        await helm.activeChanged();
      },
      previewApply: (schemeId) => apply.preview(schemeId),
      apply: (schemeId, fingerprint) => apply.apply(schemeId, fingerprint),
      saveGame: async (game) => {
        data.saveGame(game);
        // A setup of this game may resolve differently now: the pill looks again at once.
        void helm.plansChanged();
      },
      deleteGame: async (gameId) => {
        await data.deleteGame(gameId);
        await helm.plansChanged();
      },
      dismissSheet: async (gameId) => {
        await settleReminder(data, gameId);
        await helm.plansChanged();
      },
    }),
    start: () => {
      helm.start();
      const processes = watchProcesses(
        {
          listProcesses: options.listProcesses,
          onChange: (state) => helm.azeronChanged(state),
          onError: (error) =>
            log.write('(app)', `couldn't list the running programs: ${String(error)}`),
        },
        options.processPollMs,
      );
      return {
        processes,
        shutdown: async () => {
          processes.stop();
          helm.stop();
          // Edits waiting their turn to be saved are written before anything else is let go.
          await data
            .flush()
            .catch((error: unknown) => log.write('(app)', `quitting: ${String(error)}`));
          await gate.shutdown();
          await log.flush();
        },
      };
    },
  };
}
