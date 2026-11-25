// Where a Library tile leads for a game's data: *Set up* on a game helmArray doesn't know (or one
// with no action and no scheme), *Edit actions* on one it does. Pure.

import type { LibraryEntry } from '../../shared/api';
import type { GameTarget } from './game-model';

/**
 * The game has no data to make a scheme from, and no scheme: the tile says *Set up*. A game with
 * schemes keeps its scheme navigation whatever its action count (its last action deleted, say):
 * *Edit actions* sits beside it, never instead of it.
 */
export const needsSetUp = (entry: LibraryEntry): boolean =>
  entry.gameId === null || (entry.actionCount === 0 && entry.schemes.length === 0);

/**
 * The Game screen for this tile: the game helmArray knows, one read afresh from its file (deleted
 * since it was), or a new one from Steam's entry.
 */
export function gameTarget(entry: LibraryEntry): GameTarget {
  if (entry.gameId !== null) return { kind: 'edit', gameId: entry.gameId };
  const appId = Number(entry.appId);
  const steamAppId = Number.isSafeInteger(appId) && appId > 0 ? { steamAppId: appId } : {};
  if (entry.restores !== undefined)
    return { kind: 'restore', gameId: entry.restores, name: entry.name, ...steamAppId };
  const note = entry.fileNote === undefined ? {} : { note: entry.fileNote };
  return { kind: 'new', name: entry.name, ...steamAppId, ...note };
}
