// A scheme made before its game had a file format (made from a preset, or typed in, before the
// game's own file was first read), once a read gives the game one. The presets turn
// `writeGameFile` on only for a game that has a format, so such a scheme would keep its bindings on
// the bind sheet for good: the read turns it on (the store's `saveFileRead`, with the read).
//
// What it sends stays what it sends now. With the game's file written, a button of key output with
// no key in the ledger is dealt the next free key from the pool rather than the game's own (the
// resolver's `dealKeys`), so the keys it deals now go into the ledger first, as the *game's own
// keys* preset does for a game that has a file: a key once given never moves. Pure.

import { clone } from '../clone';
import type { Device, Game, Scheme } from '../model';
import { resolve } from '../resolve';

/**
 * The scheme writing its game's file, sending what it sends now. The scheme itself when it writes
 * the file already, or the game has no format.
 */
export function writingFile(scheme: Scheme, game: Game, devices: readonly Device[]): Scheme {
  if (scheme.writeGameFile || game.file === undefined) return scheme;
  const ledger =
    scheme.output === 'keys' ? resolve(scheme, game, devices).ledger : clone(scheme.ledger);
  return { ...clone(scheme), writeGameFile: true, ledger };
}
