// What the Library shows, worked out from the entries the main process lists. Pure.

import type { AppState, LibraryEntry, LibrarySchemeRef, Preset } from '../../shared/api';

/**
 * The dot's colour: amber for the game on the units now, green for a game ready as applied,
 * yellow for one changed since, grey otherwise.
 */
export type StatusTone = 'units' | 'ok' | 'warning' | 'plain' | 'unsupported';

export interface StatusLine {
  text: string;
  tone: StatusTone;
}

type SetupRef = Pick<LibrarySchemeRef, 'output' | 'devices'>;

/**
 * What a setup plays with, in the canvas's few words: "Controller" or "Keys" for both Azerons (what
 * they send), "Left Azeron + mouse", and for a setup with no Azeron its devices.
 */
export function setupWords(scheme: SetupRef): string {
  const { devices } = scheme;
  if (devices.azerons === 'both') return scheme.output === 'pad' ? 'Controller' : 'Keys';
  if (devices.azerons === 'left') return 'Left Azeron + mouse';
  const keyboard = devices.keyboard ? (devices.mouse ? 'Keyboard and mouse' : 'Keyboard') : null;
  if (keyboard !== null && devices.controller) return `${keyboard} + controller`;
  if (keyboard !== null) return keyboard;
  if (devices.controller) return devices.mouse ? 'Mouse + controller' : 'Xbox controller';
  return devices.mouse ? 'Mouse' : 'No devices';
}

/**
 * The scheme active for this game, or null. Never the fallback below, which would show a scheme
 * as picked when none is.
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

/** The scheme the game holds (applied to it last), while it is still one of the game's. */
export function appliedScheme(entry: LibraryEntry): LibrarySchemeRef | null {
  return entry.schemes.find((s) => s.id === entry.applied?.schemeId) ?? null;
}

/** A setup in a status line: its name when the game has several (names tell them apart). */
const setupLabel = (entry: LibraryEntry, scheme: LibrarySchemeRef): string =>
  entry.schemes.length > 1 ? scheme.name : setupWords(scheme);

const changesWord = (n: number) => (n === 1 ? '1 change' : `${n} changes`);

/** The schemes the units hold by their record and don't read as differing: for "On the units". */
export function heldSchemes(state: Pick<AppState, 'onUnits'> | null): Set<string> {
  return new Set(
    [state?.onUnits.left, state?.onUnits.right].flatMap((h) =>
      h === null || h === undefined || h.check === 'differs' ? [] : [h.schemeId],
    ),
  );
}

/**
 * One line under a cover, in the canvas's words, about the setup the game holds (its applied
 * plan): "On the units" when a unit holds that very setup by its own record (`onUnits`, from
 * `heldSchemes`), "Ready" for one applied and unchanged since, "2 changes" for one edited since. A
 * game never applied says which setup is picked, not applied yet.
 */
