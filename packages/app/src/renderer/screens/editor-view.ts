// What the Editor draws, worked out from a scheme, its game and the plan the resolver made of
// them. Pure: the component only lays these rows out. Everything the player reads here is in
// the game's words; the signal appears only as a caption (docs/plans/03-ui-system.md).

import type {
  ActionId,
  BindingSet,
  ControlId,
  Finding,
  Game,
  Hand,
  ModeId,
  PadControl,
  Plan,
  Press,
  Role,
  Scheme,
  SetupDevices,
  Signal,
  StickDirection,
} from '@helmarray/core';
import {
  KEYBOARD_MOUSE,
  PAD_CONTROLS,
  PRESSES,
  STICK_DIRECTIONS,
  XBOX_PAD,
  controlSet,
  inSetup,
  own,
  padSignalOf,
  setupOf,
  signalId,
  stickPadsOf,
} from '@helmarray/core';
import { fixedWhere } from '../devices/layouts';
import type { StickLabels, UnitKey } from '../unit/Unit';
import { handPrefix, positionName, positionOf } from '../unit/layout';
import { fixFor, isAcceptable, isStick, shownAction } from './editor-model';
import type { Fix } from './editor-model';

// ---- Signals, as words for a caption ----

const KEY_WORDS: Readonly<Record<string, string>> = {
  NumAdd: 'Num +',
  NumSubtract: 'Num −',
  NumMultiply: 'Num *',
  NumDivide: 'Num /',
  NumEnter: 'Num Enter',
  NumDecimal: 'Num .',
  NumLock: 'Num Lock',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  PrintScreen: 'Print Screen',
  ScrollLock: 'Scroll Lock',
  Caps: 'Caps Lock',
  Esc: 'Esc',
  Del: 'Delete',
  LShift: 'Left Shift',
  RShift: 'Right Shift',
  LCtrl: 'Left Ctrl',
  RCtrl: 'Right Ctrl',
  LAlt: 'Left Alt',
  RAlt: 'Right Alt',
  LWin: 'Left Win',
  RWin: 'Right Win',
};

const MOD_WORDS = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt' } as const;

function keyWord(code: string): string {
  const known = own(KEY_WORDS, code);
  if (known !== undefined) return known;
  const numpad = /^Num(\d)$/.exec(code);
  return numpad?.[1] !== undefined ? `Num ${numpad[1]}` : code;
}

const PAD_WORDS: Readonly<Record<string, string>> = {
  LS: 'Left stick press',
  RS: 'Right stick press',
  LS_UP: 'Left stick up',
  LS_DOWN: 'Left stick down',
  LS_LEFT: 'Left stick left',
  LS_RIGHT: 'Left stick right',
  RS_UP: 'Right stick up',
  RS_DOWN: 'Right stick down',
  RS_LEFT: 'Right stick left',
  RS_RIGHT: 'Right stick right',
  DPAD_UP: 'D-pad up',
  DPAD_DOWN: 'D-pad down',
  DPAD_LEFT: 'D-pad left',
  DPAD_RIGHT: 'D-pad right',
};

export const padWord = (control: PadControl): string => own(PAD_WORDS, control) ?? control;

/** What a signal is called in the mono caption: `Num +`, `Left Shift+F13`, `Xbox RB`. */
export function signalText(signal: Signal): string {
  switch (signal.kind) {
    case 'key':
      return [...(signal.mods ?? []).map((m) => MOD_WORDS[m]), keyWord(signal.code)].join('+');
    case 'mouse':
      return signal.button === 'back' || signal.button === 'forward'
        ? `Mouse ${signal.button}`
        : `${signal.button.charAt(0).toUpperCase()}${signal.button.slice(1)} mouse button`;
    case 'scroll':
      return `Scroll ${signal.dir}`;
    case 'pad':
      return `Xbox ${padWord(signal.control)}`;
    case 'macro':
      return `Macro on ${keyWord(signal.trigger)}`;
  }
}

// ---- Rows ----

export interface ActionRef {
  id: ActionId;
  name: string;
  role?: Role;
}

