// What the main process tells the windows, and what a window may ask of it. Plain data only:
// it crosses IPC by structured clone. The preload exposes `HelmApi` as `window.helm`.

import type {
  Game,
  GameBinding,
  KeptSheet,
  Scheme,
  SheetRow,
  Signal,
  StickBehaviour,
} from '@helmarray/core';

export type Hand = 'left' | 'right';

/** A game in the library: built into the app, or one the user added. */
export interface GameEntry {
  game: Game;
  /** True for a game that ships with the app; false for one added by hand. */
  builtIn: boolean;
  /**
   * A built-in game you have edited: `game` is your copy, kept under the built-in's id, and
   * *back to helmArray's* drops it.
   */
  edited?: true;
  /**
   * Read from the game's own file just now, and not saved: helmArray has a file format for the
   * game, its file is there, and the app has no data for it yet. Saved the first time it is used
   * (a scheme made from it, or an edit).
   */
  found?: true;
  /** helmArray can read the game's own file into its data (*Read from the game's file*). */
  readsFile?: true;
}

/**
 * The game's own file, read for the Game screen to merge into the game's data and show before it
 * is saved: the game as the file has it, and what the game holds from helmArray's last Apply
 * (null: what it ships), so a binding helmArray put in the file isn't read as a default.
 */
export type GameFileRead =
  | { ok: true; file: Game; held: GameBinding[] | null }
  | { ok: false; message: string; reason?: 'missing' | 'unreadable' };

/** One scheme of a game, as the Library lists it. */
export interface LibrarySchemeRef {
  id: string;
  name: string;
  output: Scheme['output'];
  /** What the setup plays with. */
  devices: Scheme['devices'];
}

/**
 * One game in the Library: an installed Steam game, a game helmArray knows that Steam doesn't
 * list (not installed, or added by hand), or both in one entry (matched on the Steam app id).
 * Plain data: no file paths ever reach a window; covers are fetched by `coverUrl`.
 */
export interface LibraryEntry {
  /** helmArray's name for a game it knows ("Helldivers 2"), else Steam's. */
  name: string;
  /** Steam lists the game as installed. */
  inSteam: boolean;
  /** The Steam app id, or null for a game added by hand that isn't on Steam. */
  appId: string | null;
  /** The id of helmArray's game definition, or null when helmArray doesn't know the game. */
  gameId: string | null;
  /** The game's schemes, each by name. Empty for an unknown game. */
  schemes: LibrarySchemeRef[];
  /** This game's own active scheme (not only the active game's), or null. */
  activeSchemeId: string | null;
  /**
   * The scheme of this game applied last and when (ms since 1970), or null when none was: the
   * setup the game holds. Not what the units hold (a setup with no Azeron writes none, and a left
   * Azeron + mouse setup only the left one): that is `AppState.onUnits`.
   */
  applied: {
    schemeId: string;
    at: number;
    /** How many changes that scheme has had since: 0 when the game holds it as it is. */
    changes: number;
  } | null;
  /** True when some action has a key the game ships with: "Game's own keys" can be offered. */
  nativeKeys: boolean;
  /** True when some action has a key or an Xbox control the game ships it on: defaults found. */
  shipsDefaults: boolean;
  /** Whether a portrait cover and a header image can be had for `coverUrl`. */
  hasCover: boolean;
  hasHeader: boolean;
  /**
   * How many actions helmArray's data for the game has: 0 for a game it doesn't know, or one
   * added and not given any yet. Such a game is set up on the Game screen before a scheme.
   */
  actionCount: number;
  /**
   * For a game helmArray has a file format for and no data: why its own file can't be used, or
   * isn't there yet, in one sentence. Its tile is *Set up*, and the Game screen says it.
   */
  fileNote?: string;
  /**
   * For a Steam game helmArray read from its own file, and that you deleted since: the id it is
   * read under again. Its tile is *Set up*, which reads the file afresh (`restoreGame`).
   */
  restores?: string;
}

/** The starting points a new scheme is copied from. Using one never edits it. */
export type Preset = 'xbox' | 'keys';

