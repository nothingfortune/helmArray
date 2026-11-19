// What the main process tells the windows, and what a window may ask of it. Plain data only:
// it crosses IPC by structured clone. The preload exposes `HelmApi` as `window.helm`.

export type Hand = 'left' | 'right';

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
}

/** IPC channel names, shared by main and preload. */
export const CHANNELS = {
  state: 'helm:state',
  stateChanged: 'helm:state-changed',
  chooseHand: 'helm:choose-hand',
  recentLog: 'helm:recent-log',
  openLogFolder: 'helm:open-log-folder',
} as const;
