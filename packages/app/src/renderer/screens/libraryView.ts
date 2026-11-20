// What the Library shows, worked out from the entries the main process lists. Pure.

import type { AppState, LibraryEntry, LibrarySchemeRef, Preset } from '../../shared/api';

export type StatusTone = 'current' | 'plain' | 'unsupported';

export interface StatusLine {
  text: string;
  tone: StatusTone;
}

/**
 * The scheme the game really has active, or null. What the status line and the card say; never
 * the fallback below, which would show a scheme as picked when none is.
 */
export function activeScheme(entry: LibraryEntry): LibrarySchemeRef | null {
  return entry.schemes.find((s) => s.id === entry.activeSchemeId) ?? null;
}

/**
 * The scheme a click on the game opens: its active one, else the first by name. Only for what
 * a click opens; it is not what is active.
 */
export function chosenScheme(entry: LibraryEntry): LibrarySchemeRef | null {
  return entry.schemes.find((s) => s.id === entry.activeSchemeId) ?? entry.schemes[0] ?? null;
}

/**
 * One line under a cover. It says only what is known: nothing has been applied to the units
 * yet, so it never says a game is ready or on them, only which scheme it has active and which
 * game is the current one. A game with schemes but none active says so rather than naming one.
 */
export function statusLine(
  entry: LibraryEntry,
  state: Pick<AppState, 'activeGameId'> | null,
): StatusLine {
  if (entry.gameId === null) return { text: 'Not supported yet', tone: 'unsupported' };
  const current = state?.activeGameId === entry.gameId;
  const count = entry.schemes.length;
  if (count === 0) return { text: 'Not set up', tone: 'plain' };
  const scheme = activeScheme(entry);
  if (scheme === null) {
    return current
      ? { text: 'Current · No scheme picked', tone: 'current' }
      : { text: count === 1 ? '1 scheme' : `${count} schemes`, tone: 'plain' };
  }
  const text = `${scheme.name}${count > 1 ? ` · ${count} schemes` : ''}`;
  return current ? { text: `Current · ${text}`, tone: 'current' } : { text, tone: 'plain' };
}

/** What to start a new scheme from. "Game's own keys" only for a game that has its own keys. */
export function defaultChoices(entry: LibraryEntry): { preset: Preset; label: string }[] {
  const choices: { preset: Preset; label: string }[] = [
    { preset: 'xbox', label: 'Xbox controller' },
  ];
  if (entry.nativeKeys) choices.push({ preset: 'keys', label: "Game's own keys" });
  return choices;
}

/** The games whose name holds what was typed, in any case. An empty search keeps them all. */
export function filterEntries(entries: readonly LibraryEntry[], query: string): LibraryEntry[] {
  const wanted = query.trim().toLowerCase();
  return wanted === ''
    ? [...entries]
    : entries.filter((e) => e.name.toLowerCase().includes(wanted));
}

/** The line beside "Games". */
export function summary(entries: readonly LibraryEntry[]): string {
  const withScheme = entries.filter((e) => e.schemes.length > 0).length;
  return `From Steam · ${withScheme} with a scheme`;
}

export interface CurrentCard {
  entry: LibraryEntry;
  /** The game's active scheme, or null when it has none. */
  scheme: LibrarySchemeRef | null;
  /** The line under the title: what the scheme sends, or what to do next. */
  detail: string;
}

/** The "On your Azerons now" card: the active game and scheme, or null when there is no game. */
export function currentCard(
  entries: readonly LibraryEntry[],
  state: Pick<AppState, 'activeGameId'> | null,
): CurrentCard | null {
  const gameId = state?.activeGameId ?? null;
  if (gameId === null) return null;
  const entry = entries.find((e) => e.gameId === gameId);
  if (!entry) return null;
  // The active scheme only: with none picked the card says so, whatever a click would open.
  const scheme = activeScheme(entry);
  const detail =
    scheme === null ? 'No scheme picked' : scheme.output === 'pad' ? 'Controller buttons' : 'Keys';
  return { entry, scheme, detail };
}