/** One device chip in the header. */
export interface DeviceChip {
  /** Which chip: a unit by hand once known, or a unit not yet placed. */
  hand: Hand | 'unknown';
  /** The unit's permanent id, so a question can name the unit it is about. */
  unitId: number | null;
  /**
   * `paused`: plugged in, and let go of while the Azeron app is open: not talked to until it
   * closes, so nothing of what it holds is known.
   */
  state: 'connecting' | 'ready' | 'failed' | 'paused';
  /** Firmware once the unit has answered. */
  firmware: number | null;
  /** Why it failed, in one plain sentence. */
  error: string | null;
  /**
   * What the unit holds is known: it was read, and not given up since (the Azeron app was open, or
   * a question went unanswered). Not whether it is in sync.
   */
  read: boolean;
  /** The slot it runs as last asked (the profile button moves it), or null when not read. */
  running: number | null;
}

/** `plain`: nothing to act on. */
export type SyncTone = 'ok' | 'warning' | 'error' | 'plain';

/** The sync pill: its words and its colour. Read from the units, never inferred. */
export interface SyncPill {
  label: string;
  tone: SyncTone;
  /** When a unit differs: which, and how much of it. For a tooltip. */
  detail?: string;
  /**
   * The active scheme's changes not applied, when it has any, whatever the label says (the Azeron
   * app being open says first): the Editor's *Apply 3*. Counted as the person made them.
   */
  changes?: number;
  /**
   * The Azeron app is open and the active setup uses a unit: what it blocks is this setup. The band
   * under the header says so only then; a setup with no Azeron is not blocked.
   */
  paused?: true;
}

/** A question the app must ask to tell the hands apart, or null. */
export type HandQuestion =
  | null
  /** Two new units: one press on the left one settles both. */
  | { kind: 'press'; prompt: string }
  /** One new unit on its own: the user says which hand it is. */
  | { kind: 'choose'; unitId: number; prompt: string };

/**
 * What one unit holds: the apply that last wrote it, and whether the unit, read now, agrees.
 * `holds`: it was read and runs that layout; `differs`: it was read and runs something else;
 * `unknown`: it isn't connected or hasn't been read, so this is only the last write.
 */
export interface UnitHolds {
  schemeId: string;
  gameId: string;
  /** The scheme's name when it was applied. */
  schemeName: string;
  /** The game's name when it was applied, when the record has it. */
  gameName?: string;
  /** The game was deleted since: history, never the game of the same id added later. */
  gameDeleted?: true;
  /** What that setup played with when it was applied. */
  devices: Scheme['devices'];
  output: Scheme['output'];
  /** When it was applied, ms since 1970. */
  at: number;
  check: 'holds' | 'differs' | 'unknown';
}

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
  /** What each unit holds, by the apply that last wrote it; null for one never written. */
  onUnits: { left: UnitHolds | null; right: UnitHolds | null };
  /**
   * What is still to be set by hand in each game's own controls, after the applies that said so,
   * the game applied last first; kept on disk until *Done* (`dismissSheet`).
   */
  sheets: KeptSheet[];
}

/** One line of "what's ready" in the Apply drawer: a check or a cross, with one sentence. */
export interface ReadyCheck {
  ok: boolean;
  text: string;
  /**
   * What it is about: the Azeron app, or the game whose file is written (each shown always: the
   * one thing the person may have to do is close it), a unit, the game's file, the scheme's
   * errors, or another apply running. The drawer shows the others only when they are not ready.
   */
  kind?: 'azeron-app' | 'game' | 'unit' | 'game-file' | 'scheme' | 'busy';
}

/**
 * One button of a unit (or its stick) that Apply changes, as facts: the drawer words them in the
 * game's terms ("Middle 1 · Frame shift drive · new"). Read from what the unit holds now against
 * the layout, so it is what changes on the unit, whatever was applied before.
 */
export interface ApplyButtonChange {
  /** The position on the unit: `middle_1`, `dpad_up`, `stick`. */
  position: string;
  /** The game's actions it carries once applied, by name, each once, in mode then press order. */
  actions: string[];
  /** What its tap sends once applied (for a button with no action), or null. */
  sends: Signal | null;
  /** For the stick: what it does once applied. Null for a button. */
  stick: (StickBehaviour & { angle?: number; invertX?: boolean }) | null;
  /** It sent nothing before: the action on it is new. Never for the stick. */
  wasEmpty: boolean;
  /** It sends nothing once applied: cleared. Never for the stick. */
  nowEmpty: boolean;
}

