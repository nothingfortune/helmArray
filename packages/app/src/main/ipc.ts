// What a window may ask of the main process, over the channels in shared/api.ts. Pure: the
// `ipcMain` it registers on is handed in (a fake in tests), and everything a window sends is
// checked here, because a window's page is not trusted.

import type { AppState, Hand } from '../shared/api';
import { CHANNELS } from '../shared/api';

/** The part of Electron's `ipcMain` this uses. */
export interface IpcRegistry {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface HelmHandlers {
  state(): AppState;
  chooseHand(unitId: number, hand: Hand): Promise<void>;
  recentLog(lines: number): Promise<string[]>;
  openLogFolder(): Promise<void>;
}

/** The most log lines one request may ask for. */
export const MAX_LOG_LINES = 1000;

/** Registers every channel. Returns the way to take them all off again. */
export function registerHelmIpc(ipc: IpcRegistry, handlers: HelmHandlers): () => void {
  ipc.handle(CHANNELS.state, () => handlers.state());
  ipc.handle(CHANNELS.chooseHand, (_event, unitId, hand) => {
    if (typeof unitId !== 'number' || !Number.isInteger(unitId))
      throw new TypeError('chooseHand: the unit id must be a whole number.');
    if (hand !== 'left' && hand !== 'right')
      throw new TypeError('chooseHand: the hand must be "left" or "right".');
    return handlers.chooseHand(unitId, hand);
  });
  ipc.handle(CHANNELS.recentLog, (_event, lines) => {
    const count = typeof lines === 'number' && Number.isFinite(lines) ? Math.floor(lines) : 0;
    return handlers.recentLog(Math.min(Math.max(count, 0), MAX_LOG_LINES));
  });
  ipc.handle(CHANNELS.openLogFolder, () => handlers.openLogFolder());
  return () => {
    for (const channel of [
      CHANNELS.state,
      CHANNELS.chooseHand,
      CHANNELS.recentLog,
      CHANNELS.openLogFolder,
    ]) {
      ipc.removeHandler(channel);
    }
  };
}
