// `window.helm`: what the preload gives a page. Built over a small bridge instead of Electron's
// `ipcRenderer` directly, so it can be tested without Electron.

import type { AppState, HelmApi } from '../shared/api';
import { CHANNELS } from '../shared/api';

type Listener = (event: unknown, ...args: unknown[]) => void;

/** The part of `ipcRenderer` this uses. */
export interface IpcBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: Listener): void;
  removeListener(channel: string, listener: Listener): void;
}

export function createHelmApi(bridge: IpcBridge): HelmApi {
  return {
    state: () => bridge.invoke(CHANNELS.state) as Promise<AppState>,
    onState: (listener) => {
      // The page gets the state alone, never Electron's event object.
      const forward: Listener = (_event, state) => listener(state as AppState);
      bridge.on(CHANNELS.stateChanged, forward);
      return () => bridge.removeListener(CHANNELS.stateChanged, forward);
    },
    chooseHand: async (unitId, hand) => {
      await bridge.invoke(CHANNELS.chooseHand, unitId, hand);
    },
    recentLog: (lines) => bridge.invoke(CHANNELS.recentLog, lines) as Promise<string[]>,
    openLogFolder: async () => {
      await bridge.invoke(CHANNELS.openLogFolder);
    },
  };
}
