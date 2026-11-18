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
  turbo: boolean;
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

/** What to press in the game's own controls menu: set this action to this key. */
export interface BindSheetRow {
  mode: ModeId;
  action: ActionId;
  signal: Signal;
}

export interface Plan {
  units: { left: UnitProfile; right: UnitProfile };
  bindings: Binding[];
  /** Key output with the game's file written: the adapter writes `bindings` into it. */
  gameFile?: { format: GameFileFormat };
  /** Key output on the game's own keys: what the player must set in the game's menu. */
  bindSheet: BindSheetRow[];
  ledger: Ledger;
  findings: Finding[];
}
