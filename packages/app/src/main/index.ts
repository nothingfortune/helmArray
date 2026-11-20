import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, protocol, shell } from 'electron';
import { CHANNELS } from '../shared/api';
import { COVER_SCHEME } from '../shared/cover';
import { BUILT_IN_GAMES } from './built-in-games';
import { createActivePlans } from './active-plans';
import { createApplyService } from './apply-service';
import { answerCover } from './cover-protocol';
import { createCoordinator } from './coordinator';
import type { Coordinator } from './coordinator';
import { Devices } from './devices';
import { createDevicesGate } from './devices-gate';
import { E2E_CONTROL_GLOBAL, chooseBackends, e2eConfig } from './e2e-seam';
import { createExchangeLog, diskLogFiles } from './exchange-log';
import { jsonFileStorage, openHandStore } from './hands';
import type { HandStore } from './hands';
import { nodeHidBackend } from './hid-backend';
import { findUnits, openUnit } from './hid-transport';
import { registerHelmIpc } from './ipc';
import { createLibraryService } from './library';
import { listProcesses } from './process-list';
import { azeronAppRunning, watchProcesses } from './processes';
import { readSteamLibrary } from './steam-library';
import { steamReaders } from './steam-readers';
import { DataStore } from './store';
import { trayIconBitmap } from './tray-icon';
import { startupWindows } from './startup';
import { trayMenu } from './tray';
import { mainWindowOptions, playWindowOptions } from './windows';

// A test run (HELM_E2E=1, see e2e-seam.ts) keeps its files in a temp folder and uses fakes for
// everything outside the app. Read before anything else; a half-set switch stops the app.
const e2e = e2eConfig(process.env);
if (e2e) {
  app.setPath('userData', e2e.dataDir);
  app.setPath('sessionData', join(e2e.dataDir, 'session'));
  app.setPath('logs', join(e2e.dataDir, 'logs'));
}

// Must be said before the app is ready: the windows' pages may then load `helm-cover://` images.
protocol.registerSchemesAsPrivileged([
  { scheme: COVER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let mainWindow: BrowserWindow | null = null;
let playWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// How often the running programs are looked at, to see the Azeron app open or close.
const PROCESS_POLL_MS = 2000;
// How long quitting waits for the units to be let go before it quits anyway.
const QUIT_WAIT_MS = 3000;

const preloadPath = () => join(import.meta.dirname, '../preload/index.cjs');

function load(window: BrowserWindow, page: 'index' | 'play'): void {
  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (devServer) void window.loadURL(`${devServer}/${page}.html`);
  else void window.loadFile(join(import.meta.dirname, `../renderer/${page}.html`));
}

function openMainWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow(mainWindowOptions(preloadPath()));
  // A test run doesn't take the keyboard focus from whoever is at the machine.
  mainWindow.once('ready-to-show', () => (e2e ? mainWindow?.showInactive() : mainWindow?.show()));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  load(mainWindow, 'index');
}

function openPlayView(): void {
  if (playWindow) {
    playWindow.show();
    playWindow.focus();
    return;
  }
  playWindow = new BrowserWindow(playWindowOptions(preloadPath()));
  playWindow.once('ready-to-show', () => playWindow?.show());
  playWindow.on('closed', () => {
    playWindow = null;
  });
  load(playWindow, 'play');
}

function createTray(): void {
  const icon = trayIconBitmap(32);
  const image = nativeImage.createFromBitmap(icon.pixels, {
    width: icon.width,
    height: icon.height,
  });
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip('helmArray');
  tray.setContextMenu(
    Menu.buildFromTemplate(trayMenu({ activeGame: null, openPlayView, quit: () => app.quit() })),
  );
  tray.on('click', openMainWindow);
}

/** Tells every open window the new state. */
function broadcast(state: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.stateChanged, state);
  }
}

