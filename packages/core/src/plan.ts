import type {
  ActionId,
  ControlId,
  GameFileFormat,
  Hand,
  ModeId,
  Press,
  Signal,
  StickBehaviour,
} from './model';

/** One Cyborg II position, fully specified: what each press sends and how it behaves. */
export interface PinPlan {
  control: ControlId;
  position: string;
  pin: number;
  pinTwo?: number;
  /** Empty when the position sends nothing. */
  presses: Partial<Record<Press, Signal>>;
  /** Repeats while held, every `interval` ms; false when it doesn't. */
  turbo: false | { interval: number };
  latch: boolean;
}

/** Everything one unit holds: every position, in the device's order, plus its stick. */
export interface UnitProfile {
  deviceId: string;
  hand: Hand;
  pins: PinPlan[];
  stick: StickBehaviour & { angle: number; invertX: boolean };
}

/** What a control-press does in one mode, in the game's words: for Play view and the bind sheet. */
export interface Binding {
  mode: ModeId;
  control: ControlId;
  press: Press;
  action: ActionId;
  signal: Signal;
}

export type Severity = 'error' | 'warning';

export interface Finding {
  rule: string;
  severity: Severity;
  control?: ControlId;
  /** For a finding about an action rather than a control: a required action on no button. */
  action?: ActionId;
  /** The mode it happens in, when it happens in one. */
  mode?: ModeId;
  message: string;
  /** The player's reason for keeping it, from the scheme's accepted list. */
  accepted?: string;
}

export type Ledger = Record<ControlId, Partial<Record<Press, Signal>>>;

/**
 * The game's two binding sets: `keyboard` (keys, mouse buttons, scroll) and `controller` (Xbox
 * controls). The controller and Azerons sending Xbox controls share the controller set: the game
 * can't tell them apart.
 */
export type BindingSet = 'keyboard' | 'controller';
export const BINDING_SETS: readonly BindingSet[] = ['keyboard', 'controller'];

/**
 * One action's binding in one of the game's binding sets, as the setup has it. The game's file
 * adapters (M5) write these; where the file isn't written they are bind sheet rows.
 */
export interface GameBinding {
  set: BindingSet;
  mode: ModeId;
  action: ActionId;
  /** What the action is on in the game; null when it is on nothing in this set. */
  signal: Signal | null;
  /** What the game ships it on in this set; null when it ships none. */
  native: Signal | null;
}

/** What to set in the game's own controls menu: this action, in this set, to this (or nothing). */
export type BindSheetRow = GameBinding;

export interface Plan {
  /** Every unit the setup uses, and only those: the left one alone for *left Azeron + mouse*. */
  units: Partial<Record<Hand, UnitProfile>>;
  /** Every control-press of the setup carrying an action, with what it sends: units and fixed. */
  bindings: Binding[];
  /**
   * The game's bindings as the setup needs them, whole: for each binding set the setup uses, every
   * action of the game in its mode, on what the setup puts it on, or kept where the game ships it,
   * or on nothing. In set, then game mode, then game action order. See `gameBindings` in resolve.ts.
   */
  gameBindings: GameBinding[];
  /** The game's file is written: its adapter writes `gameBindings` into it. */
  gameFile?: { format: GameFileFormat };
  /**
   * The file isn't written: the game bindings that differ from what the game ships, as rows the
   * player sets in the game's own menu. Empty when the file is written.
   */
  bindSheet: BindSheetRow[];
  ledger: Ledger;
  findings: Finding[];
}
