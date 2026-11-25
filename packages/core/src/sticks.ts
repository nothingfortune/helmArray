// What a unit's stick does for the Azerons' output: one rule, read by the *game's own keys* preset,
// by the editor's "Azerons send: Keys | Controller" and by the fixes for a stick that sends nothing.

import type {
  Game,
  Hand,
  PadControl,
  Scheme,
  StickBehaviour,
  StickDirection,
  StickDirections,
} from './model';
import { STICK_DIRECTIONS } from './model';

const STICK_PADS: Record<Hand, Record<StickDirection, PadControl>> = {
  left: { up: 'LS_UP', down: 'LS_DOWN', left: 'LS_LEFT', right: 'LS_RIGHT' },
  right: { up: 'RS_UP', down: 'RS_DOWN', left: 'RS_LEFT', right: 'RS_RIGHT' },
};

/**
 * The keys a unit's stick sends as keys: for each direction, the key the game ships on the action
 * it ships on that hand's Xbox stick direction (the left stick's up is Move forward, so W). The
 * first such action with a key, in the game's order; a direction with none is left out.
 */
export function stickKeysOf(game: Game, hand: Hand): StickDirections {
  const directions: StickDirections = {};
  for (const direction of STICK_DIRECTIONS) {
    const pad = STICK_PADS[hand][direction];
    const key = game.actions.find((a) => a.native?.pad === pad && a.native.key?.kind === 'key')
      ?.native?.key;
    // keyed-write-ok: the key is a stick direction, one of four names
    if (key !== undefined) directions[direction] = key;
  }
  return directions;
}

/**
 * What a unit's stick does once the Azerons send `output`: its hand's Xbox stick for a controller;
 * for keys, the game's keys for that stick's directions (`stickKeysOf`), or the mouse when it has
 * none for any. The tuning in `before` (dead zone, edge, sensitivity, invert) is kept; its mode and
 * old directions are not.
 */
export function stickForOutput(
  hand: Hand,
  before: StickBehaviour | undefined,
  output: Scheme['output'],
  game: Game,
): StickBehaviour {
  const tuning: Partial<StickBehaviour> = { ...before };
  delete tuning.mode;
  delete tuning.directions;
  if (output === 'pad') return { ...tuning, mode: hand === 'left' ? 'pad-left' : 'pad-right' };
  const directions = stickKeysOf(game, hand);
  return Object.keys(directions).length === 0
    ? { ...tuning, mode: 'mouse' }
    : { ...tuning, mode: 'keys', directions };
}
