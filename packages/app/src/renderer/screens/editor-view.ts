// What the Editor draws, worked out from a scheme, its game and the plan the resolver made of
// them. Pure: the component only lays these rows out. Everything the player reads here is in
// the game's words; the signal appears only as a caption (docs/plans/03-ui-system.md).

import type {
  ActionId,
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
  Signal,
  StickDirection,
} from '@helmarray/core';
import { PRESSES, STICK_DIRECTIONS, signalId } from '@helmarray/core';
import type { StickLabels, UnitKey } from '../unit/Unit';
import { handPrefix, positionName, positionOf } from '../unit/layout';
import { fixFor, isAcceptable, isStick } from './editor-model';
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
  const known = KEY_WORDS[code];
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

export const padWord = (control: PadControl): string => PAD_WORDS[control] ?? control;

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

export interface PanelView {
  control: ControlId;
  /** `Left · Index 1`. */
  where: string;
  /** The tap's action, or "Empty"; "Stick" for the stick. */
  title: string;
  stick: boolean;
  across: AcrossRow[];
  presses: PressRow[];
  turbo: boolean;
  latch: boolean;
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

export interface EditorView {
  showModeTabs: boolean;
  modes: ModeRow[];
  left: UnitSide;
  right: UnitSide;
  panel: PanelView | null;
  /** The mode's actions that are on no press at all, in the game's order. */
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
}

// ---- The pieces ----

const PRESS_WORD: Record<Press, string> = { tap: 'Tap', long: 'Long', double: 'Double' };

function actionRef(game: Game, id: ActionId): ActionRef {
  const action = game.actions.find((a) => a.id === id);
  return action === undefined ? { id, name: id } : { id, name: action.name, role: action.role };
}

/** The action a control carries in a mode: its tap, else its long press, else its double tap. */
function leadingAction(scheme: Scheme, mode: ModeId, control: ControlId) {
  const presses = scheme.map[mode]?.[control];
  for (const press of PRESSES) {
    const id = presses?.[press];
    if (id !== undefined) return { press, id };
  }
  return undefined;
}

function unitKeys(
  scheme: Scheme,
  game: Game,
  mode: ModeId,
  hand: Hand,
): Record<ControlId, UnitKey> {
  const prefix = `${handPrefix(hand)}.`;
  const keys: Record<ControlId, UnitKey> = {};
  for (const control of Object.keys(scheme.map[mode] ?? {})) {
    if (!control.startsWith(prefix) || isStick(control)) continue;
    const lead = leadingAction(scheme, mode, control);
    if (lead === undefined) continue;
    const ref = actionRef(game, lead.id);
    // A button with only a long press must not read as if its tap did that.
    const label = lead.press === 'tap' ? ref.name : `${PRESS_WORD[lead.press]}: ${ref.name}`;
    keys[control] = ref.role === undefined ? { label } : { label, role: ref.role };
  }
  return keys;
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
  const stick = scheme.behaviour[control]?.stick;
  if (stick === undefined) return { text: null, note: 'not set up yet' };
  const side = control.startsWith('L.') ? 'left' : 'right';
  switch (stick.mode) {
    case 'pad-left':
      return { text: 'Xbox left stick', note: 'your pad bindings' };
    case 'pad-right':
      return { text: 'Xbox right stick', note: 'your pad bindings' };
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

function sendsFor(
  scheme: Scheme,
  game: Game,
  plan: Plan,
  mode: ModeId,
  control: ControlId,
  press: Press,
): { text: string | null; note: string } {
  const pins = [...plan.units.left.pins, ...plan.units.right.pins];
  const signal = pins.find((p) => p.control === control)?.presses[press];
  if (signal === undefined) return { text: null, note: '' };
  const action = scheme.map[mode]?.[control]?.[press];
  const onSheet = plan.bindSheet.some((r) => r.mode === mode && r.action === action);
  const note =
    scheme.output === 'pad'
      ? 'your pad bindings'
      : onSheet
        ? "set it in the game's controls"
        : scheme.writeGameFile && game.file !== undefined
          ? 'chosen for you'
          : "the game's own key";
  return { text: signalText(signal), note };
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
  const hand = control.startsWith('L.') ? 'Left' : 'Right';
  const where = `${hand} · ${positionName(positionOf(control))}`;
  if (isStick(control)) {
    const sends = stickSends(scheme, control);
    return {
      control,
      where,
      title: 'Stick',
      stick: true,
      across: [],
      presses: [],
      turbo: false,
      latch: false,
      sends: sends.text,
      sendsNote: sends.note,
    };
  }
  const here = scheme.map[mode]?.[control] ?? {};
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
        available: scheme.output !== 'pad' || p === 'tap',
        target: p === press,
      };
      if (id !== undefined) row.action = actionRef(game, id);
      return row;
    }),
    turbo: scheme.behaviour[control]?.turbo !== undefined,
    latch: scheme.behaviour[control]?.latch === true,
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

  const placed = new Set<ActionId>();
  for (const presses of Object.values(scheme.map[mode] ?? {})) {
    for (const p of PRESSES) {
      const id = presses[p];
      if (id !== undefined) placed.add(id);
    }
  }

  const rows: FindingRow[] = plan.findings.map((finding) => {
    const row: FindingRow = { key: keyFor(finding), finding, canKeep: isAcceptable(finding) };
    if (finding.accepted !== undefined) row.kept = finding.accepted;
    else {
      const fix = fixFor(finding, scheme, game, plan);
      if (fix !== undefined) row.fix = fix;
    }
    return row;
  });
  const bySeverity = (a: FindingRow, b: FindingRow) =>
    SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity];

  const conflicts = (hand: Hand): ReadonlySet<ControlId> =>
    new Set(
      plan.findings
        .filter(
          (f) =>
            f.rule === 'key-collision' &&
            f.accepted === undefined &&
            f.control?.startsWith(`${handPrefix(hand)}.`) === true &&
            (f.mode === undefined || f.mode === mode),
        )
        .flatMap((f) => (f.control === undefined ? [] : [f.control])),
    );

  return {
    showModeTabs: game.modes.length > 1,
    modes: game.modes.map((m) => ({ id: m.id, name: m.name, active: m.id === mode })),
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