export interface ModeRow {
  id: ModeId;
  name: string;
  active: boolean;
}

/** One mode of the selected button, for "In each mode". */
export interface AcrossRow {
  mode: ModeId;
  name: string;
  /** The action's name, or null when the button is empty in that mode. */
  label: string | null;
  active: boolean;
}

export interface PressRow {
  press: Press;
  word: string;
  action?: ActionRef;
  /** False where the output has no such press (a controller button only has a tap). */
  available: boolean;
  /** The press a click on an action will fill. */
  target: boolean;
}

/** Which Xbox control an Azeron button sends, and what it may send instead (controller output). */
export interface PadChoice {
  current: PadControl | null;
  /** Every Xbox control a button may send: never a direction a stick of the setup sends. */
  options: { pad: PadControl; label: string }[];
  /** It carries a stick's action, so it sends that stick's direction and nothing else. */
  locked: boolean;
}

export interface PanelView {
  control: ControlId;
  /** `Left · Index 1`, `Keyboard · J`, `Controller · LT`. */
  where: string;
  /** The tap's action, or "Empty"; "Stick" for the stick. */
  title: string;
  stick: boolean;
  across: AcrossRow[];
  presses: PressRow[];
  /** Turbo and latch are the unit's own: only an Azeron button has them. */
  behaviour: boolean;
  turbo: boolean;
  latch: boolean;
  /** What an empty press that isn't there says instead of "Add". */
  unavailable: string;
  /** An Azeron button sending Xbox controls: which one, and the choice of another. */
  padChoice: PadChoice | null;
  /** What it sends for the press that is the target, in mono; null when nothing. */
  sends: string | null;
  /** Where that signal came from, in a few plain words. */
  sendsNote: string;
}

export interface FindingRow {
  /** Stable across edits, so a list does not flicker. */
  key: string;
  finding: Finding;
  /** True when the player may keep it: only the checks can be kept. */
  canKeep: boolean;
  fix?: Fix;
  /** The player's reason, for a finding that is kept. */
  kept?: string;
}

export interface UnitSide {
  keys: Record<ControlId, UnitKey>;
  stick: StickLabels | undefined;
  conflicts: ReadonlySet<ControlId>;
}

/** A device tab of the editor: what is drawn in the middle. */
export type DeviceTabId = 'azerons' | 'keyboard' | 'controller';

export interface DeviceTab {
  id: DeviceTabId;
  label: string;
}

export interface EditorView {
  showModeTabs: boolean;
  modes: ModeRow[];
  /** The setup's devices as tabs, and the one shown (null for a setup with none). */
  tabs: DeviceTab[];
  tab: DeviceTabId | null;
  /** The units drawn on the Azerons tab: the setup's own. */
  hands: Hand[];
  /** A left Azeron + mouse setup draws the mouse beside the left unit, where the right one was. */
  mouseBeside: boolean;
  /** The keyboard and the mouse are drawn on their tab: which of the two the setup has. */
  keyboard: boolean;
  mouse: boolean;
  /** What the tab's controls are called: keys on the keyboard, buttons everywhere else. */
  controlWord: 'key' | 'button';
  /** "Azerons send: Keys | Controller", for a setup with Azerons; null without. */
  output: Scheme['output'] | null;
  left: UnitSide;
  right: UnitSide;
  /** The keyboard's keys, the mouse's buttons and the controller's buttons, each by control id. */
  fixed: Record<ControlId, UnitKey>;
  /** Every control in a conflict in this mode, on any device. */
  conflicts: ReadonlySet<ControlId>;
  panel: PanelView | null;
  /**
   * The mode's actions on no control of the binding set the tab shown is bound through (the
   * controller's, or the keyboard's), in the game's order.
   */
  unplaced: ActionRef[];
  /** Findings still asking for attention: errors first. */
  findings: FindingRow[];
  /** Findings the player kept. */
  kept: FindingRow[];
}

