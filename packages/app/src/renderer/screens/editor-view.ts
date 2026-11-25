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
  BUILT_IN_DEVICES,
  KEYBOARD_MOUSE,
  PAD_CONTROLS,
  PRESSES,
  STICK_DIRECTIONS,
  XBOX_PAD,
  controlSet,
  inSetup,
  own,
  padSignalOf,
  placedIn,
  resolve,
  setupOf,
  stickActions,
  stickDirections,
  stickPadsOf,
} from '@helmarray/core';
import { fixedWhere } from '../devices/layouts';
import type { StickLabels, UnitKey } from '../unit/Unit';
import { handPrefix, positionName, positionOf } from '../unit/layout';
import { isAcceptable, isStick, keyLabelOf, pressesOf, shownAction } from './editor-model';
import { groupChecks } from './check-groups';
import type { CheckItem } from './check-groups';
import { offerFor, settlesAll } from './fixes';
import type { Offer } from './fixes';
import type { Fix } from './fixes';

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
  /**
   * A stick's four directions, each with the action the game's bindings put on it and what it
   * sends; empty for anything else. Read only: a stick's directions follow its mode.
   */
  directions: StickRow[];
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
  /**
   * The key label field, for a unit button or a key showing an action: its label, and the action's
   * name as the hint. Null elsewhere (a mouse or controller row always has room for the name).
   */
  keyLabel: { value: string; placeholder: string } | null;
}

/** One direction of a selected stick. */
export interface StickRow {
  direction: StickDirection;
  /** "Up", "Down", "Left", "Right". */
  word: string;
  action?: ActionRef;
  /** What the direction sends, in mono; null when it sends nothing. */
  sends: string | null;
}

export interface FindingRow {
  /** Stable across edits, so a list does not flicker. */
  key: string;
  finding: Finding;
  /** What the sentence is about ("Move forward"), drawn bold; null when it opens with no name. */
  subject: string | null;
  /** The rest of the sentence after the subject: the whole of it when there is none. */
  rest: string;
  /** True when the player may keep it: only the checks can be kept. */
  canKeep: boolean;
  /** Its fix, only when applying it removes the finding and adds no error (THE FIX GATE). */
  fix?: Fix;
  /** Why its rule's fix isn't offered here, in one plain sentence: it can't act, or wouldn't do. */
  why?: string;
  /** The player's reason, for a finding that is kept. */
  kept?: string;
}

export interface UnitSide {
  keys: Record<ControlId, UnitKey>;
  stick: StickLabels | undefined;
  conflicts: ReadonlySet<ControlId>;
}

/** What a control is called in the panel's words. */
export type ControlWord = 'key' | 'mouse button' | 'key or mouse button' | 'button';

