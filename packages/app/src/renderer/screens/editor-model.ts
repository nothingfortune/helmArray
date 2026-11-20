// The editor's edits, as pure functions on a Scheme, and its undo history. Nothing here touches
// React, the DOM or the disk. Every edit returns a new scheme and leaves its input alone; an
// edit that would change nothing returns the very same object, so the history can tell that no
// edit happened (and nothing is saved).
//
// The ledger is never touched: it is the resolver's record of keys handed out, and Apply's job.

import type {
  ActionId,
  ControlId,
  Finding,
  Game,
  ModeId,
  Plan,
  Press,
  Scheme,
} from '@helmarray/core';
import { CHECK_RULES, DEFAULT_TURBO_INTERVAL, PRESSES } from '@helmarray/core';

/** One press of one control, in one mode: the place an action sits. */
export interface Slot {
  mode: ModeId;
  control: ControlId;
  press: Press;
}

type PressMap = Partial<Record<Press, ActionId>>;
type ByControl = Record<ControlId, PressMap>;

/** The stick is not a button: it has no presses, only directions. Actions never go on it. */
export const isStick = (control: ControlId): boolean =>
  control.slice(control.indexOf('.') + 1) === 'stick';

/** The reason stored when the player taps "Keep, I know". The canvas has no field for one. */
export const KEPT_REASON = 'Kept on purpose';

/** A copy of a record without one key. */
function omit<R extends object>(record: R, key: keyof R): R {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key)) as R;
}

/** A copy of one mode's map that can be changed freely. */
function copyMode(scheme: Scheme, mode: ModeId): ByControl {
  const out: ByControl = {};
  for (const [control, presses] of Object.entries(scheme.map[mode] ?? {})) {
    out[control] = { ...presses };
  }
  return out;
}

/** Drops controls left with no press, so an emptied button leaves no trace. */
function prune(byControl: ByControl): ByControl {
  const out: ByControl = {};
  for (const [control, presses] of Object.entries(byControl)) {
    if (PRESSES.some((p) => presses[p] !== undefined)) out[control] = presses;
  }
  return out;
}

const withMode = (scheme: Scheme, mode: ModeId, byControl: ByControl): Scheme => ({
  ...scheme,
  map: { ...scheme.map, [mode]: prune(byControl) },
});

/** The action on a slot, if any. */
export const actionAt = (scheme: Scheme, slot: Slot): ActionId | undefined =>
  scheme.map[slot.mode]?.[slot.control]?.[slot.press];

/**
 * Puts an action on a slot. Assigning is moving: the action leaves any other slot it held in
 * this mode, and whatever the slot held becomes unplaced. The stick takes no action.
 */
export function assign(scheme: Scheme, slot: Slot, action: ActionId): Scheme {
  if (isStick(slot.control)) return scheme;
  const byControl = copyMode(scheme, slot.mode);
  let changed = false;
  for (const control of Object.keys(byControl)) {
    for (const press of PRESSES) {
      const presses = byControl[control] ?? {};
      if (presses[press] === action && !(control === slot.control && press === slot.press)) {
        byControl[control] = omit(presses, press);
        changed = true;
      }
    }
  }
  const here = (byControl[slot.control] ??= {});
  if (here[slot.press] !== action) {
    here[slot.press] = action;
    changed = true;
  }
  return changed ? withMode(scheme, slot.mode, byControl) : scheme;
}

/** Takes the action off a slot. */
export function clear(scheme: Scheme, slot: Slot): Scheme {
  if (actionAt(scheme, slot) === undefined) return scheme;
  const byControl = copyMode(scheme, slot.mode);
  byControl[slot.control] = omit(byControl[slot.control] ?? {}, slot.press);
  return withMode(scheme, slot.mode, byControl);
}

/** Moves the action on one slot to another in the same mode; what was on the target is dropped. */
export function move(scheme: Scheme, from: Slot, to: Slot): Scheme {
  if (from.mode !== to.mode) return scheme;
  if (from.control === to.control && from.press === to.press) return scheme;
  const action = actionAt(scheme, from);
  if (action === undefined || isStick(to.control)) return scheme;
  return assign(clear(scheme, from), to, action);
}

interface BehaviourPatch {
  turbo?: false | { interval: number };
  latch?: boolean;
}

function patchBehaviour(scheme: Scheme, control: ControlId, patch: BehaviourPatch): Scheme {
  if (isStick(control)) return scheme;
  const before = scheme.behaviour[control] ?? {};
  const after = { ...before };
  if (patch.turbo === false) delete after.turbo;
  else if (patch.turbo !== undefined) after.turbo = patch.turbo;
  if (patch.latch === false) delete after.latch;
  else if (patch.latch !== undefined) after.latch = patch.latch;
  if (JSON.stringify(after) === JSON.stringify(before)) return scheme;
  const rest = omit(scheme.behaviour, control);
  return {
    ...scheme,
    behaviour: Object.keys(after).length === 0 ? rest : { ...rest, [control]: after },
  };
}

/** Turns turbo (repeat while held) on, at the unit's own default rate, or off. */
export function setTurbo(scheme: Scheme, control: ControlId, on: boolean): Scheme {
  const current = scheme.behaviour[control]?.turbo;
  if (on && current !== undefined) return scheme;
  return patchBehaviour(scheme, control, {
    turbo: on ? { interval: DEFAULT_TURBO_INTERVAL } : false,
  });
}

/** Turns hold-to-latch on or off. */
export const setLatch = (scheme: Scheme, control: ControlId, on: boolean): Scheme =>
  patchBehaviour(scheme, control, { latch: on });