export interface EditorViewInput {
  scheme: Scheme;
  game: Game;
  plan: Plan;
  mode: ModeId;
  selected?: ControlId | undefined;
  /** The press a click on an action fills. Defaults to tap. */
  press?: Press | undefined;
  /** The device tab asked for; the first the setup has when it has not that one. */
  tab?: DeviceTabId | undefined;
}

// ---- The pieces ----

const PRESS_WORD: Record<Press, string> = { tap: 'Tap', long: 'Long', double: 'Double' };

function actionRef(game: Game, id: ActionId): ActionRef {
  const action = game.actions.find((a) => a.id === id);
  return action === undefined ? { id, name: id } : { id, name: action.name, role: action.role };
}

/**
 * The action a control shows in a mode: its tap, else its long press, else its double tap; for a
 * control sending an Xbox control, what that control does (THE PAD RULE in editor-model.ts).
 */
const leadingAction = shownAction;

/** Labels for the controls of one device (`L.`, `R.`, `key.`, `mouse.`, `pad.`) in a mode. */
function keysOf(
  scheme: Scheme,
  game: Game,
  mode: ModeId,
  prefix: string,
): Record<ControlId, UnitKey> {
  const keys: Record<ControlId, UnitKey> = {};
  // Every control with an action of its own, every one sending an Xbox control another does, and
  // the controller's buttons, which show what an Azeron button sending them carries.
  const controls = new Set([
    ...Object.keys(own(scheme.map, mode) ?? {}),
    ...Object.keys(scheme.padMap).filter((c) => padSignalOf(scheme, c) !== undefined),
    ...(prefix === 'pad.' ? XBOX_PAD.controls.map((c) => c.id) : []),
  ]);
  for (const control of controls) {
    if (!control.startsWith(prefix) || isStick(control)) continue;
    const lead = leadingAction(scheme, mode, control);
    if (lead === undefined) continue;
    const ref = actionRef(game, lead.id);
    // A button with only a long press must not read as if its tap did that.
    const label = lead.press === 'tap' ? ref.name : `${PRESS_WORD[lead.press]}: ${ref.name}`;
    keys[control] = {
      label,
      action: lead.id,
      ...(ref.role === undefined ? {} : { role: ref.role }),
    };
  }
  return keys;
}

const unitKeys = (scheme: Scheme, game: Game, mode: ModeId, hand: Hand) =>
  keysOf(scheme, game, mode, `${handPrefix(hand)}.`);

// ---- The setup's devices ----

/**
 * The setup's devices as the editor's tabs: the Azerons, the keyboard (with the mouse), the
 * controller. A left Azeron + mouse setup draws its mouse beside the left unit; it gets a tab of
 * its own only when nothing else draws it.
 */
export function deviceTabs(devices: SetupDevices): DeviceTab[] {
  const setup = setupOf(devices);
  const tabs: DeviceTab[] = [];
  if (setup.hands.length > 0) tabs.push({ id: 'azerons', label: 'Azerons' });
  if (setup.keyboard) tabs.push({ id: 'keyboard', label: 'Keyboard' });
  else if (setup.mouse && !mouseBesideLeft(devices)) tabs.push({ id: 'keyboard', label: 'Mouse' });
  if (setup.controller) tabs.push({ id: 'controller', label: 'Controller' });
  return tabs;
}

/** A left Azeron + mouse setup: the mouse is drawn where the right unit would be. */
const mouseBesideLeft = (devices: SetupDevices): boolean => devices.azerons === 'left';

/** The tab shown: the one asked for while the setup has it, else its first; null with none. */
export function shownTab(
  tabs: readonly DeviceTab[],
  wanted: DeviceTabId | undefined,
): DeviceTabId | null {
  return tabs.some((t) => t.id === wanted) ? (wanted ?? null) : (tabs[0]?.id ?? null);
}

/** The binding set a tab's controls are bound through. */
function setOfTab(scheme: Scheme, tab: DeviceTabId | null): BindingSet | undefined {
  if (tab === 'keyboard') return 'keyboard';
  if (tab === 'controller') return 'controller';
  if (tab === 'azerons') return scheme.output === 'pad' ? 'controller' : 'keyboard';
  return undefined;
}

