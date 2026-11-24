// `window.helm`: what the preload gives a page. Built over a small bridge instead of Electron's
// `ipcRenderer` directly, so it can be tested without Electron.

import type { Scheme } from '@helmarray/core';
import type {
  AppState,
  ApplyPreview,
  ApplyResult,
  GameEntry,
  HelmApi,
  LibraryEntry,
} from '../shared/api';
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
    listGames: () => bridge.invoke(CHANNELS.listGames) as Promise<GameEntry[]>,
    listLibrary: (refresh) =>
      bridge.invoke(CHANNELS.listLibrary, refresh === true) as Promise<LibraryEntry[]>,
    getScheme: (id) => bridge.invoke(CHANNELS.getScheme, id) as Promise<Scheme | null>,
    listSchemes: (gameId) => bridge.invoke(CHANNELS.listSchemes, gameId) as Promise<Scheme[]>,
    createScheme: (gameId, preset) =>
      bridge.invoke(CHANNELS.createScheme, gameId, preset) as Promise<Scheme>,
    saveScheme: async (scheme) => {
      await bridge.invoke(CHANNELS.saveScheme, scheme);
    },
    setActive: async (gameId, schemeId) => {
      await bridge.invoke(CHANNELS.setActive, gameId, schemeId);
    },
    previewApply: (schemeId) =>
      bridge.invoke(CHANNELS.previewApply, schemeId) as Promise<ApplyPreview>,
    apply: (schemeId, fingerprint) =>
      bridge.invoke(CHANNELS.apply, schemeId, fingerprint) as Promise<ApplyResult>,
    saveGame: async (game) => {
      await bridge.invoke(CHANNELS.saveGame, game);
    },
    deleteGame: async (gameId) => {
      await bridge.invoke(CHANNELS.deleteGame, gameId);
    },
  };
}
