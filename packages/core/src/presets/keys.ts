import { clone } from '../clone';
import { CYBORG2_LEFT, CYBORG2_RIGHT } from '../devices/cyborg2';
import type { ActionId, ControlId, Game, ModeId, Press, Scheme, Signal } from '../model';
import { AZERONS_ONLY } from '../model';
import { own } from '../own';
import { signalId } from '../signal';
import { stickForOutput } from '../sticks';
import { xboxControllerPreset } from './xbox';

/**
 * A key-output scheme for the game with nothing placed: both Azerons, no button carrying an action,
 * no stick set. The *game's own keys* preset starts from it, and so do tests that place their own.
 */
export function blankKeysScheme(game: Game): Scheme {
  // fromEntries, not map[mode.id] = {}: a mode named `__proto__` must be an entry, not a prototype.
  const map: Scheme['map'] = Object.fromEntries(game.modes.map((mode) => [mode.id, {}]));
  return {
    id: `${game.id}-own-keys`,
    gameId: game.id,
    name: "Game's own keys",
    devices: { ...AZERONS_ONLY },
    output: 'keys',
    padMap: {},
    // A game whose file helmArray writes gets its bindings there, not on a bind sheet.
    writeGameFile: game.file !== undefined,
    map,
    behaviour: {},
    ledger: {},
    accepted: [],
    keyLabels: {},
  };
}

/**
 * Where the actions with no home go, in order: the right unit's index, middle and ring keys of
 * rows 1 to 4 (the left hand is on the stick, and these are the strong fingers' keys), the left
 * unit's ring keys, both pinkies, the fifth row, then the thumbs and the side keys. A position the
 * *Xbox controller* preset uses may be in it: one already taken is passed over.
 */