/** The stick's four chips: the action whose own key a direction sends, else the key itself. */
function stickLabels(
  scheme: Scheme,
  game: Game,
  mode: ModeId,
  hand: Hand,
): StickLabels | undefined {
  const stick = scheme.behaviour[`${handPrefix(hand)}.stick`]?.stick;
  if (stick?.mode !== 'keys' || stick.directions === undefined) return undefined;
  const labels: StickLabels = {};
  for (const direction of STICK_DIRECTIONS) {
    const signal = stick.directions[direction];
    if (signal === undefined) continue;
    const action = game.actions.find(
      (a) =>
        a.mode === mode &&
        a.native?.key !== undefined &&
        signalId(a.native.key) === signalId(signal),
    );
    labels[direction] = action?.name ?? signalText(signal);
    if (action !== undefined && labels.role === undefined) labels.role = action.role;
  }
  return Object.keys(labels).length === 0 ? undefined : labels;
}

const keyFor = (f: Finding): string =>
  `${f.rule}|${f.control ?? ''}|${f.action ?? ''}|${f.mode ?? ''}`;

/** The stick's words for the caption, when a stick is selected. */
function stickSends(scheme: Scheme, control: ControlId): { text: string | null; note: string } {
  if (control === 'pad.left_stick')
    return { text: 'Xbox left stick', note: "the controller's own" };
  if (control === 'pad.right_stick')
    return { text: 'Xbox right stick', note: "the controller's own" };
  const stick = scheme.behaviour[control]?.stick;
  if (stick === undefined) return { text: null, note: 'not set up yet' };
  const side = control.startsWith('L.') ? 'left' : 'right';
  switch (stick.mode) {
    case 'pad-left':
      return { text: 'Xbox left stick', note: 'as a controller stick' };
    case 'pad-right':
      return { text: 'Xbox right stick', note: 'as a controller stick' };
    case 'mouse':
      return { text: 'Mouse movement', note: `the ${side} stick` };
    case 'keys': {
      const words = (['up', 'left', 'down', 'right'] as StickDirection[]).flatMap((d) => {
        const signal = stick.directions?.[d];
        return signal === undefined ? [] : [signalText(signal)];
      });
      return { text: words.length === 0 ? null : words.join(' '), note: 'its four directions' };
    }
  }
}

const FIXED_SIGNALS: ReadonlyMap<ControlId, Signal> = new Map(
  [...KEYBOARD_MOUSE.controls, ...XBOX_PAD.controls].flatMap((c) =>
    c.sends === undefined ? [] : [[c.id, c.sends] as const],
  ),
);

/**
 * Where the action on a control-press stands with the game, in a few words: nothing for an empty
 * one; set by hand when it is on the bind sheet (the game rebound to the setup); as the game ships
 * it otherwise; a key chosen for the game's written file with key output.
 */
function noteFor(
  scheme: Scheme,
  game: Game,
  plan: Plan,
  mode: ModeId,
  control: ControlId,
  action: ActionId | undefined,
): string {
  if (action === undefined) return 'does nothing in the game';
  const set = controlSet(scheme, control);
  if (plan.bindSheet.some((r) => r.mode === mode && r.action === action && r.set === set))
    return "set it in the game's controls";
  const written = scheme.writeGameFile && game.file !== undefined;
  const pooled = written && scheme.output === 'keys' && !FIXED_SIGNALS.has(control);
  return pooled ? 'chosen for you' : 'as the game ships it';
}

function sendsFor(
  scheme: Scheme,
  game: Game,
  plan: Plan,
  mode: ModeId,
  control: ControlId,
  press: Press,
): { text: string | null; note: string } {
  const pins = [...(plan.units.left?.pins ?? []), ...(plan.units.right?.pins ?? [])];
  // A fixed control sends what it is, and only taps.
  const fixed = FIXED_SIGNALS.get(control);
  const signal =
    fixed === undefined
      ? pins.find((p) => p.control === control)?.presses[press]
      : press === 'tap'
        ? fixed
        : undefined;
  if (signal === undefined) return { text: null, note: '' };
  const shown = shownAction(scheme, mode, control);
  const action =
    shown?.press === press ? shown.id : own(own(scheme.map, mode) ?? {}, control)?.[press];
  return { text: signalText(signal), note: noteFor(scheme, game, plan, mode, control, action) };
}