export function statusLine(entry: LibraryEntry, onUnits: ReadonlySet<string>): StatusLine {
  if (entry.gameId === null) return { text: 'Not supported yet', tone: 'unsupported' };
  const count = entry.schemes.length;
  // "Set up" is the button that adds a game's data: a game with data and no scheme is not "not
  // set up", it has no scheme yet.
  if (count === 0) {
    return {
      text: entry.shipsDefaults ? 'Defaults found · no scheme yet' : 'No scheme yet',
      tone: 'plain',
    };
  }
  const applied = appliedScheme(entry);
  if (applied !== null && entry.applied !== null) {
    const label = setupLabel(entry, applied);
    if (entry.applied.changes > 0)
      return { text: `${changesWord(entry.applied.changes)} · ${label}`, tone: 'warning' };
    if (onUnits.has(applied.id)) return { text: `On the units · ${label}`, tone: 'units' };
    return { text: `Ready · ${label}`, tone: 'ok' };
  }
  const picked = activeScheme(entry);
  if (picked !== null) return { text: `Not applied · ${setupLabel(entry, picked)}`, tone: 'plain' };
  return { text: count === 1 ? '1 scheme' : `${count} schemes`, tone: 'plain' };
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

/**
 * The line beside "Games": where they come from and how many have a scheme. "From Steam" only
 * when Steam lists every one of them; otherwise how many there are.
 */
export function summary(entries: readonly LibraryEntry[]): string {
  const withScheme = entries.filter((e) => e.schemes.length > 0).length;
  if (entries.length > 0 && entries.every((e) => e.inSteam)) {
    return `From Steam · ${withScheme} with a scheme`;
  }
  const games = entries.length === 1 ? '1 game' : `${entries.length} games`;
  return `${games} · ${withScheme} with a scheme`;
}

export interface CurrentCard {
  entry: LibraryEntry;
  /** The scheme shown: the one applied last, else the game's active one; null when neither. */
  scheme: LibrarySchemeRef | null;
  /** The title: the game and the scheme's name (as applied, should the scheme be gone since). */
  title: string;
  /** The shown scheme is what was applied to the units (not merely the one picked). */
  applied: boolean;
  /** The line under the title: whether it is applied and what it sends, or what to do next. */
  detail: string;
  /** The scheme each unit was last written with, by id; null for a unit never written. */
  held: { left: string | null; right: string | null };
}

type HoldsState = Pick<AppState, 'activeGameId' | 'onUnits'>;

const HAND_WORD = { left: 'Left unit', right: 'Right unit' } as const;

/**
 * The "On your Azerons now" card, from the units' own record: each unit's last write (state
 * `onUnits`), never a scheme's current fields, which may have been edited since. It shows the
 * latest of the two writes; when the other unit holds another scheme (the right one, after a left
 * Azeron + mouse apply), the line says so, and a unit read as running something else says that.
 * With no unit ever written it is the active game's active scheme, worded as not applied yet. Null
 * when there is neither.
 */
export function currentCard(
  entries: readonly LibraryEntry[],
  state: HoldsState | null,
): CurrentCard | null {
  const holds = (['left', 'right'] as const).flatMap((hand) => {
    const h = state?.onUnits[hand] ?? null;
    return h === null ? [] : [{ hand, ...h }];
  });
  const held = {
    left: state?.onUnits.left?.schemeId ?? null,
    right: state?.onUnits.right?.schemeId ?? null,
  };
  const latest = holds.reduce<(typeof holds)[number] | null>(
    (best, h) => (best === null || h.at > best.at ? h : best),
    null,
  );
  const named = (h: (typeof holds)[number]) => {
    const entry = entries.find((e) => e.gameId === h.gameId);
    const scheme = entry?.schemes.find((s) => s.id === h.schemeId) ?? null;
    return { entry, scheme, title: `${entry?.name ?? 'A game'} · ${scheme?.name ?? h.schemeName}` };
  };
  if (latest !== null) {
    const shown = named(latest);
    const notes = [`Applied · ${setupWords(latest)}`];
    // The same count as the tile and the pill: the scheme the units hold, edited since.
    const since = shown.entry?.applied;
    if (since?.schemeId === latest.schemeId && since.changes > 0) {
      notes.push(`${changesWord(since.changes)} not applied`);
    }
    for (const h of holds) {
      if (h.schemeId !== latest.schemeId) notes.push(`${HAND_WORD[h.hand]}: ${named(h).title}`);
      if (h.check === 'differs') notes.push(`${HAND_WORD[h.hand]} differs`);
    }
    if (shown.entry !== undefined) {
      return {
        entry: shown.entry,
        scheme: shown.scheme,
        title: shown.title,
        applied: true,
        detail: notes.join(' · '),
        held,
      };
    }
  }

  const gameId = state?.activeGameId ?? null;
  if (gameId === null) return null;
  const entry = entries.find((e) => e.gameId === gameId);
  if (!entry) return null;
  // The active scheme only: with none picked the card says so, whatever a click would open.
  const scheme = activeScheme(entry);
  return {
    entry,
    scheme,
    title: scheme === null ? entry.name : `${entry.name} · ${scheme.name}`,
    applied: false,
    detail: scheme === null ? 'No scheme picked' : `Not applied yet · ${setupWords(scheme)}`,
    held,
  };
}
