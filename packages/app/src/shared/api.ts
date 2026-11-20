// What the main process tells the windows, and what a window may ask of it. Plain data only:
// it crosses IPC by structured clone. The preload exposes `HelmApi` as `window.helm`.

import type { Game, Scheme } from '@helmarray/core';

export type Hand = 'left' | 'right';

/** A game in the library: built into the app, or one the user added. */
export interface GameEntry {
  game: Game;
  /** True for a game that ships with the app; false for one added by hand. */
  builtIn: boolean;
}

/** One scheme of a game, as the Library lists it. */
export interface LibrarySchemeRef {
  id: string;
  name: string;
  output: Scheme['output'];
}

/**
 * One game in the Library: an installed Steam game, a game helmArray knows that Steam doesn't
 * list (not installed, or added by hand), or both in one entry (matched on the Steam app id).
 * Plain data: no file paths ever reach a window; covers are fetched by `coverUrl`.
 */
export interface LibraryEntry {
  /** Steam's name for the game, or the known game's own name when Steam doesn't list it. */
  name: string;
  /** The Steam app id, or null for a game added by hand that isn't on Steam. */
  appId: string | null;
  /** The id of helmArray's game definition, or null when helmArray doesn't know the game. */
  gameId: string | null;
  /** The game's schemes, each by name. Empty for an unknown game. */
  schemes: LibrarySchemeRef[];
  /** This game's own active scheme (not only the active game's), or null. */
  activeSchemeId: string | null;
  /** True when some action has a key the game ships with: "Game's own keys" can be offered. */
  nativeKeys: boolean;
  /** Whether a portrait cover and a header image can be had for `coverUrl`. */
  hasCover: boolean;
  hasHeader: boolean;
}

/** The starting points a new scheme is copied from. Using one never edits it. */
export type Preset = 'xbox' | 'keys';

/** One device chip in the header. */
export interface DeviceChip {
  /** Which chip: a unit by hand once known, or a unit not yet placed. */
  hand: Hand | 'unknown';
  /** The unit's permanent id, so a question can name the unit it is about. */
  unitId: number | null;
  state: 'connecting' | 'ready' | 'failed';
  /** Firmware once the unit has answered. */
  firmware: number | null;
  /** Why it failed, in one plain sentence. */
  error: string | null;
}

export type SyncTone = 'ok' | 'warning' | 'error';

/** The sync pill: its words and its colour. Read from the units, never inferred. */
export interface SyncPill {
  label: string;
  tone: SyncTone;
}

/** A question the app must ask to tell the hands apart, or null. */
export type HandQuestion =
  | null
  /** Two new units: one press on the left one settles both. */
  | { kind: 'press'; prompt: string }
  /** One new unit on its own: the user says which hand it is. */
  | { kind: 'choose'; unitId: number; prompt: string };

export interface AppState {
  /** Left first, then right, then units not yet placed. Units not plugged in have no chip. */
  devices: DeviceChip[];
  sync: SyncPill;
  /** Why writing to the units is blocked right now (the Azeron app is open), or null. */
  writeBlock: string | null;
  question: HandQuestion;
  /** The game the app is set to, or null before one is chosen. */
  activeGameId: string | null;
  /** The active scheme of that game, or null when it has none. */
  activeSchemeId: string | null;
}

export interface HelmApi {
  /** The state now. */
  state(): Promise<AppState>;
  /** Called with every new state; returns the way to stop listening. */
  onState(listener: (state: AppState) => void): () => void;
  /** Answers a `choose` question. */
  chooseHand(unitId: number, hand: Hand): Promise<void>;
  /** The last lines of the exchange log, oldest first. */
  recentLog(lines: number): Promise<string[]>;
  /** Opens the folder holding the log in Explorer. */
  openLogFolder(): Promise<void>;
  /** Every game: the built-in ones, then the ones added by hand, each by name. */
  listGames(): Promise<GameEntry[]>;
  /** One scheme by id, or null when there is none. */
  getScheme(id: string): Promise<Scheme | null>;
  /** The schemes of one game, each by name. */
  listSchemes(gameId: string): Promise<Scheme[]>;
  /** Copies a preset into a new scheme of that game, saved at once, and gives it back. */
  createScheme(gameId: string, preset: Preset): Promise<Scheme>;
  /** Saves an edited scheme. Edits are written a moment later, together; quitting writes them. */
  saveScheme(scheme: Scheme): Promise<void>;
  /**
   * The Steam games merged with the games helmArray knows, unknown games included. Steam is read
   * once and kept; `refresh` reads it again. Schemes are read fresh each time.
   */
  listLibrary(refresh?: boolean): Promise<LibraryEntry[]>;
  /** Makes this the active game and scheme (null: the game has no active scheme). */
  setActive(gameId: string, schemeId: string | null): Promise<void>;
}

/** IPC channel names, shared by main and preload. */
export const CHANNELS = {
  state: 'helm:state',
  stateChanged: 'helm:state-changed',
  chooseHand: 'helm:choose-hand',
  recentLog: 'helm:recent-log',
  openLogFolder: 'helm:open-log-folder',
  listGames: 'helm:list-games',
  getScheme: 'helm:get-scheme',
  listSchemes: 'helm:list-schemes',
  createScheme: 'helm:create-scheme',
  saveScheme: 'helm:save-scheme',
  setActive: 'helm:set-active',
  listLibrary: 'helm:list-library',
} as const;