const sameFinding = (
  a: { rule: string; control?: ControlId | undefined; action?: ActionId | undefined },
  b: { rule: string; control?: ControlId | undefined; action?: ActionId | undefined },
): boolean => a.rule === b.rule && a.control === b.control && a.action === b.action;

/**
 * Whether the player may keep a finding. The checks can be kept; the resolver's own findings
 * (a key it cannot name, a pool it spent) are facts the player cannot overrule.
 */
export const isAcceptable = (finding: Finding): boolean =>
  (CHECK_RULES as readonly string[]).includes(finding.rule);

/** "Keep, I know": adds the finding to the scheme's accepted list. */
export function acceptFinding(
  scheme: Scheme,
  finding: Finding,
  reason: string = KEPT_REASON,
): Scheme {
  if (!isAcceptable(finding)) return scheme;
  if (scheme.accepted.some((a) => sameFinding(a, finding))) return scheme;
  const entry: Scheme['accepted'][number] = { rule: finding.rule, reason };
  if (finding.control !== undefined) entry.control = finding.control;
  if (finding.action !== undefined) entry.action = finding.action;
  return { ...scheme, accepted: [...scheme.accepted, entry] };
}

/** Flags a kept finding again. */
export function unacceptFinding(scheme: Scheme, finding: Finding): Scheme {
  if (!scheme.accepted.some((a) => sameFinding(a, finding))) return scheme;
  return { ...scheme, accepted: scheme.accepted.filter((a) => !sameFinding(a, finding)) };
}

// ---- Fixes: the obvious one-click answer to a finding, where there is one ----

export interface Fix {
  /** The button's words. */
  label: string;
  apply: (scheme: Scheme) => Scheme;
}

const nameOf = (game: Game, id: ActionId): string =>
  game.actions.find((a) => a.id === id)?.name ?? id;

/** The slots of a control, in a mode, that hold an action. */
function slotsOn(
  scheme: Scheme,
  mode: ModeId,
  control: ControlId,
): (Slot & { action: ActionId })[] {
  const presses = scheme.map[mode]?.[control] ?? {};
  return PRESSES.flatMap((press) => {
    const action = presses[press];
    return action === undefined ? [] : [{ mode, control, press, action }];
  });
}

const clearAll = (scheme: Scheme, slots: readonly Slot[]): Scheme =>
  slots.reduce((s, slot) => clear(s, slot), scheme);

/**
 * The one edit that clears a finding, when one clear edit does. Key collisions, a missing
 * required action and the stick findings have no obvious fix: which of two actions should give
 * way is the player's call.
 */
export function fixFor(finding: Finding, scheme: Scheme, game: Game, plan: Plan): Fix | undefined {
  const { control, mode } = finding;
  if (control === undefined) return undefined;
  switch (finding.rule) {
    case 'hold-on-movement':
      return { label: 'Turn off hold to latch', apply: (s) => setLatch(s, control, false) };
    case 'combat-tap-delayed': {
      // The unit keeps one setting per button for every mode, so the delay reaches them all.
      const slots = game.modes.flatMap((m) =>
        slotsOn(scheme, m.id, control).filter((s) => s.press !== 'tap'),
      );
      if (slots.length === 0) return undefined;
      const hasLong = slots.some((s) => s.press === 'long');
      const hasDouble = slots.some((s) => s.press === 'double');
      const what =
        hasLong && hasDouble ? 'long press and double tap' : hasLong ? 'long press' : 'double tap';
      return { label: `Remove ${what}`, apply: (s) => clearAll(s, slots) };
    }
    case 'menu-with-combat': {
      if (mode === undefined) return undefined;
      const slots = slotsOn(scheme, mode, control).filter(
        (s) => game.actions.find((a) => a.id === s.action)?.role === 'menu',
      );
      const first = slots[0];
      if (first === undefined) return undefined;
      return { label: `Take ${nameOf(game, first.action)} off`, apply: (s) => clearAll(s, slots) };
    }
    case 'sends-nothing': {
      if (mode === undefined) return undefined;
      const pins = [...plan.units.left.pins, ...plan.units.right.pins];
      const sent = pins.find((p) => p.control === control)?.presses;
      const slots = slotsOn(scheme, mode, control).filter((s) => sent?.[s.press] === undefined);
      if (slots.length === 0) return undefined;
      return { label: 'Take it off the button', apply: (s) => clearAll(s, slots) };
    }
    default:
      return undefined;
  }
}

// ---- Undo and redo, in memory, per scheme ----

export interface History<T> {
  past: readonly T[];
  present: T;
  future: readonly T[];
}

/** How many edits can be undone. Schemes are small; this is a sanity bound, not a feature. */
export const HISTORY_LIMIT = 200;

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** Makes `next` the present. The same object as now is no edit: nothing changes. */
export function commit<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

export const canUndo = (history: History<unknown>): boolean => history.past.length > 0;
export const canRedo = (history: History<unknown>): boolean => history.future.length > 0;

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}

/** What a key press asks of the history: Ctrl+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes. */
export function historyShortcut(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey === true) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !e.shiftKey) return 'redo';
  return null;
}

const NON_TEXT_INPUTS = [
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'image',
  'range',
  'color',
  'file',
];

/**
 * Whether a key press lands where typing means something, so Ctrl+Z belongs to the field. A
 * ticked checkbox or a focused button is not one: the editor's own undo must still work there.
 */
export function isTextEntry(target: {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
}): boolean {
  if (target.isContentEditable === true) return true;
  const tag = target.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !NON_TEXT_INPUTS.includes((target.type ?? 'text').toLowerCase());
}
