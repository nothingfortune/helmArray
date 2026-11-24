import type {
  ActionId,
  ControlId,
  GameFileFormat,
  Hand,
  ModeId,
  Press,
  Scheme,
  SetupDevices,
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

/**
 * The apply that last wrote one unit: which scheme, of which game, what that setup played with,
 * when, and the unit's half of the plan it was written with, to compare with what the unit holds.
 * Kept per unit (units.json): a left-only apply leaves the right unit's last write in place, and a
 * setup with no Azeron writes neither.
 */
export interface UnitWrite {
  schemeId: string;
  gameId: string;
  /** The scheme's name when it was applied: it may be renamed or deleted since. */
  schemeName: string;
  /** The game's name when it was applied: the game may be deleted since. */
  gameName?: string;
  /**
   * The game was deleted since (a game added by hand): this is history, and a game added later
   * under the same id is never taken for it.
   */
  gameDeleted?: true;
  devices: SetupDevices;
  output: Scheme['output'];
  /** Milliseconds since 1970. */
  at: number;
  profile: UnitProfile;
}

/** What each unit was last written with; null for a unit helmArray has never written. */
export interface UnitsHeld {
  left: UnitWrite | null;
  right: UnitWrite | null;
}

export const NOTHING_HELD: Readonly<UnitsHeld> = { left: null, right: null };

/** Who an apply was: the scheme, its game, what it played with, and when. */
export type ApplyWho = Omit<UnitWrite, 'profile'>;

/**
 * What the units hold after an apply: each unit the plan has, and that came out holding it
 * (written, or found holding it already), now holds this scheme. Every other unit keeps its last
 * write: one the setup doesn't use (the right one, for left Azeron + mouse), one that failed, and
 * both for a setup with no Azeron.
 */
export function recordApply(
  held: UnitsHeld,
  plan: Pick<Plan, 'units'>,
  outcomes: readonly { hand: Hand; status: string }[],
  who: ApplyWho,
): UnitsHeld {
  const next: UnitsHeld = { left: held.left, right: held.right };
  for (const { hand, status } of outcomes) {
    const profile = plan.units[hand];
    if (profile === undefined || (status !== 'applied' && status !== 'unchanged')) continue;
    // keyed-write-ok: the key is a hand, left or right, never data
    next[hand] = { ...who, profile };
  }
  return next;
}
