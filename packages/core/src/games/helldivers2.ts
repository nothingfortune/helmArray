// Helldivers 2 (Steam app 553850), the built-in definition.
//
// Sources, all from the legacy repo (github.com/nothingfortune/relayMatrix-legacy) and this repo:
// - games/FPS/hellDivers/actions.yaml: the action names and the game's default keys, which
//   its header says come from Arrowhead's own list (content.thehelldiversgame.com/help/inputs.md)
//   and which the owner's settings file has not changed (read 2026-10-21).
// - games/FPS/hellDivers/README.md and game.yaml: the game's key file is not written.
// - reference/legacy/playtests/hellDivers.md: the stratagem input (hold the key, enter the
//   code with W, A, S and D) and the Windows shortcut hazards of Shift, Alt and Ctrl.
//
// PAD DEFAULTS (`native.pad`). Source of every one of them, read 2026-11-19:
//   https://content.thehelldiversgame.com/help/inputs.md
// Arrowhead's own page on the input settings file. It lists the game's default bindings per
// device, and its `PadXBOX` rows are the Xbox controller defaults. The game uses one layout on
// Xbox and PlayStation (Cross=A, Circle=B, Square=X, Triangle=Y, L1=LB, R1=RB, L2=LT, R2=RT,
// L3/R3, Touchpad=View); where a second source below gives only the PlayStation button, the
// translation to the Xbox button is ours.
//
// A second source checked each default it names (PS5 buttons, translated):
//   https://www.magicgameworld.com/helldivers-2-playstation-5-controls/   (dated 2023)
// UNCONFIRMED below means that second source does not give the binding, so Arrowhead's page is
// the only source. The two pages disagree on one binding, marked "disagree".
//
//   Action           Xbox         Trigger in the game   Status
//   Move (4)         left stick   stick direction       confirmed
//   Sprint           LS           press                 confirmed
//   Climb / vault    A            hold (long)           confirmed
//   Interact         A            press                 confirmed
//   Crouch           B            tap                   confirmed
//   Prone            B            long press            confirmed
//   Dive             B            double tap            UNCONFIRMED, disagree: the second
//                                                       source says tap L3
//   Fire             RT           hold                  confirmed
//   Aim              LT           hold                  confirmed
//   Reload           X            tap                   confirmed
//   Melee            RS           press                 confirmed
//   Grenade slot     D-pad right  press                 UNCONFIRMED (second source: "D-pad")
//   Backpack         D-pad down   tap                   UNCONFIRMED (second source: "D-pad")
//   Stim             D-pad up     press                 UNCONFIRMED (second source: "D-pad")
//   Drop             D-pad down   long press            UNCONFIRMED (second source: "D-pad")
//   Stratagem (hold) LB           hold                  confirmed
//   Ping / comms     RB           tap spots, long opens confirmed
//   Map              BACK (View)  tap                   confirmed
//   Emote            D-pad left   long press            confirmed
//   Menu             START        press                 UNCONFIRMED: Arrowhead's `ToggleMenu`;
//                                                       its page says Esc is a separate bind of
//                                                       the same menu "for technical reasons"
//
// `native.pad` is a control only: the model has no trigger. Where the game tells actions apart
// by trigger on one control (A, B, D-pad down), the control is still the right default, and the
// Xbox preset gives it to the first action listed (see Interact, listed ahead of Climb / vault,
// and Crouch ahead of Prone and Dive). The sticks fit as the four left-stick directions, which
// the *Xbox controller* preset's `pad-left` stick sends. Holds and double taps are the game's to
// read: the button just sends the control.
//
// No source gives a pad default for: Quick grenade (G), Primary, Secondary, Support weapon (the
// pad cycles equipment with Y instead) or Push to talk (keyboard only in Arrowhead's file). They
// have no `native.pad`.

import type { Action, Game, PadControl, Role, Signal } from '../model';
import type { KeyCode } from '../keys';

const key = (code: KeyCode): Signal => ({ kind: 'key', code });
const mouse = (button: 'left' | 'right'): Signal => ({ kind: 'mouse', button });

function action(
  id: string,
  name: string,
  role: Role,
  native?: Signal,
  pad?: PadControl,
  required = false,
): Action {
  return {
    id,
    name,
    mode: 'default',
    role,
    required,
    ...(native || pad
      ? { native: { ...(native ? { key: native } : {}), ...(pad ? { pad } : {}) } }
      : {}),
  };
}

export const helldivers2: Game = {
  id: 'helldivers2',
  name: 'Helldivers 2',
  steamAppId: 553850,
  modes: [{ id: 'default', name: 'Default' }],
  actions: [
    // Interact leads, ahead of Climb / vault: both are on A, and the Xbox preset gives a control
    // to the first action listed on it.
    action('interact', 'Interact', 'ability', key('E'), 'A'),
    // Movement
    action('move_forward', 'Move forward', 'movement', key('W'), 'LS_UP', true),
    action('move_back', 'Move back', 'movement', key('S'), 'LS_DOWN', true),
    action('strafe_left', 'Strafe left', 'movement', key('A'), 'LS_LEFT', true),
    action('strafe_right', 'Strafe right', 'movement', key('D'), 'LS_RIGHT', true),
    action('sprint', 'Sprint', 'movement', key('LShift'), 'LS'),
    action('jump', 'Climb / vault', 'movement', key('Space'), 'A'),
    action('crouch', 'Crouch', 'movement', key('C'), 'B'),
    action('prone', 'Prone', 'movement', key('Z'), 'B'),
    action('dive', 'Dive', 'movement', key('LAlt'), 'B'),
    // Weapons
    action('fire_primary', 'Fire', 'combat', mouse('left'), 'RT', true),
    action('aim', 'Aim', 'combat', mouse('right'), 'LT'),
    action('reload', 'Reload', 'combat', key('R'), 'X'),
    action('melee', 'Melee', 'combat', key('F'), 'RS'),
    action('grenade', 'Throw grenade', 'combat', key('G')),
    action('weapon_1', 'Primary', 'combat', key('1')),
    action('weapon_2', 'Secondary', 'combat', key('2')),
    action('weapon_3', 'Support weapon', 'combat', key('3')),
    action('grenade_slot', 'Grenade slot', 'combat', key('4'), 'DPAD_RIGHT'),
    action('backpack', 'Backpack', 'combat', key('5'), 'DPAD_DOWN'),
    action('stim', 'Stim', 'combat', key('V'), 'DPAD_UP'),
    // Hold it and enter the code with W, A, S and D (on a pad, the D-pad).
    action('stratagem', 'Stratagem (hold)', 'ability', key('LCtrl'), 'LB', true),
    action('drop', 'Drop', 'ability', key('X'), 'DPAD_DOWN'),
    action('ping', 'Ping / comms wheel', 'ability', key('Q'), 'RB'),
    action('push_to_talk', 'Push to talk', 'ability', key('Caps')),
    // Menus
    action('map', 'Map', 'menu', key('Tab'), 'BACK'),
    action('emote', 'Emote', 'menu', key('B'), 'DPAD_LEFT'),
    action('menu_main', 'Menu', 'menu', key('Esc'), 'START'),
  ],
};
