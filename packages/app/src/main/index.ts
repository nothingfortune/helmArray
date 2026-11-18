import { join } from 'node:path';
import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron';
import { trayIconBitmap } from './tray-icon';
import { startupWindows } from './startup';
import { trayMenu } from './tray';
import { mainWindowOptions, playWindowOptions } from './windows';

let mainWindow: BrowserWindow | null = null;
let playWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

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
  mainWindow = new BrowserWindow(mainWindowOptions());
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
  playWindow = new BrowserWindow(playWindowOptions());
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    for (const name of startupWindows(argv)) (name === 'play' ? openPlayView : openMainWindow)();
  });
  // Closing the windows keeps the app in the tray; Quit is in the tray menu.
  app.on('window-all-closed', () => undefined);
  void app.whenReady().then(() => {
    createTray();
    for (const name of startupWindows(process.argv))
      (name === 'play' ? openPlayView : openMainWindow)();
  });
}
