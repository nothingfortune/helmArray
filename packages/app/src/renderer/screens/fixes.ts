// The fixes: the obvious one-click answer to a finding, where one edit settles it, as pure functions
// on a Scheme. The checks draw "dot, one sentence, a fix button, Keep, I know" (the canvas's Main
// board); this is the fix button. Nothing here touches React, the DOM or the disk.

import type {
  ActionId,
  Behaviour,
  ControlId,
  Finding,
  Game,
  Hand,
  ModeId,
  Plan,
  Press,
  Scheme,
  StickBehaviour,
} from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
  resolve,
  CYBORG2_LEFT,
  CYBORG2_RIGHT,
  PRESSES,
  REST_ORDER,
  inSetup,
  own,
  padSignalOf,
  setupOf,
  stickForOutput,
  withOwn,
  xboxControllerPreset,
} from '@helmarray/core';
import type { Slot } from './editor-model';
import { assign, clear, isStick, setLatch, shownAction } from './editor-model';

export interface Fix {
  /** The button's words. */
  label: string;
  apply: (scheme: Scheme) => Scheme;
  /**
   * The control the fix puts something on, worked out from the scheme it is applied to: the editor
   * selects it, so the player sees where it went. Absent for a fix that only takes something off.
   */
  select?: (scheme: Scheme) => ControlId | undefined;
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

// ---- Put it on a button ----

/** Every control of every device helmArray knows. */
const KNOWN: ReadonlySet<ControlId> = new Set(
  BUILT_IN_DEVICES.flatMap((d) => d.controls.map((c) => c.id)),
);

/** The keys, mouse buttons and controller buttons, in device order: each sends what it is. */
const FIXED_CONTROLS: readonly ControlId[] = BUILT_IN_DEVICES.filter(
  (d) => d.kind === 'kbm' || d.kind === 'pad',
).flatMap((d) => d.controls.filter((c) => c.sends !== undefined).map((c) => c.id));

/** Every Azeron button in device order, left unit first. */
const UNIT_BUTTONS: readonly ControlId[] = [CYBORG2_LEFT, CYBORG2_RIGHT].flatMap((unit) =>
  unit.positions
    .filter((p) => p.name !== 'stick')
    .map((p) => `${unit.hand === 'left' ? 'L' : 'R'}.${p.name}`),
);

/** The *Xbox controller* preset's layout of a game, worked out once per game. */
const HOMES = new WeakMap<Game, Scheme['map']>();
function homesOf(game: Game): Scheme['map'] {
  const known = HOMES.get(game);
  if (known !== undefined) return known;
  const map = xboxControllerPreset(game).map;
  HOMES.set(game, map);
  return map;
}

/**
 * Where an action is tried, in order. First its homes: the button the *Xbox controller* preset gives
 * it (the layout both presets share), then its own key, mouse button and controller button. Then
 * every Azeron button, in the order the *game's own keys* preset fills them (`REST_ORDER`), then
 * the rest in device order, then every key, mouse button and controller button.
 */
function placesFor(game: Game, mode: ModeId, action: ActionId): ControlId[] {
  const native = game.actions.find((a) => a.id === action)?.native;
  const home = Object.entries(own(homesOf(game), mode) ?? {}).find(
    ([, presses]) => presses.tap === action,
  )?.[0];
  const key = native?.key;
  const homes = [
    home,
    key?.kind === 'key' && (key.mods ?? []).length === 0 ? `key.${key.code}` : undefined,
    key?.kind === 'mouse' ? `mouse.${key.button}` : undefined,
    native?.pad === undefined ? undefined : `pad.${native.pad}`,
  ].filter((c): c is ControlId => c !== undefined);
  return [...new Set([...homes, ...REST_ORDER, ...UNIT_BUTTONS, ...FIXED_CONTROLS])];
}

/** The controls an action may go on: of the setup, a device's, not a stick, empty in the mode. */
function emptyPlaces(scheme: Scheme, game: Game, mode: ModeId, action: ActionId): ControlId[] {
  const setup = setupOf(scheme.devices);
  return placesFor(game, mode, action).filter(
    (c) =>
      KNOWN.has(c) &&
      !isStick(c) &&
      inSetup(setup, c) &&
      shownAction(scheme, mode, c) === undefined,
  );
}

/**
 * Puts an action on the first empty button that can send it (`placesFor`), on its tap: the
 * button and the scheme it makes, or undefined when none can. With controller output a button
 * that would be left sending no Xbox control (every one taken) can't, and the next is tried.
 */
export function putOnButton(
  scheme: Scheme,
  game: Game,
  mode: ModeId,
  action: ActionId,
): { control: ControlId; scheme: Scheme } | undefined {
  for (const control of emptyPlaces(scheme, game, mode, action)) {
    const next = assign(scheme, { mode, control, press: 'tap' }, action, game);
    const unit = control.startsWith('L.') || control.startsWith('R.');
    if (shownAction(next, mode, control)?.id !== action) continue;
    if (unit && next.output === 'pad' && padSignalOf(next, control) === undefined) continue;
    return { control, scheme: next };
  }
  return undefined;
}

// ---- A stick ----

/** The unit and the hand of a stick control: `L.stick` is the left one. */
const handOf = (control: ControlId): Hand | undefined =>
  control === 'L.stick' ? 'left' : control === 'R.stick' ? 'right' : undefined;

/** A unit's stick set to `stick`, everything else of its behaviour kept. */
function withStick(scheme: Scheme, control: ControlId, stick: StickBehaviour): Scheme {
  const before: Behaviour = own(scheme.behaviour, control) ?? {};
  return {
    ...scheme,
    behaviour: withOwn<Behaviour>(scheme.behaviour, control, { ...before, stick }),
  };
}

/** What a stick becomes for the Azerons' output, and the button's words for it. */
function stickCandidate(
  scheme: Scheme,
  game: Game,
  control: ControlId,
  output: Scheme['output'],
): FixCandidate | undefined {
  const hand = handOf(control);
  if (hand === undefined) return undefined;
  const next = stickForOutput(hand, own(scheme.behaviour, control)?.stick, output, game);
  const label =
    next.mode === 'keys'
      ? 'Give it the movement keys'
      : next.mode === 'mouse'
        ? 'Use it as the mouse'
        : 'Use as controller stick';
  return { label, run: (s) => changed(s, withStick(s, control, next)), cannot: BY_HAND };
}

// ---- The fix for each finding: one shape, then one gate ----

/**
 * A fix, before the gate: its words, and a pure run that gives the scheme it makes, or null when
 * it can't act (nothing to change, no button that can send it). `cannot` is what the finding says
 * when it is not offered.
 */
export interface FixCandidate {
  label: string;
  run: (scheme: Scheme) => Scheme | null;
  select?: (scheme: Scheme) => ControlId | undefined;
  cannot: string;
}

/** The rules with a fix (`fixCandidate`): every other finding is the player's to settle. */
export const FIXABLE_RULES: ReadonlySet<string> = new Set([
  'missing-required',
  'stick-no-directions',
  'stick-not-keyboard',
  'mixed-input',
  'action-deleted',
  'hold-on-movement',
  'combat-tap-delayed',
  'menu-with-combat',
  'sends-nothing',
]);

/** Said when a fix ran but would not settle its finding, or would break something else. */
const BY_HAND = 'No one click fixes this; change it by hand.';

/** The scheme an edit made, or null when it changed nothing: a run that can't act. */
const changed = (before: Scheme, after: Scheme): Scheme | null => (after === before ? null : after);

/**
 * The one edit that may clear a finding, as a candidate: undefined for a rule with none. A key
 * collision has none: which of two actions should give way is the player's call. Nor has a mix of
 * devices (which to drop is theirs), or the resolver's own findings.
 */
export function fixCandidate(
  finding: Finding,
  scheme: Scheme,
  game: Game,
  plan: Plan,
): FixCandidate | undefined {
  const { control, mode } = finding;
  if (finding.rule === 'missing-required') {
    const action = finding.action;
    if (action === undefined || mode === undefined) return undefined;
    // Every Xbox control in use: the controller's own buttons, or what an Azeron button may send.
    const setup = setupOf(scheme.devices);
    const pad = setup.controller || (setup.hands.length > 0 && scheme.output === 'pad');
    return {
      label: 'Put it on a button',
      run: (s) => putOnButton(s, game, mode, action)?.scheme ?? null,
      select: (s) => putOnButton(s, game, mode, action)?.control,
      cannot: pad
        ? 'Every controller button is in use; clear one first.'
        : 'Every button is in use; clear one first.',
    };
  }
  if (control === undefined) return undefined;
  switch (finding.rule) {
    case 'stick-no-directions':
      return stickCandidate(scheme, game, control, scheme.output);
    case 'stick-not-keyboard': {
      // Only keys settle it, and only keys the game has for that stick's directions.
      const fix = stickCandidate(scheme, game, control, 'keys');
      if (fix === undefined) return undefined;
      return fix.label === 'Give it the movement keys'
        ? fix
        : {
            ...fix,
            run: () => null,
            cannot: `${game.name} has no keys for this stick’s directions.`,
          };
    }
    case 'mixed-input':
      // A stick sending into the other set from the buttons: it follows the buttons.
      return stickCandidate(scheme, game, control, scheme.output);
    case 'action-deleted': {
      const gone = finding.action;
      if (gone === undefined) return undefined;
      return {
        label: control.startsWith('key.') ? 'Take it off the key' : 'Take it off the button',
        run: (s) => changed(s, takeOff(s, control, gone)),
        cannot: BY_HAND,
      };
    }
    case 'hold-on-movement':
      return {
        label: 'Turn off hold to latch',
        run: (s) => changed(s, setLatch(s, control, false)),
        cannot: BY_HAND,
      };
    case 'combat-tap-delayed': {
      // The unit keeps one setting per button for every mode, so the delay reaches them all.
      const slots = game.modes.flatMap((m) =>
        slotsOn(scheme, m.id, control).filter((s) => s.press !== 'tap'),
      );
      const hasLong = slots.some((s) => s.press === 'long');
      const hasDouble = slots.some((s) => s.press === 'double');
      const what =
        hasLong && hasDouble ? 'long press and double tap' : hasLong ? 'long press' : 'double tap';
      return {
        label: `Remove ${what}`,
        run: (s) => changed(s, clearAll(s, slots)),
        cannot: BY_HAND,
      };
    }
    case 'menu-with-combat': {
      if (mode === undefined) return undefined;
      const slots = slotsOn(scheme, mode, control).filter(
        (s) => game.actions.find((a) => a.id === s.action)?.role === 'menu',
      );
      const first = slots[0];
      return {
        label:
          first === undefined
            ? 'Take the menu action off'
            : `Take ${nameOf(game, first.action)} off`,
        run: (s) => changed(s, clearAll(s, slots)),
        cannot: BY_HAND,
      };
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
      const known = inSetup(setupOf(scheme.devices), control) && KNOWN.has(control);
      const sendsNothing = (press: Press): boolean =>
        pin !== undefined ? pin.presses[press] === undefined : known ? press !== 'tap' : true;
      const slots = slotsOn(scheme, mode, control).filter((s) => sendsNothing(s.press));
      return {
        label: 'Take it off the button',
        run: (s) => changed(s, clearAll(s, slots)),
        cannot: BY_HAND,
      };
    }
    default:
      return undefined;
  }
}

/** What a finding offers: a fix that works, a sentence on why there is none, or nothing at all. */
export type Offer = { fix: Fix } | { why: string } | null;

/**
 * THE FIX GATE. A finding offers its fix only when the fix can act, and when re-resolving what it
 * makes no longer has the finding and has no error the scheme didn't have. Otherwise it says why
 * there is none, in one sentence; a finding of a rule with no fix offers nothing.
 */
export function offerFor(finding: Finding, scheme: Scheme, game: Game, plan: Plan): Offer {
  const candidate = fixCandidate(finding, scheme, game, plan);
  if (candidate === undefined) return null;
  const { run, label, select, cannot } = candidate;
  const made = run(scheme);
  if (made === null) return { why: cannot };
  if (!settles(finding, plan, resolve(made, game, BUILT_IN_DEVICES))) return { why: BY_HAND };
  const fix: Fix = { label, apply: (s) => run(s) ?? s, ...(select ? { select } : {}) };
  return { fix };
}

const sameFinding = (a: Finding, b: Finding): boolean =>
  a.rule === b.rule && a.control === b.control && a.action === b.action && a.mode === b.mode;

/** The errors still asking for attention: not kept. */
const openErrors = (plan: Plan): Finding[] =>
  plan.findings.filter((f) => f.severity === 'error' && f.accepted === undefined);

/** Whether `after` no longer has the finding, and has no error `before` didn't. */
export const settles = (finding: Finding, before: Plan, after: Plan): boolean =>
  settlesAll([finding], before, after);

/** Whether `after` has none of the findings, and no error `before` didn't. */
export function settlesAll(findings: readonly Finding[], before: Plan, after: Plan): boolean {
  if (after.findings.some((f) => findings.some((g) => sameFinding(f, g)))) return false;
  const had = openErrors(before);
  return openErrors(after).every((e) => had.some((b) => sameFinding(b, e)));
}

/** The fix a finding offers through the gate, if any. */
export function fixFor(finding: Finding, scheme: Scheme, game: Game, plan: Plan): Fix | undefined {
  const offer = offerFor(finding, scheme, game, plan);
  return offer !== null && 'fix' in offer ? offer.fix : undefined;
}

/**
 * Takes an action the game no longer has off a control, in every mode the scheme has it there (one
 * deleted with its mode included). Only that action's presses: a pad control's other buttons keep
 * what they carry.
 */
export function takeOff(scheme: Scheme, control: ControlId, action: ActionId): Scheme {
  let changed = false;
  const map = Object.fromEntries(
    Object.entries(scheme.map).map(([mode, byControl]) => {
      const presses = own(byControl, control);
      if (presses === undefined || !PRESSES.some((p) => presses[p] === action))
        return [mode, byControl];
      changed = true;
      const kept = Object.fromEntries(Object.entries(presses).filter(([, a]) => a !== action));
      const rest = Object.entries(byControl).filter(([c]) => c !== control);
      return [
        mode,
        Object.fromEntries(Object.keys(kept).length === 0 ? rest : [...rest, [control, kept]]),
      ];
    }),
  );
  return changed ? { ...scheme, map } : scheme;
}
