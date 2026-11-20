// The model from docs/plans/02-architecture.md. Types only; the data lives in ./devices.
// KeyCode is exported from ./keys.

import type { KeyCode } from './keys';

/** A control on a device, prefixed by its device: `L.index_1`, `R.stick`, `key.W`, `pad.A`. */
export type ControlId = string;
export type ModeId = string;
export type ActionId = string;

export type Mod = 'ctrl' | 'shift' | 'alt';
export type MouseButton = 'left' | 'middle' | 'right' | 'back' | 'forward';
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

export const PAD_CONTROLS = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'BACK',
  'START',
  'LS',
  'RS',
  'DPAD_UP',
  'DPAD_DOWN',
  'DPAD_LEFT',
  'DPAD_RIGHT',
  'LS_UP',
  'LS_DOWN',
  'LS_LEFT',
  'LS_RIGHT',
  'RS_UP',
  'RS_DOWN',
  'RS_LEFT',
  'RS_RIGHT',
] as const;
/** An Xbox control. `LS`/`RS` are the stick presses; `LS_UP` and so on are stick directions. */
export type PadControl = (typeof PAD_CONTROLS)[number];

/** What a control physically sends. */
export type Signal =
  | { kind: 'key'; code: KeyCode; mods?: readonly Mod[] }
  | { kind: 'mouse'; button: MouseButton }
  | { kind: 'scroll'; dir: ScrollDirection; speed: number }
  | { kind: 'pad'; control: PadControl }
  | { kind: 'macro'; trigger: KeyCode }; // v2: the app types it

export type DeviceKind = 'azeron' | 'kbm' | 'pad' | 'pedals';
export type ControlKind = 'button' | 'stick' | 'axis';

export interface Control {
  id: ControlId;
  kind: ControlKind;
  /** True on the Azerons: the app decides what it sends. Fixed devices send what they are. */
  programmable: boolean;
  /** What a fixed control sends. Absent on programmable controls and on axes. */
  sends?: Signal;
}

export type Hand = 'left' | 'right';
export type FingerColumn = 'pinky' | 'ring' | 'middle' | 'index';

/** Where a Cyborg II position sits and which pin it is wired to. */
export interface AzeronPosition {
  /** The position name the units, the canvas and the reference maps share: `index_1`. */
  name: string;
  pin: number;
  /** The stick's second pin. */
  pinTwo?: number;
  column: FingerColumn | 'side' | 'thumb';
  row?: number;
  cluster?: 'dpad' | 'aux' | 'stick';
  side?: 'outer' | 'inner';
}

interface DeviceBase {
  id: string;
  name: string;
  controls: readonly Control[];
}

export interface AzeronDevice extends DeviceBase {
  kind: 'azeron';
  hand: Hand;
  positions: readonly AzeronPosition[];
  /** Pins the press test found wired to nothing. */
  unknownPins: readonly number[];
  stick: {
    /** The stick's rotation as the Azeron app writes it, in degrees (-1: none). */
    angle: number;
    /** Whether X is written inverted, in every stick mode. A layout may override it. */
    invertX: boolean;
  };
}

export interface FixedDevice extends DeviceBase {
  kind: 'kbm' | 'pad';
}

export interface PedalAxis {
  id: ControlId;
  name: string;
  /** Where it sits untouched: the rudder springs to the centre, a toe rests at one end. */
  rest: 'centre' | 'end';
}

export interface PedalsDevice extends DeviceBase {
  kind: 'pedals';
  axes: readonly PedalAxis[];
}

export type Device = AzeronDevice | FixedDevice | PedalsDevice;

export type Role = 'combat' | 'movement' | 'ability' | 'travel' | 'menu';

export interface Mode {
  id: ModeId;
  name: string;
}

export interface Action {
  id: ActionId;
  name: string;
  mode: ModeId;
  role: Role;
  required: boolean;
  /** What the game ships with. */
  native?: { key?: Signal; pad?: PadControl };
}

export type GameFileFormat = 'unreal-ini' | 'elite-binds';

export interface Game {
  id: string;
  name: string;
  steamAppId?: number;
  /** At least one ("default"). */
  modes: readonly Mode[];
  actions: readonly Action[];
  /** Writable when the format is known. */
  file?: { format: GameFileFormat; path?: string };
  /**
   * The sticks must send keys. Everspace 2 stutters with a pad stick and spins with a mouse
   * one. Set per game, never by default: other games want a pad stick or the pointer.
   */
  needsKeyStick?: boolean;
}

/** A press is a slot on a control. Long and double delay the tap by design. */
export type Press = 'tap' | 'long' | 'double';
export const PRESSES: readonly Press[] = ['tap', 'long', 'double'];

export type StickMode = 'keys' | 'pad-left' | 'pad-right' | 'mouse';

export interface StickBehaviour {
  mode: StickMode;
  /** 0–100, percent of travel. */
  deadzone?: number;
  /** 0–100, percent of travel where the stick reads as full. */
  outerEdge?: number;
  /** Mouse mode only: 1–10. */
  sensitivity?: number;
  invertX?: boolean;
  invertY?: boolean;
}

/**
 * The turbo rate in ms between repeats when turbo is turned on: the Azeron app's own default
 * (written and read back as 20, 2026-11-19), and what a version-1 scheme's `turbo: true` became.
 */
export const DEFAULT_TURBO_INTERVAL = 20;

export interface Behaviour {
  /** Repeat the key while held, every `interval` ms (1–255), the unit's own turbo. */
  turbo?: { interval: number };
  /** Hold to latch: the key stays down until pressed again. */
  latch?: boolean;
  stick?: StickBehaviour;
}

export type RuleId = string;

export interface Scheme {
  id: string;
  gameId: string;
  name: string;
  output: 'pad' | 'keys';
  /**
   * Pad output: which Xbox control each Azeron button sends. The same in every mode; the
   * game's own pad bindings decide what it does. Edited in the app; presets fill it.
   */
  padMap: Record<ControlId, PadControl>;
  /**
   * Key output only. True: the units send keys from the pool and the game's file is written to
   * listen for them. False: the units send the game's own keys and its file is left alone; what
   * can't be matched becomes a bind sheet row. Ignored for a game with no writable file.
   */
  writeGameFile: boolean;
  /** Per mode, per control, per press: which action. */
  map: Record<ModeId, Record<ControlId, Partial<Record<Press, ActionId>>>>;
  behaviour: Record<ControlId, Behaviour>;
  /** Keys handed out, never re-dealt. */
  ledger: Record<ControlId, Partial<Record<Press, Signal>>>;
  /**
   * Findings the player kept on purpose, and why. A finding about a control names the control;
   * one about an action on no button names the action.
   */
  accepted: { rule: RuleId; control?: ControlId; action?: ActionId; reason: string }[];
}

/**
 * What the app remembers between runs besides schemes (settings.json): which game is open and
 * which scheme is the active one for each game.
 */
export interface AppSettings {
  /** The game the app is set to, or null before one is chosen. */
  activeGameId: string | null;
  /** Per game id: the id of its active scheme. A game with none has no entry. */
  activeScheme: Record<string, string>;
}

export const DEFAULT_SETTINGS: Readonly<AppSettings> = { activeGameId: null, activeScheme: {} };
