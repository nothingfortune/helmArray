// The editor's edits, as pure functions on a Scheme, and its undo history. Nothing here touches
// React, the DOM or the disk. Every edit returns a new scheme and leaves its input alone; an
// edit that would change nothing returns the very same object, so the history can tell that no
// edit happened (and nothing is saved).
//
// The ledger is never touched: it is the resolver's record of keys handed out, and Apply's job.

import type {
  ActionId,
  AzeronUse,
  Behaviour,
  ControlId,
  Finding,
  Game,
  ModeId,
  PadControl,
  Press,
  Scheme,
  SetupDevices,
} from '@helmarray/core';
import {
  CHECK_RULES,
  DEFAULT_TURBO_INTERVAL,
  KEYBOARD_MOUSE,
  XBOX_PAD,
  PAD_CONTROLS,
  PRESSES,
  controlSet,
  inSetup,
  own,
  padSignalOf,
  setupOf,
  stickForOutput,
  stickPadsOf,
  withOwn,
} from '@helmarray/core';

/** One press of one control, in one mode: the place an action sits. */
export interface Slot {
  mode: ModeId;
  control: ControlId;
  press: Press;
}

type PressMap = Partial<Record<Press, ActionId>>;
type ByControl = Record<ControlId, PressMap>;

const STICKS = new Set(['stick', 'left_stick', 'right_stick']);

/**
 * A stick is not a button: it has no presses, only directions. Actions never go on it. A unit's
 * stick, and the controller's two.
 */
export const isStick = (control: ControlId): boolean =>
  STICKS.has(control.slice(control.indexOf('.') + 1));

/** The reason stored when the player taps "Keep, I know". The canvas has no field for one. */
export const KEPT_REASON = 'Kept on purpose';

/** A copy of a record without one key. */
function omit<R extends object>(record: R, key: keyof R): R {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key)) as R;
}

/**
 * A copy of one mode's map that can be changed freely. Built with fromEntries, and changed with
 * `withOwn`, never `out[control] = ...`: a control the scheme file names `__proto__` or
 * `constructor` is an ordinary entry, not a prototype to replace or Object to write onto.
 */
function copyMode(scheme: Scheme, mode: ModeId): ByControl {
  return Object.fromEntries(
    Object.entries(own(scheme.map, mode) ?? {}).map(([control, presses]) => [
      control,
      { ...presses },
    ]),
  );
}

/** Drops controls left with no press, so an emptied button leaves no trace. */
function prune(byControl: ByControl): ByControl {
  return Object.fromEntries(
    Object.entries(byControl).filter(([, presses]) =>
      PRESSES.some((p) => presses[p] !== undefined),
    ),
  );
}

const withMode = (scheme: Scheme, mode: ModeId, byControl: ByControl): Scheme => ({
  ...scheme,
  map: { ...scheme.map, [mode]: prune(byControl) },
});

/** The action on a slot, if any. */
export const actionAt = (scheme: Scheme, slot: Slot): ActionId | undefined =>
  own(own(scheme.map, slot.mode) ?? {}, slot.control)?.[slot.press];

/*
 * CONTROLLER OUTPUT: THE PAD RULE.
 *
 * An Xbox control is one live control in the game: the controller's own button and every Azeron
 * button sending it (core's `padSignalOf`). The game's controller bindings are the setup's: in a
 * mode, a pad control does the one action the setup puts on it, and every control sending it
 * shows that action (`shownAction`). The game's shipped pad bindings are only where a preset
 * starts; nothing here follows them.
 *
 * 1. Assigning action A to the tap of a control sending P puts A there, takes A off every other
 *    slot in the mode (assigning is moving), and takes whatever else is on P off every slot in the
 *    mode whose control sends P. That action is displaced: it goes back to the unplaced list, and
 *    the resolver takes its controller binding off P. The game's binding for A becomes P.
 * 2. An Azeron button sending no Xbox control is given one first: the one the game ships A on, if
 *    it is free, else the first free one in PAD_CONTROLS order. Free: no control of the setup
 *    sending it carries an action in any mode, and no stick of the setup sends it. An Azeron button
 *    sending it with nothing on it gives it up. None free: the button sends nothing, and core's
 *    `sends-nothing` says so. An action a stick of the setup sends for (Move forward, on the left
 *    stick's up) is the exception: the button sends that same direction, whatever it sent, so the
 *    stick keeps it (STICK DIRECTION KEYS rule 3 in core, for an Xbox stick).
 * 3. Clearing the tap of a control sending P takes the action off P: off every slot in the mode
 *    whose control sends P. An Azeron button left with no action in any mode stops sending (its
 *    pad map entry goes), so it does nothing; the controller's own button can't stop, and the
 *    resolver takes what the game ships on P off it.
 * 4. Moving is a clear of the source (rule 3) and an assign at the target (rules 1 and 2).
 *
 * The pad map changes only by rules 2 and 3. It is part of the scheme, so undo and redo cover it.
 */

