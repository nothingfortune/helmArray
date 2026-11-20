// J1, pick a game, pick a default, play, as a reducer: a click on a game, a click on a default,
// and the Editor is open on a new scheme that is now the active one. A game that already has
// schemes opens in one click. Pure: it returns what to do, and `runCommand` does it over the
// API, so the click counts can be tested without a window.

import type { HelmApi, LibraryEntry, Preset } from '../../shared/api';
import { chosenScheme } from './libraryView';

export interface FlowState {
  /** The game whose "start from" choices are open, or null. */
  picking: string | null;
  /** True from the click that starts making a scheme until it is made: further clicks are ignored. */
  busy: boolean;
  /** One plain sentence when the last try failed, or null. */
  error: string | null;
}

export const START: FlowState = { picking: null, busy: false, error: null };

export type FlowEvent =
  | { type: 'tile'; entry: LibraryEntry }
  | { type: 'choose'; entry: LibraryEntry; preset: Preset }
  | { type: 'open'; entry: LibraryEntry; schemeId: string }
  | { type: 'dismiss' }
  | { type: 'failed'; message: string }
  | { type: 'finished' };

export type Command =
  | { type: 'open-editor'; schemeId: string }
  | { type: 'make-and-open'; gameId: string; preset: Preset };

export interface Step {
  state: FlowState;
  command: Command | null;
}

export function step(state: FlowState, event: FlowEvent): Step {
  const stay: Step = { state, command: null };
  switch (event.type) {
    case 'tile': {
      const { entry } = event;
      // A game helmArray has no definition for does nothing: there is nothing to open.
      if (state.busy || entry.gameId === null) return stay;
      const scheme = chosenScheme(entry);
      if (scheme !== null)
        return {
          state: { ...state, picking: null, error: null },
          command: { type: 'open-editor', schemeId: scheme.id },
        };
      return { state: { ...state, picking: entry.gameId, error: null }, command: null };
    }
    case 'choose': {
      if (state.busy || event.entry.gameId === null) return stay;
      return {
        state: { picking: null, busy: true, error: null },
        command: { type: 'make-and-open', gameId: event.entry.gameId, preset: event.preset },
      };
    }
    case 'open': {
      if (state.busy || !event.entry.schemes.some((s) => s.id === event.schemeId)) return stay;
      return {
        state: { ...state, picking: null, error: null },
        command: { type: 'open-editor', schemeId: event.schemeId },
      };
    }
    case 'dismiss':
      return { state: { ...state, picking: null }, command: null };
    case 'failed':
      return { state: { picking: null, busy: false, error: event.message }, command: null };
    case 'finished':
      return { state: { ...state, busy: false }, command: null };
  }
}

export type Outcome = { ok: true; schemeId: string } | { ok: false; message: string };

/** The reason in an error, without the wrapping Electron adds to an error from the main process. */
export function plainReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const unwrapped = text.replace(/^Error invoking remote method '[^']*':\s*/, '');
  return unwrapped.replace(/^(?:[A-Za-z]+Error):\s*/, '').trim();
}

/** Makes the scheme from the preset, makes it the active one, and says which scheme to open. */
export async function runMake(
  api: Pick<HelmApi, 'createScheme' | 'setActive'>,
  gameId: string,
  preset: Preset,
): Promise<Outcome> {
  let schemeId: string;
  try {
    schemeId = (await api.createScheme(gameId, preset)).id;
  } catch (error) {
    return { ok: false, message: `Couldn't make that scheme. ${plainReason(error)}`.trim() };
  }
  try {
    await api.setActive(gameId, schemeId);
  } catch (error) {
    return {
      ok: false,
      message:
        `The scheme was made, but couldn't be set as the current one. ${plainReason(error)}`.trim(),
    };
  }
  return { ok: true, schemeId };
}