/** Starts everything behind the windows. Returns how to let go of the units on the way out. */
async function startServices(): Promise<() => Promise<void>> {
  const logDir = app.getPath('logs');
  await diskLogFiles.ensureDir(logDir);
  const log = createExchangeLog({ dir: logDir });

  let hands: HandStore;
  try {
    hands = await openHandStore(jsonFileStorage(join(app.getPath('userData'), 'hands.json')));
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
    root: app.getPath('userData'),
    builtInGames: BUILT_IN_GAMES,
    onProblem: (problem) => log.write('(app)', `${problem.file}: ${problem.message}`),
  });

  // Steam's games and covers. The protocol serves only the files the Steam read returned.
  // Everything outside the app: real ones, or under a test run the fakes and never the real.
  const outside = await chooseBackends(e2e, {
    real: () => ({ hid: nodeHidBackend(), listProcesses, steam: steamReaders }),
    fake: async (config) => (await import('./e2e-fakes')).fakeBackends(config),
  });
  if (outside.control !== undefined) {
    (globalThis as Record<string, unknown>)[E2E_CONTROL_GLOBAL] = outside.control;
  }

  const library = createLibraryService({
    readSteam: () => readSteamLibrary(outside.steam),
    games: () => data.listGames(),
    listSchemes: (gameId) => data.listSchemes(gameId),
    activeSchemeOf: (gameId) => data.activeSchemeOf(gameId),
    lastApplied: (gameId) => data.lastApplied(gameId),
  });
  protocol.handle(COVER_SCHEME, async (request) => {
    const answer = await answerCover(request.url, await library.coverFiles(), (path) =>
      readFile(path),
    );
    return answer.status === 200
      ? new Response(answer.body, { headers: { 'content-type': answer.mime } })
      : new Response(null, { status: 404 });
  });

  const hid = outside.hid;
  // A fresh listing every time, never the watcher's last answer; a listing that fails throws.
  const azeronOpen = async () => azeronAppRunning(await outside.listProcesses());
  const devices = new Devices({
    azeronAppRunning: azeronOpen,
    findUnits: () => findUnits(hid),
    openUnit: (path) => openUnit(hid, path),
    trace: (path, line) => log.write(path, line),
  });
  // Apply, and what the pill compares the units with. Both read the store as it is now, edits
  // not yet written to disk included.
  const plans = {
    getScheme: (id: string) => data.getScheme(id),
    getGame: async (gameId: string) =>
      (await data.listGames()).find((entry) => entry.game.id === gameId)?.game,
  };
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
    plans: createActivePlans({
      ...plans,
      active: () => data.active(),
      getApplied: (id) => data.getApplied(id),
    }),
    // No state is worked out half way through a write; Apply asks for it when it is done.
    suspended: () => apply.busy(),
    trace: (unit, line) => log.write(unit, line),
  });
  helm.onState(broadcast);
  const apply = createApplyService({
    plans,
    devices,
    hands,
    azeronAppRunning: azeronOpen,
    saveApplied: (schemeId, plan) => data.saveApplied(schemeId, plan),
    saveScheme: (scheme) => data.saveScheme(scheme),
    setActive: (gameId, schemeId) => data.setActive(gameId, schemeId),
    settled: () => helm.plansChanged(),
    trace: (line) => log.write('(apply)', line),
  });

  registerHelmIpc(ipcMain, {
    state: () => helm.state(),
    chooseHand: (unitId, hand) => helm.chooseHand(unitId, hand),
    recentLog: (lines) => helm.recentLog(lines),
    openLogFolder: async () => {
      const problem = await shell.openPath(logDir);
      if (problem) log.write('(app)', `couldn't open the log folder: ${problem}`);
    },
    listGames: () => data.listGames(),
    listLibrary: (refresh) => library.list(refresh),
    getScheme: (id) => data.getScheme(id),
    listSchemes: (gameId) => data.listSchemes(gameId),
    createScheme: (gameId, preset) => data.createSchemeFromPreset(gameId, preset),
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
  });

  helm.start();
  // The units are talked to only while the Azeron app is closed: the first look at the running
  // programs starts the service, and each change after that stops or starts it.
  const watcher = watchProcesses(
    {
      listProcesses: outside.listProcesses,
      onChange: (state) => helm.azeronChanged(state),
      onError: (error) =>
        log.write('(app)', `couldn't list the running programs: ${String(error)}`),
    },
    PROCESS_POLL_MS,
  );

  return async () => {
    watcher.stop();
    helm.stop();
    // Edits waiting their turn to be saved are written before anything else is let go.
    await data.flush().catch((error: unknown) => log.write('(app)', `quitting: ${String(error)}`));
    await gate.shutdown();
    await log.flush();
  };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    for (const name of startupWindows(argv)) (name === 'play' ? openPlayView : openMainWindow)();
  });
  // Closing the windows keeps the app in the tray; Quit is in the tray menu.
  app.on('window-all-closed', () => undefined);
  void app.whenReady().then(async () => {
    createTray();
    let shutdown: () => Promise<void> = () => Promise.resolve();
    try {
      shutdown = await startServices();
    } catch (error) {
      // The windows still open; they will say the state can’t be had.
      console.error('helmArray couldn’t start its services', error);
    }
    // Quitting lets go of the units first, so no unit is left open and the next start finds it
    // free; it quits anyway if that takes too long.
    let leaving = false;
    app.on('before-quit', (event) => {
      if (leaving) return;
      leaving = true;
      event.preventDefault();
      void Promise.race([shutdown(), new Promise((resolve) => setTimeout(resolve, QUIT_WAIT_MS))])
        .catch(() => undefined)
        .finally(() => app.quit());
    });
    for (const name of startupWindows(process.argv))
      (name === 'play' ? openPlayView : openMainWindow)();
  });
}