/** The controls of a mode's map that send this pad control, the given one included. */
function sendingIn(scheme: Scheme, byControl: ByControl, pad: PadControl): ControlId[] {
  return Object.keys(byControl).filter((control) => padSignalOf(scheme, control) === pad);
}

/**
 * What a control shows in a mode: its own leading action (tap, else long press, else double tap),
 * else, for a control sending an Xbox control, the action another control sending it carries.
 */
export function shownAction(
  scheme: Scheme,
  mode: ModeId,
  control: ControlId,
): { press: Press; id: ActionId } | undefined {
  const byControl = own(scheme.map, mode) ?? {};
  const presses = own(byControl, control);
  for (const press of PRESSES) {
    const id = presses?.[press];
    if (id !== undefined) return { press, id };
  }
  const pad = padSignalOf(scheme, control);
  if (pad === undefined) return undefined;
  for (const other of sendingIn(scheme, byControl, pad)) {
    const id = byControl[other]?.tap;
    if (id !== undefined) return { press: 'tap', id };
  }
  return undefined;
}

/**
 * Everything a control shows in a mode, press by press: its own presses, and on the tap, for a
 * control sending an Xbox control with no tap of its own, what that control does (THE PAD RULE).
 * What a switch of output or devices must keep.
 */
export function shownPresses(scheme: Scheme, mode: ModeId, control: ControlId): PressMap {
  const byControl = own(scheme.map, mode) ?? {};
  const out: PressMap = { ...own(byControl, control) };
  const pad = out.tap === undefined ? padSignalOf(scheme, control) : undefined;
  if (pad !== undefined) {
    const mirrored = sendingIn(scheme, byControl, pad)
      .map((other) => byControl[other]?.tap)
      .find((id) => id !== undefined);
    if (mirrored !== undefined) out.tap = mirrored;
  }
  return Object.fromEntries(PRESSES.filter((p) => out[p] !== undefined).map((p) => [p, out[p]]));
}

/** A copy of the pad map without these buttons. */
const without = (padMap: Scheme['padMap'], controls: readonly ControlId[]): Scheme['padMap'] =>
  Object.fromEntries(
    Object.entries(padMap).filter(([c]) => !controls.includes(c)),
  ) as Scheme['padMap'];

/**
 * THE PAD RULE, the stick's directions: an Azeron button sends a direction a stick of the setup
 * sends only while it carries, in some mode, an action the game ships on that direction. A button
 * whose stick action left it, moved or displaced, stops sending: it would do the stick's action
 * while shown empty, or bind another action onto the stick.
 */
function dropStrayStickPads(scheme: Scheme, game: Game): Scheme {
  if (scheme.output !== 'pad') return scheme;
  const sticks = stickPadsOf(scheme);
  const stray = Object.entries(scheme.padMap)
    .filter(([control, pad]) => {
      if (!sticks.has(pad) || padSignalOf(scheme, control) === undefined) return false;
      return !Object.values(scheme.map).some((byControl) => {
        const id = own(byControl, control)?.tap;
        return id !== undefined && game.actions.some((a) => a.id === id && a.native?.pad === pad);
      });
    })
    .map(([control]) => control);
  return stray.length === 0 ? scheme : { ...scheme, padMap: without(scheme.padMap, stray) };
}

/** Whether a pad control is free for a button: nothing sending it carries an action anywhere. */
function padFree(scheme: Scheme, pad: PadControl, sticks: ReadonlySet<PadControl>): boolean {
  if (sticks.has(pad)) return false;
  return Object.values(scheme.map).every((byControl) =>
    Object.entries(byControl).every(
      ([control, presses]) =>
        padSignalOf(scheme, control) !== pad || !PRESSES.some((p) => presses[p] !== undefined),
    ),
  );
}

/**
 * THE PAD RULE, rule 2: gives an Azeron button that sends nothing a free pad control, and one that
 * gets an action a stick sends for that stick direction.
 */