/** The actions not on a control of one binding set. */
export interface ActionList {
  set: BindingSet;
  /** "Not on a {word}". */
  word: ControlWord;
  actions: ActionRef[];
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
  /**
   * What the controls the panel speaks of are called: the selected control's kind, else the tab's
   * (keys on the keyboard, buttons elsewhere).
   */
  controlWord: ControlWord;
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
   * The mode's actions on no control of a binding set, in the game's order: with a control
   * selected, its own set's; with none, one list for each set the tab's controls are bound through
   * (the left Azeron's buttons and the mouse beside it can be two).
   */
  lists: ActionList[];
  /**
   * With a control selected: the actions of its set on another control, each with where; picking
   * one moves it to the selected control (the canvas's "Already on a button").
   */
  moves: (ActionRef & { where: string })[];
  /**
   * The actions a stick does, in the sets of the lists: placed, so never in "Not on a button", and
   * still to pick or drag onto a button as a second way to do them.
   */
  onStick: (ActionRef & { where: string })[];
  /** Findings still asking for attention: errors first. */
  findings: FindingRow[];
  /** The same findings as the checks list them: repeats of one role grouped (`groupChecks`). */
  checks: CheckItem[];
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
  /**
   * The fix offers worked out so far (`offerSteps`), by finding row and group key. Given, the view
   * takes what is there and works none out: the fix gate re-resolves a scheme per finding, too
   * slow for a draw on a large game. Left out, every offer is worked out now.
   */
  offers?: OfferBook | undefined;
}

/** A finding's offer, or whether a group's one fix passes the gate. */
export type OfferEntry = Offer | { group: boolean };
/** The offers worked out, by finding row key or group key. */
export type OfferBook = ReadonlyMap<string, OfferEntry>;

// ---- The pieces ----

const PRESS_WORD: Record<Press, string> = { tap: 'Tap', long: 'Long', double: 'Double' };

function actionRef(game: Game, id: ActionId): ActionRef {
  const action = game.actions.find((a) => a.id === id);
  if (action === undefined) return { id, name: id };
  // An action with no role yet is drawn neutral: no role, no colour.
  return action.role === undefined
    ? { id, name: action.name }
    : { id, name: action.name, role: action.role };
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
  // Keyed by control id, which a scheme file may make `__proto__`: an entry list, then a record.
  const keys: [ControlId, UnitKey][] = [];
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
    // A button with only a long press must not read as if its tap did that: the press word is kept
    // apart from the name, so fitting the label (a key label for the name) never loses it.
    const qualifier = lead.press === 'tap' ? undefined : `${PRESS_WORD[lead.press]}:`;
    const label = qualifier === undefined ? ref.name : `${qualifier} ${ref.name}`;
    const short = keyLabelOf(scheme, mode, control);
    keys.push([
      control,
      {
        label,
        ...(qualifier === undefined ? {} : { qualifier, name: ref.name }),
        action: lead.id,
        press: lead.press,
        ...(ref.role === undefined ? {} : { role: ref.role }),
        ...(short === undefined ? {} : { short }),
      },
    ]);
  }
  return Object.fromEntries(keys);
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

/**
 * The tab a change of devices brings: the first the setup didn't have before, so a device just
 * added is shown without another click. Undefined when it brings none (a device taken away).
 */
export function gainedTab(before: SetupDevices, after: SetupDevices): DeviceTabId | undefined {
  const had = new Set(deviceTabs(before).map((t) => t.id));
  return deviceTabs(after).find((t) => !had.has(t.id))?.id;
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

/** What a control is called: a key, a mouse button, or a button (a unit's, the controller's). */
export function wordOf(control: ControlId): ControlWord {
  if (control.startsWith('key.')) return 'key';
  if (control.startsWith('mouse.')) return 'mouse button';
  return 'button';
}

/** Where a control is, in the panel's words: `Left · Index 1`, `Keyboard · J`. */
export function whereOf(control: ControlId): string {
  if (control.startsWith('L.') || control.startsWith('R.'))
    return `${control.startsWith('L.') ? 'Left' : 'Right'} · ${positionName(positionOf(control))}`;
  return fixedWhere(control) ?? control;
}

/**
 * The kinds of control a tab draws, as a representative id of each and what it is called: one
 * device need not mean one tab (the mouse beside the left unit), nor one tab one binding set.
 */
function tabControls(scheme: Scheme, tab: DeviceTabId | null): ControlId[] {
  const setup = setupOf(scheme.devices);
  if (tab === 'controller') return ['pad.A'];
  if (tab === 'keyboard')
    return [...(setup.keyboard ? ['key.A'] : []), ...(setup.mouse ? ['mouse.left'] : [])];
  if (tab === 'azerons')
    return [
      ...setup.hands.map((h) => (h === 'left' ? 'L.index_1' : 'R.index_1')),
      ...(setup.mouse && mouseBesideLeft(scheme.devices) ? ['mouse.left'] : []),
    ];
  return [];
}

/** What a tab's controls are called, with nothing selected: one word for them all. */
function tabWord(scheme: Scheme, tab: DeviceTabId | null): ControlWord {
  const words = new Set(tabControls(scheme, tab).map(wordOf));
  if (words.size === 1) return [...words][0] ?? 'button';
  return words.size === 2 && words.has('key') && words.has('mouse button')
    ? 'key or mouse button'
    : 'button';
}

/** The binding sets a tab's controls are bound through, each with the word for its controls. */
function setsOfTab(
  scheme: Scheme,
  tab: DeviceTabId | null,
): { set: BindingSet; word: ControlWord }[] {
  const out: { set: BindingSet; word: ControlWord }[] = [];
  for (const control of tabControls(scheme, tab)) {
    const set = controlSet(scheme, control);
    if (set === undefined) continue;
    const there = out.find((o) => o.set === set);
    if (there === undefined) out.push({ set, word: wordOf(control) });
    else if (there.word !== wordOf(control))
      // The keyboard and the mouse on one tab are one set: keys or mouse buttons. A unit's buttons
      // with the mouse beside them are buttons.
      there.word =
        [there.word, wordOf(control)].sort().join('|') === 'key|mouse button'
          ? 'key or mouse button'
          : 'button';
  }
  return out;
}

const DIRECTION_WORDS: Record<StickDirection, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
};

/**
 * A stick's four directions: the action the game's bindings put on what each sends (core's
 * `stickActions`, the one place that says what is placed), and what it sends. A key stick's
 * direction with no action shows its key.
 */
function stickRows(
  scheme: Scheme,
  game: Game,
  plan: Plan,
  mode: ModeId,
  stick: ControlId,
): StickRow[] {
  const on = stickActions(scheme, plan).filter((s) => s.stick === stick && s.mode === mode);
  const sent = stickDirections(scheme).filter((d) => d.stick === stick);
  return STICK_DIRECTIONS.map((direction) => {
    const found = on.find((s) => s.direction === direction);
    const signal = sent.find((d) => d.direction === direction)?.signal;
    return {
      direction,
      word: DIRECTION_WORDS[direction],
      sends: signal === undefined ? null : signalText(signal),
      ...(found === undefined ? {} : { action: actionRef(game, found.action) }),
    };
  });
}

/** The stick's four chips: the action on each direction, else a key stick's key itself. */
function stickLabels(
  scheme: Scheme,
  game: Game,
  plan: Plan,
  mode: ModeId,
  hand: Hand,
): StickLabels | undefined {
  const stick = `${handPrefix(hand)}.stick`;
  if (!inSetup(setupOf(scheme.devices), stick)) return undefined;
  // An Xbox direction with no action shows the drawn word (Up): only a key says what it sends.
  const keyed = new Set(
    stickDirections(scheme)
      .filter((d) => d.stick === stick && d.signal.kind === 'key')
      .map((d) => d.direction),
  );
  const labels: StickLabels = {};
  for (const row of stickRows(scheme, game, plan, mode, stick)) {
    const word = row.action?.name ?? (keyed.has(row.direction) ? row.sends : null);
    // keyed-write-ok: the key is a stick direction, one of four names
    if (word !== null) labels[row.direction] = word;
    if (row.action?.role !== undefined && labels.role === undefined) labels.role = row.action.role;
  }
  return Object.keys(labels).length === 0 ? undefined : labels;
}

/**
 * The controller's two sticks, as rows of the Controller tab: the actions on their directions, in
 * one line ("Move forward, Move back, Strafe left, Strafe right"). No action of its own, so it is
 * never dragged; a stick with none isn't listed.
 */
function padStickKeys(
  scheme: Scheme,
  game: Game,
  plan: Plan,
  mode: ModeId,
): Record<ControlId, UnitKey> {
  const keys: [ControlId, UnitKey][] = [];
  for (const stick of ['pad.left_stick', 'pad.right_stick']) {
    const actions = stickRows(scheme, game, plan, mode, stick).flatMap((r) =>
      r.action === undefined ? [] : [r.action],
    );
    const first = actions[0];
    if (first === undefined) continue;
    const label = [...new Set(actions.map((a) => a.name))].join(', ');
    keys.push([stick, first.role === undefined ? { label } : { label, role: first.role }]);
  }
  return Object.fromEntries(keys);
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
  const where = whereOf(control);
  // Only an Azeron button sending keys has a long press and a double tap.
  const allPresses = azeron && scheme.output !== 'pad';
  if (isStick(control)) {
    const sends = stickSends(scheme, control);
    return {
      control,
      where,
      title: 'Stick',
      stick: true,
      directions: stickRows(scheme, game, plan, mode, control),
      across: [],
      presses: [],
      behaviour: false,
      turbo: false,
      latch: false,
      unavailable: unavailableWord(control),
      padChoice: null,
      sends: sends.text,
      sendsNote: sends.note,
      keyLabel: null,
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
    directions: [],
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
    keyLabel: keyLabelField(scheme, game, mode, control),
  };
}

/** The key label field of a unit button or a key, while it shows an action (label.ts draws it). */
function keyLabelField(
  scheme: Scheme,
  game: Game,
  mode: ModeId,
  control: ControlId,
): PanelView['keyLabel'] {
  if (!/^(L|R|key)\./.test(control)) return null;
  const shown = shownAction(scheme, mode, control);
  if (shown === undefined) return null;
  return {
    value: keyLabelOf(scheme, mode, control) ?? '',
    placeholder: actionRef(game, shown.id).name,
  };
}

/** Whether an action can go on a button in this mode: it is the game's, and belongs to the mode. */
export const assignable = (game: Game, mode: ModeId, actionId: ActionId): boolean =>
  game.actions.some((a) => a.id === actionId && a.mode === mode);

const SEVERITY_ORDER = { error: 0, warning: 1 } as const;

/**
 * Whether a scheme just made from a preset goes straight to the Apply drawer (J1): it has nothing
 * to fix, the same reading that draws "Nothing to fix." under the units. Kept findings count as
 * settled; any other, an error or a warning, keeps the Editor open to fix it.
 */
export const opensApply = (view: Pick<EditorView, 'findings'>): boolean =>
  view.findings.length === 0;

export function editorView(input: EditorViewInput): EditorView {
  const { scheme, game, plan, mode, selected } = input;
  // The press asked for, while the selected control can send it: a switch to a controller leaves
  // no long press or double tap to target.
  const asked = input.press ?? 'tap';
  const press =
    selected === undefined || pressesOf(scheme, selected).includes(asked) ? asked : 'tap';
  const setup = setupOf(scheme.devices);
  const tabs = deviceTabs(scheme.devices);
  const tab = shownTab(tabs, input.tab);

  // What is placed in each binding set, on a control or on a stick: core's `placedIn`, the one place
  // the checks ask too, so a stick's action is never listed as on no button.
  const placedOf = (set: BindingSet) => placedIn(scheme, game, plan, mode, set);
  const inMode = game.actions.filter((a) => a.mode === mode);
  const listOf = (set: BindingSet, word: ControlWord): ActionList => {
    const placed = placedOf(set);
    return {
      set,
      word,
      actions: inMode.filter((a) => !placed.has(a.id)).map((a) => actionRef(game, a.id)),
    };
  };
  // A selected control of the setup speaks for itself: its own set, its own word. A stick has no
  // set: the tab's lists stand.
  const chosen = selected !== undefined && inSetup(setup, selected) ? selected : undefined;
  const chosenSet = chosen === undefined ? undefined : controlSet(scheme, chosen);
  const lists =
    chosen !== undefined && chosenSet !== undefined
      ? [listOf(chosenSet, wordOf(chosen))]
      : setsOfTab(scheme, tab).map(({ set, word }) => listOf(set, word));
  const moves =
    chosen !== undefined && chosenSet !== undefined
      ? [...placedOf(chosenSet)]
          .filter(([, control]) => control !== chosen && !isStick(control))
          .map(([id, control]) => ({ ...actionRef(game, id), where: whereOf(control) }))
          .sort(
            (a, b) =>
              inMode.findIndex((x) => x.id === a.id) - inMode.findIndex((x) => x.id === b.id),
          )
      : [];
  const listed = new Set(lists.map((l) => l.set));
  const onStick = [
    ...new Map(
      stickActions(scheme, plan)
        .filter((s) => s.mode === mode && listed.has(s.set))
        .map((s) => [s.action, { ...actionRef(game, s.action), where: whereOf(s.stick) }]),
    ).values(),
  ];

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
      ...splitSubject(finding.message, game),
      canKeep: isAcceptable(finding),
    };
    if (finding.accepted !== undefined) row.kept = finding.accepted;
    return row;
  });
  const bySeverity = (a: FindingRow, b: FindingRow) =>
    SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity];
  const bare = rows.filter((r) => r.kept === undefined).sort(bySeverity);
  const book: OfferBook =
    input.offers ?? new Map(offerSteps({ findings: bare }, scheme, game, plan));
  const open = withOffers(bare, book);

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
    controlWord: chosen !== undefined ? wordOf(chosen) : tabWord(scheme, tab),
    output: setup.hands.length > 0 ? scheme.output : null,
    fixed: {
      ...keysOf(scheme, game, mode, 'key.'),
      ...keysOf(scheme, game, mode, 'mouse.'),
      ...(setup.controller ? keysOf(scheme, game, mode, 'pad.') : {}),
      ...(setup.controller ? padStickKeys(scheme, game, plan, mode) : {}),
    },
    conflicts: conflicting,
    left: {
      keys: unitKeys(scheme, game, mode, 'left'),
      stick: stickLabels(scheme, game, plan, mode, 'left'),
      conflicts: conflicts('left'),
    },
    right: {
      keys: unitKeys(scheme, game, mode, 'right'),
      stick: stickLabels(scheme, game, plan, mode, 'right'),
      conflicts: conflicts('right'),
    },
    // A control of a device the setup no longer has (an undo took it away) shows no panel.
    panel:
      selected === undefined || !inSetup(setup, selected)
        ? null
        : panelFor({ scheme, game, plan, mode, press, control: selected }),
    lists,
    moves,
    onStick,
    findings: open,
    // A group's one fix is offered only once it has passed the gate too (`offerSteps`).
    // The mode shown's checks lead (modeFirst).
    checks: modeFirst(
      groupChecks(open, game, (_fix, _members, key) => {
        const entry = book.get(key);
        return entry !== undefined && entry !== null && 'group' in entry && entry.group;
      }),
      mode,
    ),
    kept: rows.filter((r) => r.kept !== undefined),
  };
}