export const REST_ORDER: readonly ControlId[] = [
  ...['index', 'middle', 'ring'].flatMap((f) => [1, 2, 3, 4].map((r) => `R.${f}_${r}`)),
  ...[1, 2, 3, 4].map((r) => `L.ring_${r}`),
  ...[1, 2, 3, 4].map((r) => `R.pinky_${r}`),
  ...[1, 2, 3, 4].map((r) => `L.pinky_${r}`),
  ...['index', 'middle', 'ring', 'pinky'].flatMap((f) => [`R.${f}_5`, `L.${f}_5`]),
  ...['dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'dpad_press'].map((p) => `R.${p}`),
  'R.thumb_aux_lower',
  'L.thumb_aux_lower',
  'L.dpad_press',
  'L.index_side',
  'R.index_side',
  'L.pinky_side',
  'R.pinky_side',
];

/** Every button of the two units (not the sticks). */
const BUTTONS: ReadonlySet<ControlId> = new Set(
  [CYBORG2_LEFT, CYBORG2_RIGHT].flatMap((unit) =>
    unit.positions
      .filter((p) => p.name !== 'stick')
      .map((p) => `${unit.hand === 'left' ? 'L' : 'R'}.${p.name}`),
  ),
);

/*
 * GAME'S OWN KEYS: THE LAYOUT RULE.
 *
 * The Azerons send keys, each button the key the game ships its action on, so the game needs no
 * change and its file is never written. Taps only: a long press or a double tap delays the tap
 * (the combat-tap-delayed check), so the preset never makes one.
 *
 * 1. The sticks. Each unit's stick sends the keys the game ships for its Xbox stick's directions
 *    (`stickForOutput`, the same rule as switching "Azerons send" to Keys): Helldivers 2's left
 *    stick sends W, S, A and D. A stick the game has no keys for moves the mouse.
 * 2. An action a stick sends its key for is on the stick, never on a button too.
 * 3. An action the *Xbox controller* preset puts on a button (the button sending the Xbox control
 *    the game ships it on) goes on that same button: Reload where that preset sends X, Fire where
 *    it sends RT. One layout to learn, whichever the Azerons send. Where the game ships several
 *    actions on one control, that preset gives it to the first (Interact before Climb / vault on
 *    A); the others go by rule 4.
 * 4. Every other action with a key goes on the next button of `REST_ORDER` free in its mode:
 *    required actions first, then in the game's order.
 * 5. A button sends one key in every mode (one signal per control). So a key a button already
 *    sends, for an action of another mode, goes on that same button; a button takes another mode's
 *    action only if it ships on the same key; and a key is on one button only.
 * 6. Left off, to place by hand from the editor's list: an action with no key (nothing of the
 *    game's own to send), one shipped on a scroll (a unit sends a scroll only on a tap it was seen
 *    to), one whose key another action of its mode already has on a button, and any left when
 *    the buttons run out.
 */

/** The *game's own keys* preset: the game's actions on the Azerons, on its own keys (above). */
export function gameKeysPreset(game: Game): Scheme {
  const base = blankKeysScheme(game);
  const left = stickForOutput('left', undefined, 'keys', game);
  const right = stickForOutput('right', undefined, 'keys', game);
  // Rule 2: the keys the sticks send.
  const onStick = new Set(
    [...Object.values(left.directions ?? {}), ...Object.values(right.directions ?? {})].map(
      signalId,
    ),
  );
  const xbox = xboxControllerPreset(game).map;

  // Rule 5's bookkeeping: what each button sends, and which button sends each key.
  const sends = new Map<ControlId, string>();
  const sentBy = new Map<string, ControlId>();
  const modes = new Map<ModeId, Map<ControlId, Partial<Record<Press, ActionId>>>>(
    game.modes.map((m) => [m.id, new Map()]),
  );
  const keys = new Map<ActionId, string>();
  /** Each key by its id, as the game ships it. */
  const signalOf = new Map<string, Signal>();
  const fits = (control: ControlId, mode: ModeId, key: string): boolean =>
    BUTTONS.has(control) &&
    modes.get(mode)?.has(control) === false &&
    (sends.get(control) ?? key) === key &&
    (sentBy.get(key) ?? control) === control;
  const put = (control: ControlId, mode: ModeId, action: ActionId, key: string) => {
    modes.get(mode)?.set(control, { tap: action });
    sends.set(control, key);
    sentBy.set(key, control);
  };
  /** An action of the mode is already on a button sending this key. */
  const keyUsedIn = (mode: ModeId, key: string): boolean =>
    [...(modes.get(mode)?.values() ?? [])].some(
      (presses) => presses.tap !== undefined && keys.get(presses.tap) === key,
    );

  const sendable = (signal: Signal | undefined): signal is Signal =>
    signal !== undefined && (signal.kind === 'key' || signal.kind === 'mouse');
  const candidates = game.actions.filter((a) => {
    const key = a.native?.key;
    if (!modes.has(a.mode) || !sendable(key) || onStick.has(signalId(key))) return false;
    keys.set(a.id, signalId(key));
    signalOf.set(signalId(key), key);
    return true;
  });

  // Rule 3, in the game's order.
  const rest: typeof candidates = [];
  for (const action of candidates) {
    const key = keys.get(action.id) ?? '';
    const home = Object.entries(own(xbox, action.mode) ?? {}).find(
      ([, presses]) => presses.tap === action.id,
    )?.[0];
    if (home !== undefined && fits(home, action.mode, key) && !keyUsedIn(action.mode, key))
      put(home, action.mode, action.id, key);
    else rest.push(action);
  }
  // Rule 4, with rule 5 first: required first, then the game's order.
  for (const action of [...rest.filter((a) => a.required), ...rest.filter((a) => !a.required)]) {
    const key = keys.get(action.id) ?? '';
    if (keyUsedIn(action.mode, key)) continue;
    const already = sentBy.get(key);
    const target =
      already === undefined
        ? REST_ORDER.find((control) => fits(control, action.mode, key))
        : fits(already, action.mode, key)
          ? already
          : undefined;
    if (target !== undefined) put(target, action.mode, action.id, key);
  }

  // fromEntries defines own properties, so a mode named `__proto__` is kept as itself.
  const map = Object.fromEntries(
    [...modes].map(([mode, byControl]) => [mode, Object.fromEntries(byControl)]),
  );
  // With the game's file written, a button carrying nothing in the ledger is dealt a key from the
  // pool. Each key placed here is the game's own, so it goes in the ledger: the units send what
  // the game ships either way, and the file keeps it.
  const ledger: Scheme['ledger'] = base.writeGameFile
    ? Object.fromEntries(
        [...sends].flatMap(([control, key]) => {
          const signal = signalOf.get(key);
          // Stryker disable next-line ConditionalExpression: every key a button sends was put in signalOf with its signal, so one is always found
          return signal === undefined ? [] : [[control, { tap: signal }]];
        }),
      )
    : {};
  return {
    ...base,
    map,
    behaviour: { 'L.stick': { stick: left }, 'R.stick': { stick: right } },
    ledger,
  };
}

/**
 * *Copy a scheme*: everything, the ledger included, so the copy sends the same keys and the
 * game's file needs no change to play it.
 */
export function copyScheme(scheme: Scheme, id: string, name: string): Scheme {
  return { ...clone(scheme), id, name };
}
