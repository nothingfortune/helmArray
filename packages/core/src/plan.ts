import type { ActionId, ControlId, Hand, ModeId, Press, Signal, StickBehaviour } from './model';

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
  message: string;
}

export type Ledger = Record<ControlId, Partial<Record<Press, Signal>>>;

export interface Plan {
  units: { left: UnitProfile; right: UnitProfile };
  bindings: Binding[];
  ledger: Ledger;
  findings: Finding[];
}
