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
  PAD_CONTROLS,
  stickForOutput,
  stickKeysOf,
  withOwn,
  xboxControllerPreset,
} from '@helmarray/core';
import type { Slot } from './editor-model';
import { assign, clear, isStick, setLatch, setPadControl, shownAction } from './editor-model';

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

/*
 * A KEPT LEDGER KEY. An emptied button keeps the key it was given ("a key once given never moves",
 * 02-architecture.md: the ledger is the resolver's, and the editor never touches it). So putting
 * an action there sends that old key, which may clash (W, which the stick sends for Move forward).
 * The fix doesn't drop the key to make room: such a button is only a worse place, and the gate
 * passes on to the next place that settles.
 */

/** The actions the mode shows on some control. */
const shownIn = (scheme: Scheme, mode: ModeId): Set<ActionId> => {
  const controls = new Set([
    ...Object.keys(own(scheme.map, mode) ?? {}),
    ...Object.keys(scheme.padMap),
  ]);
  return new Set(
    [...controls].flatMap((c) => {
      const id = shownAction(scheme, mode, c)?.id;
      return id === undefined ? [] : [id];
    }),
  );
};

/**
 * Every place an action could be put, in order of preference (`placesFor`), as the scheme each
 * makes and the control it went on: on the tap of an empty control, with the Xbox control THE PAD
 * RULE gives a unit's button; then, with controller output and `signals`, each unit button with
 * each other Xbox control it may send. A place that leaves it not shown there, leaves a unit button
 * sending nothing, or takes another action off the controls it was on (an Xbox control already
 * doing something) isn't one: putting an action on never undoes another.
 */
export function* placesTried(
  scheme: Scheme,
  game: Game,
  mode: ModeId,
  action: ActionId,
  signals = true,
): Generator<{ control: ControlId; scheme: Scheme }> {
  const empty = emptyPlaces(scheme, game, mode, action);
  const before = shownIn(scheme, mode);
  const works = (next: Scheme, control: ControlId) => {
    if (shownAction(next, mode, control)?.id !== action) return false;
    if (isUnit(control) && next.output === 'pad' && padSignalOf(next, control) === undefined)
      return false;
    const after = shownIn(next, mode);
    return [...before].every((id) => after.has(id));
  };
  const placed = new Map<ControlId, Scheme>();
  for (const control of empty) {
    const next = assign(scheme, { mode, control, press: 'tap' }, action, game);
    placed.set(control, next);
    if (works(next, control)) yield { control, scheme: next };
  }
  if (scheme.output !== 'pad' || !signals) return;
  for (const control of empty) {
    const next = placed.get(control);
    if (next === undefined || !isUnit(control)) continue;
    for (const pad of PAD_CONTROLS) {
      if (padSignalOf(next, control) === pad) continue;
      const other = setPadControl(next, control, pad, game);
      if (other !== next && works(other, control)) yield { control, scheme: other };
    }
  }
}

const isUnit = (control: ControlId): boolean =>
  control.startsWith('L.') || control.startsWith('R.');