/** The Xbox control choice for an Azeron button with controller output; null for anything else. */
function padChoiceFor(
  scheme: Scheme,
  game: Game,
  mode: ModeId,
  control: ControlId,
): PadChoice | null {
  const azeron = control.startsWith('L.') || control.startsWith('R.');
  if (scheme.output !== 'pad' || !azeron || !inSetup(setupOf(scheme.devices), control)) return null;
  const sticks = stickPadsOf(scheme);
  const current = padSignalOf(scheme, control) ?? null;
  const byControl = own(scheme.map, mode) ?? {};
  const on = (pad: PadControl): string | undefined => {
    for (const [c, presses] of Object.entries(byControl)) {
      if (padSignalOf(scheme, c) === pad && presses.tap !== undefined)
        return actionRef(game, presses.tap).name;
    }
    return undefined;
  };
  return {
    current,
    options: PAD_CONTROLS.filter((pad) => !sticks.has(pad)).map((pad) => {
      const name = on(pad);
      return { pad, label: name === undefined ? padWord(pad) : `${padWord(pad)} · ${name}` };
    }),
    locked: current !== null && sticks.has(current),
  };
}

/** What a press that isn't there says: only an Azeron button sending keys has them all. */
function unavailableWord(control: ControlId): string {
  if (control.startsWith('key.')) return 'Not on a key';
  if (control.startsWith('mouse.')) return 'Not on a mouse button';
  return 'Not on a controller';
}

interface PanelInput {
  scheme: Scheme;
  game: Game;
  plan: Plan;
  mode: ModeId;
  press: Press;
  control: ControlId;
}

function panelFor(input: PanelInput): PanelView {
  const { scheme, game, plan, mode, press, control } = input;
  const azeron = control.startsWith('L.') || control.startsWith('R.');
  const hand = control.startsWith('L.') ? 'Left' : 'Right';
  const where = azeron
    ? `${hand} · ${positionName(positionOf(control))}`
    : (fixedWhere(control) ?? control);
  // Only an Azeron button sending keys has a long press and a double tap.
  const allPresses = azeron && scheme.output !== 'pad';
  if (isStick(control)) {
    const sends = stickSends(scheme, control);
    return {
      control,
      where,
      title: 'Stick',
      stick: true,
      across: [],
      presses: [],
      behaviour: false,
      turbo: false,
      latch: false,
      unavailable: unavailableWord(control),
      padChoice: null,
      sends: sends.text,
      sendsNote: sends.note,
    };
  }
  const here = { ...(own(own(scheme.map, mode) ?? {}, control) ?? {}) };
  // A control sending an Xbox control shows what that control does (THE PAD RULE).
  const shown = shownAction(scheme, mode, control);
  if (here.tap === undefined && shown?.press === 'tap') here.tap = shown.id;
  const tap = here.tap;
  const sends = sendsFor(scheme, game, plan, mode, control, press);
  return {
    control,
    where,
    title: tap === undefined ? 'Empty' : actionRef(game, tap).name,
    stick: false,
    across: game.modes.map((m) => {
      const lead = leadingAction(scheme, m.id, control);
      return {
        mode: m.id,
        name: m.name,
        label: lead === undefined ? null : actionRef(game, lead.id).name,
        active: m.id === mode,
      };
    }),
    presses: PRESSES.map((p) => {
      const id = here[p];
      const row: PressRow = {
        press: p,
        word: PRESS_WORD[p],
        available: allPresses || p === 'tap',
        target: p === press,
      };
      if (id !== undefined) row.action = actionRef(game, id);
      return row;
    }),
    behaviour: azeron,
    turbo: scheme.behaviour[control]?.turbo !== undefined,
    latch: scheme.behaviour[control]?.latch === true,
    unavailable: unavailableWord(control),
    padChoice: padChoiceFor(scheme, game, mode, control),
    sends: sends.text,
    sendsNote: sends.note,
  };
}