/**
 * A layout Apply removes from a unit, and what is known of it. Whether it is this scheme's own
 * earlier copy is told from the units' record (the scheme last written to the unit) and the unit
 * read as running it, never from its name: names repeat across games ("Xbox controller") and a
 * unit keeps 19 characters of one.
 */
export interface RemovedLayout {
  slot: number;
  /** Its name on the unit; may be empty. */
  name: string;
  /** This scheme's own earlier copy, by the record and the read: nothing of the person's is lost. */
  ownCopy: boolean;
  /** The game the record says it is of, when the unit is read as running it; else null. */
  game: string | null;
}

/** What Apply would do to one unit. */
export interface ApplyUnitChange {
  hand: Hand;
  /**
   * The setup uses this unit. One it doesn't (the right unit, for *left Azeron + mouse*) is never
   * written, and has no lines and no problem here.
   */
  used: boolean;
  /** Ready to be written: plugged in, read, and known by hand. */
  connected: boolean;
  /** The layout differs from what the unit runs now. */
  differs: boolean;
  /** How many of the unit's inputs differ. */
  inputsChanged: number;
  /**
   * The buttons that change, in the unit's order: those that differ and are not empty both
   * before and after (a button that sent nothing and still sends nothing is no change to anyone).
   */
  buttons: ApplyButtonChange[];
  /** The slot written, or null when the unit already holds the layout. */
  write: { slot: number; name: string; overwrites: { slot: number; name: string } | null } | null;
  /** The slots deleted afterwards, each by name (empty when the unit has no other). */
  deletes: RemovedLayout[];
  /** The above in words, one line each. */
  changes: string[];
  /** Why this unit can't be done at all, in one sentence, or null. */
  problem: string | null;
}

/**
 * One of the game's bindings Apply changes: the set, the mode and action (with their names), what
 * it goes on and what it was on. Words are the drawer's: these are the facts. The same row is kept
 * as the reminder after Apply (`SheetRow`, core).
 */
export type ApplyGameRow = SheetRow;

/** The game's half of Apply. */
export interface ApplyGame {
  /**
   * How the rows reach the game: `file`, written by helmArray (from M5); `sheet`, set by hand in
   * the game's own controls menu.
   */
  via: 'file' | 'sheet';
  /** Every binding that changes, in set, then mode, then the game's action order. */
  rows: ApplyGameRow[];
  /**
   * The file, when helmArray writes it: its name once found (`Input.ini`), and whether it holds
   * these bindings already (nothing is written, and no row is listed). `made`: the game has no
   * file of its own, and helmArray makes it (Elite's, from the preset it ships).
   */
  file?: { name: string | null; same: boolean; made?: true };
  /**
   * One sentence. With `sheet`: why the rows are set by hand, when helmArray would write the
   * game's file but can't find it (the units are still written). With `file`: that helmArray makes
   * the file, the game having none of its own, and what from (Elite's, from its shipped preset).
   */
  note?: string;
  /**
   * With the file: the rows of actions it doesn't have (added by hand on the Game screen), which
   * aren't written and are set by hand in the game's own menu.
   */
  byHand?: ApplyGameRow[];
}

/** What the Apply drawer shows before anything is written. */
export interface ApplyPreview {
  schemeId: string;
  schemeName: string;
  /** The scheme's game; empty when the scheme could not be worked out. */
  gameId: string;
  gameName: string;
  /**
   * Stands for the layout this preview is of. `apply` takes it back and writes only that layout:
   * if the scheme has changed since, it refuses. Empty when the scheme could not be worked out.
   */
  fingerprint: string;
  /** Every check passes: Apply may be pressed. */
  ready: boolean;
  /** The Azeron app is open (so the units were not looked at). */
  azeronOpen: boolean;
  /** Another apply is running. */
  busy: boolean;
  checks: ReadyCheck[];
  /** Either unit has anything to write or delete. */
  anyChange: boolean;
  left: ApplyUnitChange;
  right: ApplyUnitChange;
  /** What changes in the game's bindings. */
  game: ApplyGame;
}