function givePad(scheme: Scheme, control: ControlId, action: ActionId, game: Game): Scheme {
  const setup = setupOf(scheme.devices);
  const azeron = control.startsWith('L.') || control.startsWith('R.');
  if (scheme.output !== 'pad' || !azeron || !inSetup(setup, control)) return scheme;
  const sticks = stickPadsOf(scheme);
  const ownPad = game.actions.find((a) => a.id === action)?.native?.pad;
  if (ownPad !== undefined && sticks.has(ownPad)) {
    // A stick of the setup sends it: the button sends the same direction, a second way to do it,
    // as a button may send the key a key stick sends for its action. The game binding stays.
    if (own(scheme.padMap, control) === ownPad) return scheme;
    return { ...scheme, padMap: withOwn(scheme.padMap, control, ownPad) };
  }
  const current = padSignalOf(scheme, control);
  // A stick's direction is the button's only for the stick's own action: any other action gets a
  // control of its own, chosen afresh, or it would be on the stick too.
  if (current !== undefined && !sticks.has(current)) return scheme;
  const pick = [...(ownPad === undefined ? [] : [ownPad]), ...PAD_CONTROLS].find((pad) =>
    padFree(scheme, pad, sticks),
  );
  if (pick === undefined) {
    return current === undefined
      ? scheme
      : { ...scheme, padMap: without(scheme.padMap, [control]) };
  }
  // An empty Azeron button sending it gives it up: one button per Xbox control.
  const padMap = Object.fromEntries(
    Object.entries(scheme.padMap).filter(([, sends]) => sends !== pick),
  ) as Scheme['padMap'];
  return { ...scheme, padMap: withOwn(padMap, control, pick) };
}

/** Whether a control is one of a device's: a unit, the keyboard, the mouse or the controller. */
const ofDevice = (control: ControlId): boolean => /^(L|R|key|mouse|pad)\./.test(control);

/**
 * The presses a control can send: an Azeron button sending keys has all three; one sending Xbox
 * controls, a key, a mouse button and a controller button only tap. Nothing is put on another.
 */
export function pressesOf(scheme: Scheme, control: ControlId): readonly Press[] {
  const azeron = control.startsWith('L.') || control.startsWith('R.');
  return azeron && scheme.output === 'keys' ? PRESSES : ['tap'];
}

/**
 * Puts an action on a slot. Assigning is moving: the action leaves any other slot it held in
 * this mode in the same binding set (a key and a mouse button, or two buttons sending Xbox
 * controls), and whatever the slot held becomes unplaced. The stick takes no action. On a control
 * sending an Xbox control, whatever else is on that control is displaced (THE PAD RULE).
 */
export function assign(scheme: Scheme, slot: Slot, action: ActionId, game: Game): Scheme {
  if (isStick(slot.control) || !pressesOf(scheme, slot.control).includes(slot.press)) return scheme;
  // A control of a device the setup doesn't have takes nothing (an undo may have taken it away).
  if (ofDevice(slot.control) && !inSetup(setupOf(scheme.devices), slot.control)) return scheme;
  const given = slot.press === 'tap' ? givePad(scheme, slot.control, action, game) : scheme;
  let byControl = copyMode(given, slot.mode);
  let changed = given !== scheme;
  // Moving is within one of the game's binding sets: an action can be on the mouse and on a
  // button sending an Xbox control at once, as the game binds it in each set.
  const set = controlSet(given, slot.control);
  const sameSet = (control: ControlId) => {
    const other = controlSet(given, control);
    return set === undefined || other === undefined || other === set;
  };
  for (const control of Object.keys(byControl)) {
    if (!sameSet(control)) continue;
    for (const press of PRESSES) {
      const presses = own(byControl, control) ?? {};
      if (presses[press] === action && !(control === slot.control && press === slot.press)) {
        byControl = withOwn(byControl, control, omit(presses, press));
        changed = true;
      }
    }
  }
  const pad = slot.press === 'tap' ? padSignalOf(given, slot.control) : undefined;
  if (pad !== undefined) {
    for (const other of sendingIn(given, byControl, pad)) {
      const presses = own(byControl, other) ?? {};
      if (other === slot.control || presses.tap === undefined) continue;
      byControl = withOwn(byControl, other, omit(presses, 'tap'));
      changed = true;
    }
  }
  const here = own(byControl, slot.control) ?? {};
  if (here[slot.press] !== action) {
    byControl = withOwn(byControl, slot.control, { ...here, [slot.press]: action });
    changed = true;
  }
  return changed ? dropStrayStickPads(withMode(given, slot.mode, byControl), game) : scheme;
}

/** Whether a control carries an action in any mode. */
const carriesAny = (scheme: Scheme, control: ControlId): boolean =>
  Object.values(scheme.map).some((byControl) =>
    PRESSES.some((p) => own(byControl, control)?.[p] !== undefined),
  );