/** Puts an action on the first place `placesTried` gives, or undefined when there is none. */
export function putOnButton(
  scheme: Scheme,
  game: Game,
  mode: ModeId,
  action: ActionId,
): { control: ControlId; scheme: Scheme } | undefined {
  for (const tried of placesTried(scheme, game, mode, action)) return tried;
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

/**
 * What a stick may become, in order of preference: first what the Azerons' output makes it
 * (`stickForOutput`: the game's movement keys, else the mouse, with keys; its hand's Xbox stick with
 * a controller), then every other: the movement keys, the mouse, its hand's Xbox stick, the other
 * hand's. Each with the button's words. Tuning is kept.
 */
function stickTries(scheme: Scheme, game: Game, control: ControlId, only?: 'keys'): FixTry[] {
  const hand = handOf(control);
  if (hand === undefined) return [];
  const before = own(scheme.behaviour, control)?.stick;
  const tuning: Partial<StickBehaviour> = { ...before };
  delete tuning.mode;
  delete tuning.directions;
  const keys = stickKeysOf(game, hand);
  const options: [StickBehaviour, string][] = [
    [stickForOutput(hand, before, scheme.output, game), ''],
    ...(Object.keys(keys).length > 0
      ? [[{ ...tuning, mode: 'keys', directions: keys }, ''] as [StickBehaviour, string]]
      : []),
    [{ ...tuning, mode: 'mouse' }, ''],
    [{ ...tuning, mode: hand === 'left' ? 'pad-left' : 'pad-right' }, ''],
    [
      { ...tuning, mode: hand === 'left' ? 'pad-right' : 'pad-left' },
      `Use as the ${hand === 'left' ? 'right' : 'left'} controller stick`,
    ],
  ];
  const seen = new Set<string>();
  const out: FixTry[] = [];
  for (const [stick, words] of options) {
    if (only === 'keys' && stick.mode !== 'keys') continue;
    const id = JSON.stringify(stick);
    if (seen.has(id)) continue;
    seen.add(id);
    const label =
      words !== ''
        ? words
        : stick.mode === 'keys'
          ? 'Give it the movement keys'
          : stick.mode === 'mouse'
            ? 'Use it as the mouse'
            : 'Use as controller stick';
    out.push({ label, scheme: withStick(scheme, control, stick) });
  }
  return out;
}

// ---- The fix for each finding: one shape, then one gate ----

/** One way a fix may go: the scheme it makes, its button's words, and the control it put on. */
export interface FixTry {
  scheme: Scheme;
  label: string;
  select?: ControlId;
}

/**
 * A fix, before the gate: the ways it may go on a scheme, in order of preference (one for a fix
 * with no choice; none when it can't act at all), and what the finding says when none settles.
 */
export interface FixCandidate {
  tries: (scheme: Scheme) => Iterable<FixTry>;
  /** Why none settles, worked out only when none does. */
  cannot: (scheme: Scheme) => string;
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

/** Said when no way the fix may go settles the finding without breaking something else. */
const BY_HAND = 'No one click fixes this; change it by hand.';

/** A fix with no choice: one way, when its edit changes anything. */
const one = (label: string, edit: (s: Scheme) => Scheme): FixCandidate => ({
  tries: (s) => {
    const made = edit(s);
    return made === s ? [] : [{ label, scheme: made }];
  },
  cannot: () => BY_HAND,
});

/**
 * The edit that may clear a finding, as a candidate: undefined for a rule with none. A key
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
    return {
      tries: function* (s) {
        for (const tried of placesTried(s, game, mode, action))
          yield { label: 'Put it on a button', scheme: tried.scheme, select: tried.control };
      },
      cannot: (s) => {
        // A free place it could go but that breaks something: not a full device, a clash.
        for (const _free of placesTried(s, game, mode, action, false)) return BY_HAND;
        const setup = setupOf(s.devices);
        const pad = setup.controller || (setup.hands.length > 0 && s.output === 'pad');
        return pad
          ? 'Every controller button is in use; clear one first.'
          : 'Every button is in use; clear one first.';
      },
    };
  }
  if (control === undefined) return undefined;
  switch (finding.rule) {
    case 'stick-no-directions':
    case 'mixed-input':
      // A stick that sends nothing, or into the other set from the buttons: it follows the buttons
      // first, and any other way it may go after.
      if (handOf(control) === undefined) return undefined;
      return { tries: (s) => stickTries(s, game, control), cannot: () => BY_HAND };
    case 'stick-not-keyboard': {
      // Only keys settle it, and only keys the game has for that stick's directions.
      const hand = handOf(control);
      if (hand === undefined) return undefined;
      return {
        tries: (s) => stickTries(s, game, control, 'keys'),
        cannot: () =>
          Object.keys(stickKeysOf(game, hand)).length === 0
            ? `${game.name} has no keys for this stick’s directions.`
            : BY_HAND,
      };
    }
    case 'action-deleted': {
      const gone = finding.action;
      if (gone === undefined) return undefined;
      return one(
        control.startsWith('key.') ? 'Take it off the key' : 'Take it off the button',
        (s) => takeOff(s, control, gone),
      );
    }
    case 'hold-on-movement':
      return one('Turn off hold to latch', (s) => setLatch(s, control, false));
    case 'combat-tap-delayed': {
      // The unit keeps one setting per button for every mode, so the delay reaches them all.
      const slots = game.modes.flatMap((m) =>
        slotsOn(scheme, m.id, control).filter((s) => s.press !== 'tap'),
      );
      const hasLong = slots.some((s) => s.press === 'long');
      const hasDouble = slots.some((s) => s.press === 'double');
      const what =
        hasLong && hasDouble ? 'long press and double tap' : hasLong ? 'long press' : 'double tap';
      return one(`Remove ${what}`, (s) => clearAll(s, slots));
    }
    case 'menu-with-combat': {
      if (mode === undefined) return undefined;
      const slots = slotsOn(scheme, mode, control).filter(
        (s) => game.actions.find((a) => a.id === s.action)?.role === 'menu',
      );
      const first = slots[0];
      return one(
        first === undefined ? 'Take the menu action off' : `Take ${nameOf(game, first.action)} off`,
        (s) => clearAll(s, slots),
      );
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
      return one('Take it off the button', (s) => clearAll(s, slots));
    }
    default:
      return undefined;
  }
}

/** What a finding offers: a fix that works, a sentence on why there is none, or nothing at all. */
export type Offer = { fix: Fix } | { why: string } | null;

/** The first way the fix may go that settles the finding on this scheme, or undefined. */
function firstSettling(
  candidate: FixCandidate,
  finding: Finding,
  scheme: Scheme,
  game: Game,
  plan: Plan,
): FixTry | undefined {
  for (const tried of candidate.tries(scheme)) {
    if (tried.scheme === scheme) continue;
    if (settles(finding, plan, resolve(tried.scheme, game, BUILT_IN_DEVICES))) return tried;
  }
  return undefined;
}

/**
 * THE FIX GATE. A finding offers its fix only when one of the ways it may go, tried in order of
 * preference, settles it: re-resolving what it makes no longer has the finding and has no error the
 * scheme didn't have. The first that does is the fix. When none does, the finding says why, in one
 * sentence; a finding of a rule with no fix offers nothing.
 */
export function offerFor(finding: Finding, scheme: Scheme, game: Game, plan: Plan): Offer {
  const candidate = fixCandidate(finding, scheme, game, plan);
  if (candidate === undefined) return null;
  const chosen = firstSettling(candidate, finding, scheme, game, plan);
  if (chosen === undefined) return { why: candidate.cannot(scheme) };
  // Applied to the scheme it was worked out on, it is that very way; to any other (an edit in
  // between), the gate picks again there.
  const on = (s: Scheme): FixTry | undefined =>
    s === scheme
      ? chosen
      : firstSettling(candidate, finding, s, game, resolve(s, game, BUILT_IN_DEVICES));
  const fix: Fix = {
    label: chosen.label,
    apply: (s) => on(s)?.scheme ?? s,
    ...(chosen.select === undefined ? {} : { select: (s: Scheme) => on(s)?.select }),
  };
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
