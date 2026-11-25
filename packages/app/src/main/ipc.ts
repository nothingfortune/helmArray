// What a window may ask of the main process, over the channels in shared/api.ts. Pure: the
// `ipcMain` it registers on is handed in (a fake in tests), and everything a window sends is
// checked here, because a window's page is not trusted.

import type { ActionMove, Game, Scheme } from '@helmarray/core';
import { gameProblem } from '@helmarray/core';
import type {
  AppState,
  ApplyPreview,
  ApplyResult,
  GameEntry,
  GameFileRead,
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
  copyScheme(schemeId: string): Promise<Scheme>;
  deleteScheme(schemeId: string): Promise<void>;
  saveScheme(scheme: Scheme): Promise<void>;
  setActive(gameId: string, schemeId: string | null): Promise<void>;
  previewApply(schemeId: string): Promise<ApplyPreview>;
  apply(schemeId: string, fingerprint: string): Promise<ApplyResult>;
  saveGame(game: Game): Promise<void>;
  saveFileRead(game: Game, moves: ActionMove[]): Promise<void>;
  deleteGame(gameId: string): Promise<void>;
  dismissSheet(gameId: string): Promise<void>;
  readGameFile(gameId: string): Promise<GameFileRead>;
  restoreGame(gameId: string): Promise<void>;
}

const PRESETS: readonly string[] = ['xbox', 'keys'] satisfies Preset[];

/** A sentence from `gameProblem` as the second half of one: its first word lowered unless a name. */
const lowerFirst = (text: string) =>
  /^(The|This|Every|Two|Whether) /.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;

function idArg(name: string, value: unknown): string {
  if (!isSafeId(value)) throw new TypeError(`${name}: that isn't an id.`);
  return value;
}

/**
 * A game a window sends to be saved. The whole game is checked here, not only its shape: what a
 * window sends isn't trusted, and a mode id becomes a key of every scheme's map.
 */
function gameArg(name: string, game: unknown): Game {
  const problem = gameProblem(game);
  if (problem !== null) throw new TypeError(`${name}: ${lowerFirst(problem)}`);
  if (!isSafeId((game as Game).id))
    throw new TypeError(`${name}: this game's id can't be used as a file name.`);
  return game as Game;
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/**
 * The actions of yours that took the ids of the game's file, as a window sends them: each from an
 * id the game no longer has to an action it has, in the mode it is in.
 */
function movesArg(game: Game, moves: unknown): ActionMove[] {
  if (!Array.isArray(moves)) throw new TypeError("saveFileRead: the moves aren't a list.");
  return moves.map((move: unknown) => {
    const m = move as Partial<Record<keyof ActionMove, unknown>> | null;
    if (
      typeof m !== 'object' ||
      m === null ||
      !isText(m.action) ||
      !isText(m.mode) ||
      !isText(m.to) ||
      !isText(m.toMode)
    )
      throw new TypeError("saveFileRead: a move isn't one helmArray can follow.");
    const { action, mode, to, toMode } = m;
    if (!game.actions.some((a) => a.id === to && a.mode === toMode))
      throw new TypeError("saveFileRead: a move names an action the game doesn't have.");
    if (game.actions.some((a) => a.id === action))
      throw new TypeError('saveFileRead: a move names an action the game still has.');
    return { action, mode, to, toMode };
  });
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
  ipc.handle(CHANNELS.copyScheme, (_event, schemeId) =>
    handlers.copyScheme(idArg('copyScheme', schemeId)),
  );
  ipc.handle(CHANNELS.deleteScheme, (_event, schemeId) =>
    handlers.deleteScheme(idArg('deleteScheme', schemeId)),
  );
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
  ipc.handle(CHANNELS.saveGame, (_event, game) => handlers.saveGame(gameArg('saveGame', game)));
  ipc.handle(CHANNELS.saveFileRead, (_event, game, moves) => {
    const checked = gameArg('saveFileRead', game);
    return handlers.saveFileRead(checked, movesArg(checked, moves));
  });
  ipc.handle(CHANNELS.deleteGame, (_event, gameId) =>
    handlers.deleteGame(idArg('deleteGame', gameId)),
  );
  ipc.handle(CHANNELS.dismissSheet, (_event, gameId) =>
    handlers.dismissSheet(idArg('dismissSheet', gameId)),
  );
  ipc.handle(CHANNELS.readGameFile, (_event, gameId) =>
    handlers.readGameFile(idArg('readGameFile', gameId)),
  );
  ipc.handle(CHANNELS.restoreGame, (_event, gameId) =>
    handlers.restoreGame(idArg('restoreGame', gameId)),
  );
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
      CHANNELS.copyScheme,
      CHANNELS.deleteScheme,
      CHANNELS.saveScheme,
      CHANNELS.setActive,
      CHANNELS.previewApply,
      CHANNELS.apply,
      CHANNELS.saveGame,
      CHANNELS.saveFileRead,
      CHANNELS.deleteGame,
      CHANNELS.dismissSheet,
      CHANNELS.readGameFile,
      CHANNELS.restoreGame,
    ]) {
      ipc.removeHandler(channel);
    }
  };
}
