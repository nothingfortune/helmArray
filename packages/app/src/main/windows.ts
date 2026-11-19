import type { BrowserWindowConstructorOptions } from 'electron';
import { color } from '../shared/tokens';

// Every window runs its page sandboxed, with no Node and an isolated context. The preload (the
// built file, given by the caller) is the only way in: it hands the page `window.helm`.
const webPreferences = (preload: string) =>
  ({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload,
  }) as const;

export function mainWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    title: 'helmArray',
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: color.bg,
    show: false,
    autoHideMenuBar: true,
    webPreferences: webPreferences(preload),
  };
}

// Play view: its own small window, kept on top of the game.
export function playWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    title: 'helmArray Play view',
    width: 1344,
    height: 660,
    minWidth: 640,
    minHeight: 360,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: color.bg,
    show: false,
    webPreferences: webPreferences(preload),
  };
}
