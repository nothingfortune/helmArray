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
// PAD DEFAULTS ARE TO BE CONFIRMED BY THE OWNER. No source above states which Xbox button
// Helldivers 2 puts any action on, so `native.pad` is set on no action. (The legacy FPS genre
// file carries generic `xbox:` suggestions; they are not this game's own and disagree with it,
// so they are not used.) Until the owner confirms them against the game's controller screen,
// the *Xbox controller* preset places nothing for this game.

import type { Action, Game, Role, Signal } from '../model';
import type { KeyCode } from '../keys';

const key = (code: KeyCode): Signal => ({ kind: 'key', code });
const mouse = (button: 'left' | 'right'): Signal => ({ kind: 'mouse', button });

function action(id: string, name: string, role: Role, native?: Signal, required = false): Action {
  return {
    id,
    name,
    mode: 'default',
    role,
    required,
    ...(native ? { native: { key: native } } : {}),
  };
}

export const helldivers2: Game = {
  id: 'helldivers2',
  name: 'Helldivers 2',
  steamAppId: 553850,
  modes: [{ id: 'default', name: 'Default' }],
  actions: [
    // Movement
    action('move_forward', 'Move forward', 'movement', key('W'), true),
    action('move_back', 'Move back', 'movement', key('S'), true),
    action('strafe_left', 'Strafe left', 'movement', key('A'), true),
    action('strafe_right', 'Strafe right', 'movement', key('D'), true),
    action('sprint', 'Sprint', 'movement', key('LShift')),
    action('jump', 'Climb / vault', 'movement', key('Space')),
    action('crouch', 'Crouch', 'movement', key('C')),
    action('prone', 'Prone', 'movement', key('Z')),
    action('dive', 'Dive', 'movement', key('LAlt')),
    // Weapons
    action('fire_primary', 'Fire', 'combat', mouse('left'), true),
    action('aim', 'Aim', 'combat', mouse('right')),
    action('reload', 'Reload', 'combat', key('R')),
    action('melee', 'Melee', 'combat', key('F')),
    action('grenade', 'Throw grenade', 'combat', key('G')),
    action('weapon_1', 'Primary', 'combat', key('1')),
    action('weapon_2', 'Secondary', 'combat', key('2')),
    action('weapon_3', 'Support weapon', 'combat', key('3')),
    action('grenade_slot', 'Grenade slot', 'combat', key('4')),
    action('backpack', 'Backpack', 'combat', key('5')),
    action('stim', 'Stim', 'combat', key('V')),
    // Hold it and enter the code with W, A, S and D.
    action('stratagem', 'Stratagem (hold)', 'ability', key('LCtrl'), true),
    action('drop', 'Drop', 'ability', key('X')),
    action('interact', 'Interact', 'ability', key('E')),
    action('ping', 'Ping / comms wheel', 'ability', key('Q')),
    action('push_to_talk', 'Push to talk', 'ability', key('Caps')),
    // Menus
    action('map', 'Map', 'menu', key('Tab')),
    action('emote', 'Emote', 'menu', key('B')),
    action('menu_main', 'Menu', 'menu', key('Esc')),
  ],
};
