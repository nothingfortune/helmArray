// The Editor's Scheme picker, its steps over the API: copy the setup open, delete it. Switching to
// another setup and starting one from a default are the Library's own (`runPick`, `runMake`). Pure:
// each takes the part of `window.helm` it uses and says what to open next.

import type { HelmApi } from '../../shared/api';
import { plainReason } from './libraryFlow';
import type { Outcome } from './libraryFlow';

/** *Copy this one*: a copy of the setup, made the game's active one, to open. */
export async function runCopy(
  api: Pick<HelmApi, 'copyScheme' | 'setActive'>,
  gameId: string,
  schemeId: string,
): Promise<Outcome> {
  let copyId: string;
  try {
    copyId = (await api.copyScheme(schemeId)).id;
  } catch (error) {
    return { ok: false, message: `Couldn't copy this scheme. ${plainReason(error)}`.trim() };
  }
  try {
    await api.setActive(gameId, copyId);
  } catch (error) {
    return {
      ok: false,
      message:
        `The copy was made, but couldn't be set as the current one. ${plainReason(error)}`.trim(),
    };
  }
  return { ok: true, schemeId: copyId };
}

/** Where to go after a delete: another setup of the game, made the active one, or the Library. */
export type AfterDelete = { ok: true; next: string | null } | { ok: false; message: string };

/**
 * Deletes the setup, then opens another of the game's (the first by name) as its active one; with
 * none left, the Library.
 */
export async function runDelete(
  api: Pick<HelmApi, 'deleteScheme' | 'listSchemes' | 'setActive'>,
  gameId: string,
  schemeId: string,
): Promise<AfterDelete> {
  try {
    await api.deleteScheme(schemeId);
  } catch (error) {
    return { ok: false, message: `Couldn't delete this scheme. ${plainReason(error)}`.trim() };
  }
  try {
    const next = (await api.listSchemes(gameId)).find((s) => s.id !== schemeId)?.id ?? null;
    if (next !== null) await api.setActive(gameId, next);
    return { ok: true, next };
  } catch {
    // Deleted all the same: the Library shows what is left.
    return { ok: true, next: null };
  }
}