/** Whether an action can go on a button in this mode: it is the game's, and belongs to the mode. */
export const assignable = (game: Game, mode: ModeId, actionId: ActionId): boolean =>
  game.actions.some((a) => a.id === actionId && a.mode === mode);

const SEVERITY_ORDER = { error: 0, warning: 1 } as const;

export function editorView(input: EditorViewInput): EditorView {
  const { scheme, game, plan, mode, selected } = input;
  const press = input.press ?? 'tap';
  const setup = setupOf(scheme.devices);
  const tabs = deviceTabs(scheme.devices);
  const tab = shownTab(tabs, input.tab);

  // Placed: on a control of the setup bound through the set the tab shows (any set, with none).
  const set = setOfTab(scheme, tab);
  const placed = new Set<ActionId>();
  for (const [control, presses] of Object.entries(own(scheme.map, mode) ?? {})) {
    if (!inSetup(setup, control)) continue;
    if (set !== undefined && controlSet(scheme, control) !== set) continue;
    for (const p of PRESSES) {
      const id = presses[p];
      if (id !== undefined) placed.add(id);
    }
  }

  // Core can report the same rule on the same control more than once (one per press, one per
  // stick direction), so a repeat gets a number to keep every key unique.
  const seen = new Map<string, number>();
  const rows: FindingRow[] = plan.findings.map((finding) => {
    const base = keyFor(finding);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const row: FindingRow = {
      key: count === 0 ? base : `${base}#${count}`,
      finding,
      canKeep: isAcceptable(finding),
    };
    if (finding.accepted !== undefined) row.kept = finding.accepted;
    else {
      const fix = fixFor(finding, scheme, game, plan);
      if (fix !== undefined) row.fix = fix;
    }
    return row;
  });
  const bySeverity = (a: FindingRow, b: FindingRow) =>
    SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity];

  const conflicting = new Set(
    plan.findings
      .filter(
        (f) =>
          f.rule === 'key-collision' &&
          f.accepted === undefined &&
          (f.mode === undefined || f.mode === mode),
      )
      .flatMap((f) => (f.control === undefined ? [] : [f.control])),
  );
  const conflicts = (hand: Hand): ReadonlySet<ControlId> =>
    new Set([...conflicting].filter((c) => c.startsWith(`${handPrefix(hand)}.`)));

  return {
    showModeTabs: game.modes.length > 1,
    modes: game.modes.map((m) => ({ id: m.id, name: m.name, active: m.id === mode })),
    tabs,
    tab,
    hands: [...setup.hands],
    mouseBeside: setup.mouse && mouseBesideLeft(scheme.devices),
    keyboard: setup.keyboard,
    mouse: setup.mouse,
    controlWord: tab === 'keyboard' && setup.keyboard ? 'key' : 'button',
    output: setup.hands.length > 0 ? scheme.output : null,
    fixed: {
      ...keysOf(scheme, game, mode, 'key.'),
      ...keysOf(scheme, game, mode, 'mouse.'),
      ...(setup.controller ? keysOf(scheme, game, mode, 'pad.') : {}),
    },
    conflicts: conflicting,
    left: {
      keys: unitKeys(scheme, game, mode, 'left'),
      stick: stickLabels(scheme, game, mode, 'left'),
      conflicts: conflicts('left'),
    },
    right: {
      keys: unitKeys(scheme, game, mode, 'right'),
      stick: stickLabels(scheme, game, mode, 'right'),
      conflicts: conflicts('right'),
    },
    panel:
      selected === undefined
        ? null
        : panelFor({ scheme, game, plan, mode, press, control: selected }),
    unplaced: game.actions
      .filter((a) => a.mode === mode && !placed.has(a.id))
      .map((a) => actionRef(game, a.id)),
    findings: rows.filter((r) => r.kept === undefined).sort(bySeverity),
    kept: rows.filter((r) => r.kept !== undefined),
  };
}