export type ApplyUnitStatus = 'applied' | 'unchanged' | 'failed' | 'not-attempted';

export interface ApplyUnitResult {
  hand: Hand;
  status: ApplyUnitStatus;
  /** One sentence: what happened, or what failed and what is left as it was. */
  message: string;
  /** The slot the layout is in, once known. */
  slot: number | null;
}

/** How an Apply ended. A refusal and a failure are both `ok: false` with a sentence. */
export interface ApplyResult {
  ok: boolean;
  /** One plain sentence; on failure, what failed and what is left as it was. */
  message: string;
  /** Refused because the scheme changed since the preview: nothing was written; look again. */
  changed?: boolean;
  /** Left, then right: the units the setup uses; empty when nothing was attempted. */
  units: ApplyUnitResult[];
  /** The game's file, when Apply went on to write it: how that ended, in one sentence. */
  gameFile?: { ok: boolean; message: string };
  /**
   * The game's half, when it ended other than the preview said: the file gone between the drawer
   * and the write, so every binding that changes is set by hand, with the sentence saying why.
   */
  game?: ApplyGame;
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
  /** *Copy a scheme*: a new scheme of the same game with everything in it, saved at once. */
  copyScheme(schemeId: string): Promise<Scheme>;
  /**
   * Deletes a scheme. A game whose active scheme it was is left with none; what the game holds
   * (if it was the one applied to it last) is kept.
   */
  deleteScheme(schemeId: string): Promise<void>;
  /** Saves an edited scheme. Edits are written a moment later, together; quitting writes them. */
  saveScheme(scheme: Scheme): Promise<void>;
  /**
   * The Steam games merged with the games helmArray knows, unknown games included. Steam is read
   * once and kept; `refresh` reads it again. Schemes are read fresh each time.
   */
  listLibrary(refresh?: boolean): Promise<LibraryEntry[]>;
  /** Makes this the active game and scheme (null: the game has no active scheme). */
  setActive(gameId: string, schemeId: string | null): Promise<void>;
  /** What Apply would do for this scheme, and whether it is ready. Writes nothing. */
  previewApply(schemeId: string): Promise<ApplyPreview>;
  /**
   * Writes the scheme to the units, exactly the layout the preview showed (its `fingerprint`).
   * Never rejects for a refusal: the result says why.
   */
  apply(schemeId: string, fingerprint: string): Promise<ApplyResult>;
  /**
   * Saves a game's data: one you added (a new id adds it), or your copy of a built-in game under
   * its id. Refused, with what is wrong in one sentence, when the game can't be saved. Written a
   * moment later, as a scheme's edits are. Setups made from it are never changed.
   */
  saveGame(game: Game): Promise<void>;
  /**
   * Deletes a game you added, or drops your copy of a built-in one (*back to helmArray's*). Its
   * schemes are kept.
   */
  deleteGame(gameId: string): Promise<void>;
  /** *Done*: the game's bindings still to set by hand are set; its reminder goes. */
  dismissSheet(gameId: string): Promise<void>;
  /** Reads the game's own file (never writes it), for the Game screen to merge. Never rejects. */
  readGameFile(gameId: string): Promise<GameFileRead>;
  /**
   * *Set up* on the tile of a game read from its own file and deleted since: it is found from its
   * file again, afresh (`LibraryEntry.restores`).
   */
  restoreGame(gameId: string): Promise<void>;
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
  copyScheme: 'helm:copy-scheme',
  deleteScheme: 'helm:delete-scheme',
  saveScheme: 'helm:save-scheme',
  setActive: 'helm:set-active',
  listLibrary: 'helm:list-library',
  previewApply: 'helm:preview-apply',
  apply: 'helm:apply',
  saveGame: 'helm:save-game',
  deleteGame: 'helm:delete-game',
  dismissSheet: 'helm:dismiss-sheet',
  readGameFile: 'helm:read-game-file',
  restoreGame: 'helm:restore-game',
} as const;
