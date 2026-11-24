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
 * the rest in device order.
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
  return [...new Set([...homes, ...REST_ORDER, ...UNIT_BUTTONS])];
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
function stickFix(
  scheme: Scheme,
  game: Game,
  control: ControlId,
  output: Scheme['output'],
): Fix | undefined {
  const hand = handOf(control);
  if (hand === undefined) return undefined;
  const next = stickForOutput(hand, own(scheme.behaviour, control)?.stick, output, game);
  const label =
    next.mode === 'keys'
      ? 'Give it the movement keys'
      : next.mode === 'mouse'
        ? 'Use it as the mouse'
        : 'Use as controller stick';
  return { label, apply: (s) => withStick(s, control, next) };
}

// ---- The fix for each finding ----

/**
 * The one edit that clears a finding, when one clear edit does. A key collision has none: which of
 * two actions should give way is the player's call. Nor has a mix of devices (which to drop is
 * theirs), or the resolver's own findings.
 */
export function fixFor(finding: Finding, scheme: Scheme, game: Game, plan: Plan): Fix | undefined {
  const { control, mode } = finding;
  if (finding.rule === 'missing-required') {
    const action = finding.action;
    if (action === undefined || mode === undefined) return undefined;
    if (emptyPlaces(scheme, game, mode, action).length === 0) return undefined;
    return {
      label: 'Put it on a button',
      apply: (s) => putOnButton(s, game, mode, action)?.scheme ?? s,
      select: (s) => putOnButton(s, game, mode, action)?.control,
    };
  }
  if (control === undefined) return undefined;
  switch (finding.rule) {
    case 'stick-no-directions':
      return stickFix(scheme, game, control, scheme.output);
    case 'stick-not-keyboard': {
      // Only keys settle it, and only keys the game has for that stick's directions.
      const fix = stickFix(scheme, game, control, 'keys');
      return fix?.label === 'Give it the movement keys' ? fix : undefined;
    }
    case 'mixed-input':
      // A stick sending into the other set from the buttons: it follows the buttons.
      return stickFix(scheme, game, control, scheme.output);
    case 'action-deleted': {
      const gone = finding.action;
      if (gone === undefined) return undefined;
      return {
        label: control.startsWith('key.') ? 'Take it off the key' : 'Take it off the button',
        apply: (s) => takeOff(s, control, gone),
      };
    }
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
      const known = inSetup(setupOf(scheme.devices), control) && KNOWN.has(control);
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