/**
 * Takes the action off a slot. On the tap of a control sending an Xbox control it comes off that
 * control: off every control sending it, and an Azeron button left with nothing stops sending it.
 */
export function clear(scheme: Scheme, slot: Slot): Scheme {
  const pad = slot.press === 'tap' ? padSignalOf(scheme, slot.control) : undefined;
  if (pad === undefined) {
    if (actionAt(scheme, slot) === undefined) return scheme;
    const byControl = copyMode(scheme, slot.mode);
    return withMode(
      scheme,
      slot.mode,
      withOwn(byControl, slot.control, omit(own(byControl, slot.control) ?? {}, slot.press)),
    );
  }
  let byControl = copyMode(scheme, slot.mode);
  const group = sendingIn(scheme, byControl, pad).filter(
    (c) => own(byControl, c)?.tap !== undefined,
  );
  if (group.length === 0) return scheme;
  for (const control of group) {
    byControl = withOwn(byControl, control, omit(own(byControl, control) ?? {}, 'tap'));
  }
  const cleared = withMode(scheme, slot.mode, byControl);
  const silent = Object.keys(cleared.padMap).filter(
    (control) => group.includes(control) && !carriesAny(cleared, control),
  );
  if (silent.length === 0) return cleared;
  return {
    ...cleared,
    padMap: Object.fromEntries(
      Object.entries(cleared.padMap).filter(([control]) => !silent.includes(control)),
    ) as Scheme['padMap'],
  };
}

/** Moves the action on one slot to another in the same mode; what was on the target is dropped. */
export function move(scheme: Scheme, from: Slot, to: Slot, game: Game): Scheme {
  if (from.mode !== to.mode) return scheme;
  if (from.control === to.control && from.press === to.press) return scheme;
  const shown = shownAction(scheme, from.mode, from.control);
  const action =
    actionAt(scheme, from) ??
    (from.press === 'tap' && shown?.press === 'tap' ? shown.id : undefined);
  if (action === undefined || isStick(to.control)) return scheme;
  if (!pressesOf(scheme, to.control).includes(to.press)) return scheme;
  return assign(clear(scheme, from), to, action, game);
}

/**
 * An action dropped on a control's tap: from the list it is put there; dragged off a control
 * (`from`, the press its label showed: a long press, a double tap) it moves from that press. The
 * stick takes none, and only an action of the mode is taken.
 */
export function drop(
  scheme: Scheme,
  mode: ModeId,
  control: ControlId,
  action: ActionId,
  from: { control: ControlId; press: Press } | undefined,
  game: Game,
): Scheme {
  if (isStick(control) || !game.actions.some((a) => a.id === action && a.mode === mode))
    return scheme;
  const to: Slot = { mode, control, press: 'tap' };
  return from === undefined
    ? assign(scheme, to, action, game)
    : move(scheme, { mode, control: from.control, press: from.press }, to, game);
}

// ---- What the setup plays with ----

/**
 * Changes what a setup plays with. The left Azeron always brings the mouse. Controls the setup no
 * longer has lose their actions, which go back to the unplaced lists; a control it keeps shows what
 * it showed, though the control it mirrored is gone. A keyboard, mouse or
 * controller the setup gains starts from what the game ships: each action on no control of that
 * binding set in its mode goes on its own key, mouse button or controller button, where nothing
 * else of the setup does something with it in that mode.
 */
