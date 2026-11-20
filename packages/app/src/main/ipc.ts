// What a window may ask of the main process, over the channels in shared/api.ts. Pure: the
// `ipcMain` it registers on is handed in (a fake in tests), and everything a window sends is
// checked here, because a window's page is not trusted.

import type { Scheme } from '@helmarray/core';
import type {
  AppState,
  ApplyPreview,
  ApplyResult,
  GameEntry,
  Hand,
  LibraryEntry,
  Preset,
} from '../shared/api';
import { CHANNELS } from '../shared/api';
import { isSafeId, isScheme } from './store';

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
  listGames(): Promise<GameEntry[]>;
  listLibrary(refresh: boolean): Promise<LibraryEntry[]>;
  getScheme(id: string): Promise<Scheme | null>;
  listSchemes(gameId: string): Promise<Scheme[]>;
  createScheme(gameId: string, preset: Preset): Promise<Scheme>;
  saveScheme(scheme: Scheme): Promise<void>;
  setActive(gameId: string, schemeId: string | null): Promise<void>;
  previewApply(schemeId: string): Promise<ApplyPreview>;
  apply(schemeId: string, fingerprint: string): Promise<ApplyResult>;
}

const PRESETS: readonly string[] = ['xbox', 'keys'] satisfies Preset[];

function idArg(name: string, value: unknown): string {
  if (!isSafeId(value)) throw new TypeError(`${name}: that isn't an id.`);
  return value;
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
  ipc.handle(CHANNELS.listGames, () => handlers.listGames());
  ipc.handle(CHANNELS.listLibrary, (_event, refresh) => handlers.listLibrary(refresh === true));
  ipc.handle(CHANNELS.getScheme, (_event, id) => handlers.getScheme(idArg('getScheme', id)));
  ipc.handle(CHANNELS.listSchemes, (_event, gameId) =>
    handlers.listSchemes(idArg('listSchemes', gameId)),
  );
  ipc.handle(CHANNELS.createScheme, (_event, gameId, preset) => {
    const game = idArg('createScheme', gameId);
    if (typeof preset !== 'string' || !PRESETS.includes(preset))
      throw new TypeError('createScheme: the preset must be "xbox" or "keys".');
    return handlers.createScheme(game, preset as Preset);
  });
  ipc.handle(CHANNELS.saveScheme, (_event, scheme) => {
    if (!isScheme(scheme)) throw new TypeError("saveScheme: that isn't a scheme.");
    return handlers.saveScheme(scheme);
  });
  ipc.handle(CHANNELS.setActive, (_event, gameId, schemeId) => {
    const game = idArg('setActive', gameId);
    return handlers.setActive(game, schemeId === null ? null : idArg('setActive', schemeId));
  });
  ipc.handle(CHANNELS.previewApply, (_event, schemeId) =>
    handlers.previewApply(idArg('previewApply', schemeId)),
  );
  ipc.handle(CHANNELS.apply, (_event, schemeId, fingerprint) => {
    if (typeof fingerprint !== 'string')
      throw new TypeError('apply: the fingerprint must be text.');
    return handlers.apply(idArg('apply', schemeId), fingerprint);
  });
  return () => {
    for (const channel of [
      CHANNELS.state,
      CHANNELS.chooseHand,
      CHANNELS.recentLog,
      CHANNELS.openLogFolder,
      CHANNELS.listGames,
      CHANNELS.listLibrary,
      CHANNELS.getScheme,
      CHANNELS.listSchemes,
      CHANNELS.createScheme,
      CHANNELS.saveScheme,
      CHANNELS.setActive,
      CHANNELS.previewApply,
      CHANNELS.apply,
    ]) {
      ipc.removeHandler(channel);
    }
  };
}
