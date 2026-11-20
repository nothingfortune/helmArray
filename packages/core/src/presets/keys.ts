import { clone } from '../clone';
import type { Game, Scheme } from '../model';
import { AZERONS_ONLY } from '../model';

/**
 * The *game's own keys* preset: key output on the keys the game already has, so its file is
 * never touched. It starts with no button carrying an action; the player places them, and each
 * button sends the action's own key (or a free key and a bind sheet row when it can't).
 */
export function gameKeysPreset(game: Game): Scheme {
  // fromEntries, not map[mode.id] = {}: a mode named `__proto__` must be an entry, not a prototype.
  const map: Scheme['map'] = Object.fromEntries(game.modes.map((mode) => [mode.id, {}]));
  return {
    id: `${game.id}-own-keys`,
    gameId: game.id,
    name: "Game's own keys",
    devices: { ...AZERONS_ONLY },
    output: 'keys',
    padMap: {},
    writeGameFile: false,
    map,
    behaviour: {},
    ledger: {},
    accepted: [],
  };
}

/**
 * *Copy a scheme*: everything, the ledger included, so the copy sends the same keys and the
 * game's file needs no change to play it.
 */
export function copyScheme(scheme: Scheme, id: string, name: string): Scheme {
  return { ...clone(scheme), id, name };
}
