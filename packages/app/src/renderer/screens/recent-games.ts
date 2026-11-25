// The recent games in the Editor's bar (J3: another game in one click). Pure.

import type { LibraryEntry } from '../../shared/api';
import { chosenScheme } from './libraryView';

/** A game to open in one click: its name and the scheme a click on its Library tile opens. */
export interface RecentGame {
  gameId: string;
  name: string;
  schemeId: string;
}

/** How many the bar shows: a few, so it still fits at the window's narrowest. */
export const RECENT_LIMIT = 3;

/**
 * The games with a scheme, other than the one open: the one applied last first, then the others
 * applied, by when, then the rest by name. Each opens the scheme its Library tile would (its
 * active one, else the first), so the click does what the tile does.
 */
export function recentGames(
  entries: readonly LibraryEntry[],
  openGameId: string,
  limit = RECENT_LIMIT,
): RecentGame[] {
  const ranked = entries
    .flatMap((entry) => {
      const scheme = chosenScheme(entry);
      if (entry.gameId === null || entry.gameId === openGameId || scheme === null) return [];
      return [{ entry, gameId: entry.gameId, schemeId: scheme.id }];
    })
    .sort(
      (a, b) =>
        (b.entry.applied?.at ?? -1) - (a.entry.applied?.at ?? -1) ||
        a.entry.name.localeCompare(b.entry.name),
    );
  return ranked
    .slice(0, limit)
    .map(({ entry, gameId, schemeId }) => ({ gameId, name: entry.name, schemeId }));
}
