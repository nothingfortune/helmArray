// Where a Library tile leads for a game's data: *Set up* on a game helmArray doesn't know (or one
// added and given no action yet), *Edit game* on one it does. Pure.

import type { LibraryEntry } from '../../shared/api';
import type { GameTarget } from './game-model';

/** The game has no data to make a scheme from yet: the tile says *Set up*. */
export const needsSetUp = (entry: LibraryEntry): boolean =>
  entry.gameId === null || entry.actionCount === 0;

/** The Game screen for this tile: the game helmArray knows, or a new one from Steam's entry. */
export function gameTarget(entry: LibraryEntry): GameTarget {
  if (entry.gameId !== null) return { kind: 'edit', gameId: entry.gameId };
  const appId = Number(entry.appId);
  return Number.isSafeInteger(appId) && appId > 0
    ? { kind: 'new', name: entry.name, steamAppId: appId }
    : { kind: 'new', name: entry.name };
}