/**
 * The checks with the mode shown's first, and the whole setup's with them (a finding in no mode
 * holds in every one); then the other modes'. Each sentence names its mode, so one of another
 * mode is still there to see and fix: an error anywhere stops Apply.
 */
function modeFirst(items: readonly CheckItem[], mode: ModeId): CheckItem[] {
  const modeOf = (item: CheckItem) =>
    item.kind === 'row' ? item.row.finding.mode : item.rows[0]?.finding.mode;
  const elsewhere = (item: CheckItem): number => {
    const of = modeOf(item);
    return of === undefined || of === mode ? 0 : 1;
  };
  // A stable sort: on either side, the order given (errors first, then the game's modes).
  return [...items].sort((a, b) => elsewhere(a) - elsewhere(b));
}

const STICK_SUBJECTS = ['The left stick', 'The right stick'];

/**
 * A check's sentence, its subject apart: the action it opens with (the longest name of the game's
 * that is a whole word there), with the others listed beside it ("Boost, Map and Fire"), or the
 * stick it is about. The checks are worded subject first; one that isn't has no subject.
 */
export function splitSubject(
  message: string,
  game: Game,
): { subject: string | null; rest: string } {
  const names = [...new Set(game.actions.map((a) => a.name).filter((n) => n !== ''))].sort(
    (a, b) => b.length - a.length,
  );
  /** The name `text` opens with, as a whole word, or undefined. */
  const opening = (text: string, among: readonly string[]) =>
    among.find((name) => text.startsWith(name) && /^(?:$|[\s,.:'])/.test(text.slice(name.length)));
  const stick = opening(message, STICK_SUBJECTS);
  if (stick !== undefined) return { subject: stick, rest: message.slice(stick.length) };
  const first = opening(message, names);
  if (first === undefined) return { subject: null, rest: message };
  let end = first.length;
  for (;;) {
    const joint = /^(, | and )/.exec(message.slice(end))?.[0];
    if (joint === undefined) break;
    const next = opening(message.slice(end + joint.length), names);
    if (next === undefined) break;
    end += joint.length + next.length;
  }
  return { subject: message.slice(0, end), rest: message.slice(end) };
}

/** The rows with what the book has for each: its fix, or why there is none. */
function withOffers(rows: readonly FindingRow[], book: OfferBook): FindingRow[] {
  return rows.map((row) => {
    const entry = book.get(row.key);
    if (entry === undefined || entry === null || 'group' in entry) return row;
    return 'fix' in entry ? { ...row, fix: entry.fix } : { ...row, why: entry.why };
  });
}

/**
 * The fix offers of a view's findings, one step at a time, for the Editor to work out after its
 * draw (each step re-resolves a scheme): first each finding's (THE FIX GATE, fixes.ts), then
 * whether each group's one fix passes the gate too: all its findings gone, no new error.
 */
export function* offerSteps(
  view: Pick<EditorView, 'findings'>,
  scheme: Scheme,
  game: Game,
  plan: Plan,
): Generator<[string, OfferEntry]> {
  const book = new Map<string, OfferEntry>();
  for (const row of view.findings) {
    const offer = offerFor(row.finding, scheme, game, plan);
    book.set(row.key, offer);
    yield [row.key, offer];
  }
  for (const item of groupChecks(withOffers(view.findings, book), game)) {
    if (item.kind !== 'group' || item.fix === undefined) continue;
    const made = item.fix.apply(scheme);
    const passes =
      made !== scheme &&
      settlesAll(
        item.rows.map((r) => r.finding),
        plan,
        resolve(made, game, BUILT_IN_DEVICES),
      );
    yield [item.key, { group: passes }];
  }
}
