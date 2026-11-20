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
  PadControl,
  Plan,
  Press,
  Scheme,
  SetupDevices,
} from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
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

/** The stick is not a button: it has no presses, only directions. Actions never go on it. */
export const isStick = (control: ControlId): boolean =>
  control.slice(control.indexOf('.') + 1) === 'stick';

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

/**
 * Puts an action on a slot. Assigning is moving: the action leaves any other slot it held in
 * this mode in the same binding set (a key and a mouse button, or two buttons sending Xbox
 * controls), and whatever the slot held becomes unplaced. The stick takes no action. On a control
 * sending an Xbox control, whatever else is on that control is displaced (THE PAD RULE).
 */
export function assign(scheme: Scheme, slot: Slot, action: ActionId, game: Game): Scheme {
  if (isStick(slot.control)) return scheme;
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
  return assign(clear(scheme, from), to, action, game);
}

// ---- What the setup plays with ----

/**
 * Changes what a setup plays with. The left Azeron always brings the mouse. Controls the setup no
 * longer has lose their actions, which go back to the unplaced lists. A keyboard, mouse or
 * controller the setup gains starts from what the game ships: each action on no control of that
 * binding set in its mode goes on its own key, mouse button or controller button, where nothing
 * else of the setup does something with it in that mode.
 */
export function setDevices(scheme: Scheme, devices: SetupDevices, game: Game): Scheme {
  const next: SetupDevices = { ...devices, mouse: setupOf(devices).mouse };
  const before = setupOf(scheme.devices);
  const after = setupOf(next);
  if (JSON.stringify(next) === JSON.stringify(scheme.devices)) return scheme;
  const map: Scheme['map'] = Object.fromEntries(
    Object.entries(scheme.map).map(([mode, byControl]) => [
      mode,
      Object.fromEntries(Object.entries(byControl).filter(([control]) => inSetup(after, control))),
    ]),
  );
  let out: Scheme = { ...scheme, devices: next, map };
  const gained = (control: ControlId) => inSetup(after, control) && !inSetup(before, control);
  // The fixed controls an action can go on: keys, mouse buttons, the controller's buttons.
  const known = new Set(
    [...KEYBOARD_MOUSE.controls, ...XBOX_PAD.controls].filter((c) => c.sends).map((c) => c.id),
  );
  for (const action of game.actions) {
    const mode = action.mode;
    const key = action.native?.key;
    const homes = [
      key?.kind === 'key' && (key.mods ?? []).length === 0 ? `key.${key.code}` : undefined,
      key?.kind === 'mouse' ? `mouse.${key.button}` : undefined,
      action.native?.pad === undefined ? undefined : `pad.${action.native.pad}`,
    ];
    for (const home of homes) {
      if (home === undefined || !known.has(home) || !gained(home)) continue;
      if (shownAction(out, mode, home) !== undefined) continue;
      // Already on a control of that binding set (an Azeron button sending it counts): kept there.
      const set = controlSet(out, home);
      const placed = Object.entries(own(out.map, mode) ?? {}).some(
        ([control, presses]) =>
          controlSet(out, control) === set && PRESSES.some((p) => presses[p] === action.id),
      );
      if (placed) continue;
      out = assign(out, { mode, control: home, press: 'tap' }, action.id, game);
    }
  }
  return out;
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
  const presses = own(own(scheme.map, mode) ?? {}, control) ?? {};
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
      // The same reading core's check makes of each press. A unit's button sends what its pin
      // says. A fixed control (a key, a mouse button, a pad button) only taps, so only its
      // other presses send nothing: its tap must survive. A control no device has sends nothing.
      const pin = [...(plan.units.left?.pins ?? []), ...(plan.units.right?.pins ?? [])].find(
        (p) => p.control === control,
      );
      // A control of a device the setup doesn't use sends nothing on any press.
      const known =
        inSetup(setupOf(scheme.devices), control) &&
        BUILT_IN_DEVICES.some((d) => d.controls.some((c) => c.id === control));
      const sendsNothing = (press: Press): boolean =>
        pin !== undefined ? pin.presses[press] === undefined : known ? press !== 'tap' : true;
      const slots = slotsOn(scheme, mode, control).filter((s) => sendsNothing(s.press));
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
