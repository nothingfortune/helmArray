import { join } from 'node:path';
import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, shell } from 'electron';
import { CHANNELS } from '../shared/api';
import { createCoordinator } from './coordinator';
import type { Coordinator } from './coordinator';
import { Devices } from './devices';
import { createDevicesGate } from './devices-gate';
import { createExchangeLog, diskLogFiles } from './exchange-log';
import { jsonFileStorage, openHandStore } from './hands';
import type { HandStore } from './hands';
import { nodeHidBackend } from './hid-backend';
import { findUnits, openUnit } from './hid-transport';
import { registerHelmIpc } from './ipc';
import { listProcesses } from './process-list';
import { watchProcesses } from './processes';
import { trayIconBitmap } from './tray-icon';
import { startupWindows } from './startup';
import { trayMenu } from './tray';
import { mainWindowOptions, playWindowOptions } from './windows';

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
  mainWindow.once('ready-to-show', () => mainWindow?.show());
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

  const hid = nodeHidBackend();
  const devices = new Devices({
    findUnits: () => findUnits(hid),
    openUnit: (path) => openUnit(hid, path),
    trace: (path, line) => log.write(path, line),
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
    trace: (unit, line) => log.write(unit, line),
  });
  helm.onState(broadcast);

  registerHelmIpc(ipcMain, {
    state: () => helm.state(),
    chooseHand: (unitId, hand) => helm.chooseHand(unitId, hand),
    recentLog: (lines) => helm.recentLog(lines),
    openLogFolder: async () => {
      const problem = await shell.openPath(logDir);
      if (problem) log.write('(app)', `couldn't open the log folder: ${problem}`);
    },
  });

  helm.start();
  // The units are talked to only while the Azeron app is closed: the first look at the running
  // programs starts the service, and each change after that stops or starts it.
  const watcher = watchProcesses(
    {
      listProcesses,
      onChange: (state) => helm.azeronChanged(state),
      onError: (error) =>
        log.write('(app)', `couldn't list the running programs: ${String(error)}`),
    },
    PROCESS_POLL_MS,
  );

  return async () => {
    watcher.stop();
    helm.stop();
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
