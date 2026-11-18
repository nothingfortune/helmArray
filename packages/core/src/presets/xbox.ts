import type { ActionId, ControlId, Game, ModeId, PadControl, Press, Scheme } from '../model';

/**
 * PLACEHOLDER. Which Xbox control each Azeron button sends in the *Xbox controller* preset.
 * The owner will lay the real map out in the app's editor; until then this is the partial map
 * the canvas's editor board draws (index and middle keys, d-pad, stick on the left unit), plus
 * the right stick, both stick presses and Back/Start on the thumb keys so every Xbox control a
 * game needs to start is reachable. Nothing here is tested against a game.
 */
export const PLACEHOLDER_PAD_MAP: Readonly<Record<ControlId, PadControl>> = {
  'L.index_1': 'RB',
  'L.index_2': 'RT',
  'L.index_3': 'A',
  'L.index_4': 'B',
  'L.middle_1': 'X',
  'L.middle_2': 'Y',
  'L.middle_3': 'LB',
  'L.middle_4': 'LT',
  'L.dpad_up': 'DPAD_UP',
  'L.dpad_down': 'DPAD_DOWN',
  'L.dpad_left': 'DPAD_LEFT',
  'L.dpad_right': 'DPAD_RIGHT',
  'L.stick_press': 'LS',
  'L.thumb_aux_upper': 'BACK',
  'R.stick_press': 'RS',
  'R.thumb_aux_upper': 'START',
};

/**
 * The *Xbox controller* preset: the two Azerons as one pad. Each button sends its pad control,
 * the left stick is the Xbox left stick and the right stick the right one, and every action
 * the game ships on a pad control lands on the button that sends it, in its own mode.
 */
export function xboxControllerPreset(
  game: Game,
  padMap: Readonly<Record<ControlId, PadControl>> = PLACEHOLDER_PAD_MAP,
): Scheme {
  const map: Record<ModeId, Record<ControlId, Partial<Record<Press, ActionId>>>> = {};
  for (const mode of game.modes) map[mode.id] = {};
  for (const action of game.actions) {
    const pad = action.native?.pad;
    const byControl = map[action.mode];
    if (pad === undefined || byControl === undefined) continue;
    for (const [control, sends] of Object.entries(padMap)) {
      if (sends !== pad || byControl[control]?.tap !== undefined) continue;
      byControl[control] = { tap: action.id };
    }
  }
  return {
    id: `${game.id}-xbox`,
    gameId: game.id,
    name: 'Xbox controller',
    output: 'pad',
    padMap: { ...padMap },
    map,
    behaviour: {
      'L.stick': { stick: { mode: 'pad-left' } },
      'R.stick': { stick: { mode: 'pad-right' } },
    },
    ledger: {},
    accepted: [],
  };
}
