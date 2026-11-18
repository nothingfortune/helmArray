import type { BrowserWindowConstructorOptions } from 'electron';
import { color } from '../shared/tokens';

// Every window runs its page sandboxed, with no Node and an isolated context.
const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
} as const;

export function mainWindowOptions(): BrowserWindowConstructorOptions {
  return {
    title: 'helmArray',
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: color.bg,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { ...webPreferences },
  };
}

// Play view: its own small window, kept on top of the game.
export function playWindowOptions(): BrowserWindowConstructorOptions {
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
    webPreferences: { ...webPreferences },
  };
}
