import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, protocol, shell } from 'electron';
import { CHANNELS } from '../shared/api';
import { COVER_SCHEME } from '../shared/cover';
import { BUILT_IN_GAMES } from './built-in-games';
import { composeServices } from './compose';
import { answerCover } from './cover-protocol';
import { nodeHidBackend } from './hid-backend';
import { registerHelmIpc } from './ipc';
import { listProcesses } from './process-list';
import { steamReaders } from './steam-readers';
import { trayIconBitmap } from './tray-icon';
import { startupWindows } from './startup';
import { trayMenu } from './tray';
import { mainWindowOptions, playWindowOptions } from './windows';

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
  // How the services are put together is compose.ts: it is what the integration tests run too.
  const services = await composeServices({
    dataDir: app.getPath('userData'),
    logDir,
    hid: nodeHidBackend(),
    listProcesses,
    steam: steamReaders,
    builtInGames: BUILT_IN_GAMES,
    broadcast,
    processPollMs: PROCESS_POLL_MS,
  });

  // Steam covers. The protocol serves only the files the Steam read returned.
  protocol.handle(COVER_SCHEME, async (request) => {
    const answer = await answerCover(request.url, await services.library.coverFiles(), (path) =>
      readFile(path),
    );
    return answer.status === 200
      ? new Response(answer.body, { headers: { 'content-type': answer.mime } })
      : new Response(null, { status: 404 });
  });

  registerHelmIpc(
    ipcMain,
    services.handlers(async () => {
      const problem = await shell.openPath(logDir);
      if (problem) services.log.write('(app)', `couldn't open the log folder: ${problem}`);
    }),
  );

  return services.start().shutdown;
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