export function setDevices(scheme: Scheme, devices: SetupDevices, game: Game): Scheme {
  const next: SetupDevices = { ...devices, mouse: setupOf(devices).mouse };
  const before = setupOf(scheme.devices);
  const after = setupOf(next);
  if (JSON.stringify(next) === JSON.stringify(scheme.devices)) return scheme;
  const kept = (control: ControlId) =>
    inSetup(before, control) && inSetup(after, control) && !isStick(control);
  // The fixed controls an action can go on: keys, mouse buttons, the controller's buttons.
  const known = new Set(
    [...KEYBOARD_MOUSE.controls, ...XBOX_PAD.controls].filter((c) => c.sends).map((c) => c.id),
  );
  const out: Scheme = { ...scheme, devices: next };
  // Every record here is keyed by data (mode and control ids, which may be `__proto__`): built as
  // a Map, and turned into a record with Object.fromEntries, never written by key.
  const map = new Map<ModeId, ByControl>();
  for (const [mode, byControl] of Object.entries(scheme.map)) {
    // Every control the setup keeps shows what it showed, the tap it showed through its Xbox
    // control included: that control may be one the setup loses.
    const controls = new Set([...Object.keys(byControl), ...Object.keys(scheme.padMap), ...known]);
    const rows: [ControlId, PressMap][] = [];
    for (const control of controls) {
      if (!kept(control)) continue;
      const shown = shownPresses(scheme, mode, control);
      if (Object.keys(shown).length > 0) rows.push([control, shown]);
    }
    map.set(mode, Object.fromEntries(rows));
  }
  // A device the setup gains starts from what the game ships: each action on no control of that
  // binding set in its mode goes on its own key, mouse button or controller button, where nothing
  // of the setup shows or sends anything.
  const gained = (control: ControlId) => inSetup(after, control) && !inSetup(before, control);
  const withMap: Scheme = { ...out, map: Object.fromEntries(map) };
  for (const action of game.actions) {
    const mode = action.mode;
    const key = action.native?.key;
    const homes = [
      key?.kind === 'key' && (key.mods ?? []).length === 0 ? `key.${key.code}` : undefined,
      key?.kind === 'mouse' ? `mouse.${key.button}` : undefined,
      action.native?.pad === undefined ? undefined : `pad.${action.native.pad}`,
    ];
    for (const home of homes) {
      const rows = map.get(mode) ?? {};
      if (home === undefined || !known.has(home) || !gained(home)) continue;
      const set = controlSet(withMap, home);
      const busy = Object.entries(rows).some(
        ([control, presses]) =>
          (controlSet(withMap, control) === set && PRESSES.some((p) => presses[p] === action.id)) ||
          (control === home && PRESSES.some((p) => presses[p] !== undefined)),
      );
      // An Xbox control an Azeron button sends is that button's too: it would start showing it.
      const sent =
        home.startsWith('pad.') &&
        Object.keys(withMap.padMap).some(
          (c) => c !== home && padSignalOf(withMap, c) === home.slice(4),
        );
      if (busy || sent) continue;
      map.set(mode, withOwn<PressMap>(rows, home, { tap: action.id }));
    }
  }
  return settle({ ...out, map: Object.fromEntries([...map].map(([m, r]) => [m, prune(r)])) }, game);
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
 * Whether the player may keep a finding. The checks can be kept; the resolver's own findings (a
 * key it cannot name, a pool it spent, a stick's action moved off it) are facts the player cannot
 * overrule.
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

/**
 * Gives every scheme in the history (the past and future too) the ledger it was given: the keys
 * Apply dealt and saved. The editor never changes a ledger, and a key once given never moves, so
 * an undo must not hand back the older, shorter one. The same history comes back when every
 * scheme already has it, so nothing re-renders and nothing is saved.
 */
export function adoptLedger(history: History<Scheme>, ledger: Scheme['ledger']): History<Scheme> {
  const wanted = JSON.stringify(ledger);
  const adopt = (scheme: Scheme): Scheme =>
    JSON.stringify(scheme.ledger) === wanted
      ? scheme
      : { ...scheme, ledger: structuredClone(ledger) };
  const past = history.past.map(adopt);
  const present = adopt(history.present);
  const future = history.future.map(adopt);
  const same =
    present === history.present &&
    past.every((s, i) => s === history.past[i]) &&
    future.every((s, i) => s === history.future[i]);
  return same ? history : { past, present, future };
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

/** `historyShortcut`, or nothing at all while the shortcuts are off. */
export function historyAction(
  e: Parameters<typeof historyShortcut>[0],
  enabled: boolean,
): 'undo' | 'redo' | null {
  return enabled ? historyShortcut(e) : null;
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

// ---- What the Azerons send ----

const isAzeron = (control: ControlId): boolean =>
  control.startsWith('L.') || control.startsWith('R.');

/**
 * "Azerons send: Keys | Controller". Every Azeron button keeps the action on its tap, now sent as
 * the other kind of signal, in the other binding set of the game: with a controller each gets an
 * Xbox control (THE PAD RULE, rule 2: the one the game ships its action on when free), with keys
 * the pad map empties. What a button showed only through its Xbox control (the controller's button
 * carries it) becomes its own. A controller button only taps, so a long press or a double tap
 * comes off (its action is unplaced); switching to keys keeps them. Each stick follows (core's
 * `stickForOutput`). The keyboard and the mouse keep what
 * they have, and the ledger is never touched. With a controller in the setup, it keeps doing what
 * it did: switching to keys gives its buttons the actions they showed through an Azeron button,
 * and switching to a controller puts an Azeron button on the control the controller already has
 * its action on.
 */
export function setOutput(scheme: Scheme, output: Scheme['output'], game: Game): Scheme {
  if (scheme.output === output) return scheme;
  const setup = setupOf(scheme.devices);
  // 1. The whole layout as shown, for every control of the setup.
  const pads = XBOX_PAD.controls.filter((c) => c.sends).map((c) => c.id);
  // Keyed by data (mode and control ids, which may be `__proto__`): Maps and entry lists, turned
  // into records with Object.fromEntries, never written by key.
  const shown = new Map<ModeId, ByControl>();
  for (const [mode, byControl] of Object.entries(scheme.map)) {
    const rows: [ControlId, PressMap][] = [];
    for (const control of new Set([
      ...Object.keys(byControl),
      ...Object.keys(scheme.padMap),
      ...pads,
    ])) {
      if (!inSetup(setup, control) || isStick(control)) continue;
      const presses = shownPresses(scheme, mode, control);
      if (Object.keys(presses).length > 0) rows.push([control, presses]);
    }
    shown.set(mode, Object.fromEntries(rows));
  }
  // 2. The new maps, built from it. The Azeron buttons keep what they showed, as their own: all
  // of it with keys, the tap with a controller. With keys the controller's buttons keep what they
  // showed, which may have been an Azeron button's; with a controller they keep their own. Every
  // other control keeps its own presses, untouched.
  const map: Scheme['map'] = Object.fromEntries(
    Object.entries(scheme.map).map(([mode, byControl]) => {
      const rows: [ControlId, PressMap][] = Object.entries(byControl)
        .filter(
          ([control]) => !isAzeron(control) && !(control.startsWith('pad.') && output === 'keys'),
        )
        .map(([control, presses]) => [control, { ...presses }]);
      for (const [control, presses] of Object.entries(shown.get(mode) ?? {})) {
        if (isAzeron(control)) {
          const kept: PressMap =
            output === 'keys'
              ? { ...presses }
              : presses.tap === undefined
                ? {}
                : { tap: presses.tap };
          rows.push([control, kept]);
        } else if (control.startsWith('pad.') && output === 'keys') {
          rows.push([control, { ...presses }]);
        }
      }
      return [mode, prune(Object.fromEntries(rows))];
    }),
  );
  let behaviour: Scheme['behaviour'] = { ...scheme.behaviour };
  for (const prefix of ['L', 'R'] as const) {
    const id = `${prefix}.stick`;
    const before: Behaviour = own(scheme.behaviour, id) ?? {};
    behaviour = withOwn<Behaviour>(behaviour, id, {
      ...before,
      stick: stickForOutput(prefix === 'L' ? 'left' : 'right', before.stick, output, game),
    });
  }
  const out: Scheme = { ...scheme, output, padMap: {}, map, behaviour };
  // 3. With a controller, the Xbox control each Azeron button sends; then one consistency pass.
  return settle(output === 'pad' ? { ...out, padMap: choosePads(out, game) } : out, game);
}

/**
 * The Xbox control for each Azeron button with an action, for a switch to controller output.
 * Order-free by construction: each button's tap vector (its tap in every mode, empty counting as
 * its own value) is computed first, and only buttons with the very same vector share a control, so
 * no button can come to show an action it didn't (every control sending one Xbox control shows what
 * it carries). Each group of buttons gets one control, the groups taken in the order of their
 * vectors, never of the map:
 *   1. the controller's own button, when its vector is the group's: it already does exactly that;
 *   2. the stick's direction, when every action of the group is one the game ships on it and a
 *      stick of the setup sends it (STICK DIRECTION KEYS, rule 3);
 *   3. the control the game ships the group's first action on, when free;
 *   4. the first free control.
 * A stick's direction goes to one group only, as every control does.
 * Free: no stick sends it, no other group has it, and the controller's own button on it carries
 * nothing in any mode (it may then come to show the group's actions: it is the same control).
 * With none free a group sends nothing, which the checks say (`sends-nothing`): never a merge.
 */
function choosePads(scheme: Scheme, game: Game): Scheme['padMap'] {
  const sticks = stickPadsOf(scheme);
  // Modes in one order, whatever order the scheme lists them in.
  const modes = Object.keys(scheme.map).sort();
  const vectorOf = (control: ControlId) =>
    JSON.stringify(modes.map((mode) => own(own(scheme.map, mode) ?? {}, control)?.tap ?? null));
  const empty = JSON.stringify(modes.map(() => null));
  // The controller's own buttons: what each carries, by control.
  const controller = new Map<PadControl, string>();
  for (const pad of PAD_CONTROLS) {
    if (padSignalOf(scheme, `pad.${pad}`) === undefined) continue;
    controller.set(pad, vectorOf(`pad.${pad}`));
  }
  // The Azeron buttons with an action, grouped by vector.
  const groups = new Map<string, ControlId[]>();
  const controls = new Set(
    Object.values(scheme.map).flatMap((byControl) => Object.keys(byControl)),
  );
  for (const control of [...controls].filter(isAzeron).sort()) {
    const vector = vectorOf(control);
    if (vector === empty) continue;
    groups.set(vector, [...(groups.get(vector) ?? []), control]);
  }
  const taken = new Set<PadControl>();
  const free = (pad: PadControl) =>
    !sticks.has(pad) &&
    !taken.has(pad) &&
    (controller.get(pad) === undefined || controller.get(pad) === empty);
  const nativeOf = (id: ActionId) => game.actions.find((a) => a.id === id)?.native?.pad;
  let padMap: Scheme['padMap'] = {};
  for (const [vector, buttons] of [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const actions = (JSON.parse(vector) as (ActionId | null)[]).filter(
      (id): id is ActionId => id !== null,
    );
    const pads = actions.map(nativeOf);
    const same = PAD_CONTROLS.find(
      (pad) => !sticks.has(pad) && !taken.has(pad) && controller.get(pad) === vector,
    );
    // A stick's direction is one group's too: two groups on it would show each other's actions.
    const stick =
      pads[0] !== undefined &&
      sticks.has(pads[0]) &&
      !taken.has(pads[0]) &&
      pads.every((p) => p === pads[0])
        ? pads[0]
        : undefined;
    const native = pads.find((pad) => pad !== undefined && free(pad));
    const pick = same ?? stick ?? native ?? PAD_CONTROLS.find(free);
    if (pick === undefined) continue;
    taken.add(pick);
    for (const button of buttons) padMap = withOwn(padMap, button, pick);
  }
  return padMap;
}

/** The one consistency pass after a conversion: a button sends a stick's direction only for it. */
const settle = (scheme: Scheme, game: Game): Scheme => dropStrayStickPads(scheme, game);

/**
 * Which Xbox control an Azeron button sends, chosen in the side panel (controller output only).
 * The button's own action goes with it: the game's controller binding for it becomes the new
 * control, and whatever else was on that control comes off (THE PAD RULE, rule 1). Another Azeron
 * button already sending it takes this button's old control in exchange, with its own action: a
 * swap. A button that sent nothing joins the others sending it instead (both press that control).
 * Never a direction a stick of the setup sends. A choice that can't stand (a button carrying a
 * stick's action stays on the stick's direction) changes nothing.
 */
export function setPadControl(
  scheme: Scheme,
  control: ControlId,
  pad: PadControl,
  game: Game,
): Scheme {
  if (scheme.output !== 'pad' || !isAzeron(control) || isStick(control)) return scheme;
  if (!inSetup(setupOf(scheme.devices), control) || stickPadsOf(scheme).has(pad)) return scheme;
  const current = padSignalOf(scheme, control);
  if (current === pad) return scheme;
  const swapped =
    current === undefined
      ? []
      : Object.keys(scheme.padMap).filter((c) => c !== control && padSignalOf(scheme, c) === pad);
  let padMap = withOwn(scheme.padMap, control, pad);
  if (current !== undefined) for (const other of swapped) padMap = withOwn(padMap, other, current);
  let out: Scheme = { ...scheme, padMap };
  // Each button's own action, put back on its tap in every mode: rule 1 does the displacing.
  for (const mode of Object.keys(scheme.map)) {
    for (const c of [control, ...swapped]) {
      const action = own(own(scheme.map, mode) ?? {}, c)?.tap;
      if (action !== undefined) out = assign(out, { mode, control: c, press: 'tap' }, action, game);
    }
  }
  out = dropStrayStickPads(out, game);
  return padSignalOf(out, control) === pad ? out : scheme;
}

// ---- The device chooser and the setup's name ----

/**
 * Which Azerons the setup uses: both, the left one (which always brings the mouse), or none. The
 * mouse stays only with the keyboard or the left Azeron.
 */
export const chooseAzerons = (devices: SetupDevices, azerons: AzeronUse): SetupDevices => ({
  ...devices,
  azerons,
  mouse: devices.keyboard || azerons === 'left',
});

/** The keyboard and the mouse, together: one choice for the player. */
export const chooseKeyboard = (devices: SetupDevices, on: boolean): SetupDevices => ({
  ...devices,
  keyboard: on,
  mouse: on || devices.azerons === 'left',
});

export const chooseController = (devices: SetupDevices, on: boolean): SetupDevices => ({
  ...devices,
  controller: on,
});

/** Whether a setup plays with anything at all: a choice that leaves nothing isn't offered. */
export const hasDevices = (devices: SetupDevices): boolean =>
  devices.azerons !== 'none' || devices.keyboard || devices.mouse || devices.controller;

/** The longest name a setup takes. */
export const NAME_LIMIT = 40;

/** Renames a setup: the name trimmed, never empty, never past the limit. */
export function renameScheme(scheme: Scheme, name: string): Scheme {
  const next = name.trim().slice(0, NAME_LIMIT).trim();
  return next === '' || next === scheme.name ? scheme : { ...scheme, name: next };
}

// ---- Key labels ----

/** The longest key label: a key is at most two or three short words wide. */
export const KEY_LABEL_LIMIT = 16;

/** The key label of a control in a mode, if it has one (and it is text). */
export function keyLabelOf(scheme: Scheme, mode: ModeId, control: ControlId): string | undefined {
  const label = own(own(scheme.keyLabels ?? {}, mode) ?? {}, control);
  return typeof label === 'string' ? label : undefined;
}

/** The key labels with one set, or removed (`undefined`). Built by entries: ids may be `__proto__`. */
function withKeyLabel(
  scheme: Scheme,
  mode: ModeId,
  control: ControlId,
  label: string | undefined,
): Scheme {
  const labels = scheme.keyLabels ?? {};
  const byControl = Object.entries(own(labels, mode) ?? {}).filter(([c]) => c !== control);
  if (label !== undefined) byControl.push([control, label]);
  return {
    ...scheme,
    keyLabels: Object.fromEntries([
      ...Object.entries(labels).filter(([m]) => m !== mode),
      [mode, Object.fromEntries(byControl)],
    ]),
  };
}

/**
 * Sets a control's key label in a mode: trimmed, cut at the limit, removed when blank. Only a
 * control showing an action takes one: the label is the player's word for that action on that key.
 */
export function setKeyLabel(
  scheme: Scheme,
  mode: ModeId,
  control: ControlId,
  text: string,
): Scheme {
  const label = text.trim().slice(0, KEY_LABEL_LIMIT).trim();
  const current = keyLabelOf(scheme, mode, control);
  if (label === (current ?? '')) return scheme;
  if (label === '') return withKeyLabel(scheme, mode, control, undefined);
  if (shownAction(scheme, mode, control) === undefined) return scheme;
  return withKeyLabel(scheme, mode, control, label);
}

/** Which device a control is on, for where a moved label may go: either unit counts as one. */
const deviceOf = (control: ControlId): string => {
  const prefix = control.slice(0, control.indexOf('.'));
  return prefix === 'L' || prefix === 'R' ? 'azeron' : prefix;
};

/** The controls of a mode that show an action: those with one of their own, and those mirroring. */
function controlsShowing(scheme: Scheme, mode: ModeId, action: ActionId): ControlId[] {
  const controls = new Set([
    ...Object.keys(own(scheme.map, mode) ?? {}),
    ...Object.keys(scheme.padMap),
  ]);
  return [...controls].filter((c) => shownAction(scheme, mode, c)?.id === action);
}

/**
 * The key labels after an edit (`before` to `after`). A label is the player's word for the action
 * its control shows, so it stays while that control shows the same action; when the action moved to
 * another control of the same device it goes there (unless that one keeps a label of its own);
 * otherwise it goes. Returns `after` itself when no label changes.
 */
export function followLabels(before: Scheme, after: Scheme): Scheme {
  if (after === before) return after;
  const labels = after.keyLabels ?? {};
  let changed = false;
  const modes: [ModeId, Record<ControlId, string>][] = [];
  for (const [mode, byControl] of Object.entries(labels)) {
    const entries = Object.entries(byControl).filter(([, l]) => typeof l === 'string');
    const kept = new Map<ControlId, string>();
    const moving: [ControlId, ActionId, string][] = [];
    for (const [control, label] of entries) {
      const was = shownAction(before, mode, control)?.id;
      const now = shownAction(after, mode, control)?.id;
      if (now !== undefined && now === was) kept.set(control, label);
      else if (was !== undefined) moving.push([control, was, label]);
    }
    for (const [from, action, label] of moving) {
      const to = controlsShowing(after, mode, action).find(
        (c) =>
          c !== from &&
          deviceOf(c) === deviceOf(from) &&
          !kept.has(c) &&
          shownAction(before, mode, c)?.id !== action,
      );
      if (to !== undefined) kept.set(to, label);
    }
    if (kept.size !== entries.length || entries.some(([c, l]) => kept.get(c) !== l)) changed = true;
    modes.push([mode, Object.fromEntries(kept)]);
  }
  return changed ? { ...after, keyLabels: Object.fromEntries(modes) } : after;
}
