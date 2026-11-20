// A scheme worked out into its plan: the scheme, its game and the built-in devices, through
// core's `resolve`. Shared by Apply (what to write) and the sync pill (what the scheme says now).
// Pure: the store is handed in as two lookups, so tests give it fakes.

import type { Game, Plan, Scheme } from '@helmarray/core';
import { BUILT_IN_DEVICES, resolve } from '@helmarray/core';

export interface PlanSource {
  /** The scheme as edited, edits not yet written to disk included; null when there is none. */
  getScheme(id: string): Promise<Scheme | null>;
  getGame(gameId: string): Promise<Game | undefined>;
}

export type PlanResult =
  | { ok: true; scheme: Scheme; game: Game; plan: Plan }
  /** `reason` is one plain sentence. */
  | { ok: false; reason: string };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function planFor(schemeId: string, source: PlanSource): Promise<PlanResult> {
  let scheme: Scheme | null;
  let game: Game | undefined;
  try {
    scheme = await source.getScheme(schemeId);
    if (!scheme) return { ok: false, reason: 'There is no such scheme.' };
    game = await source.getGame(scheme.gameId);
  } catch (error) {
    return { ok: false, reason: `The scheme couldn't be read: ${messageOf(error)}` };
  }
  if (!game) return { ok: false, reason: "This scheme's game isn't one helmArray knows." };
  try {
    return { ok: true, scheme, game, plan: resolve(scheme, game, BUILT_IN_DEVICES) };
  } catch (error) {
    return { ok: false, reason: `This scheme can't be worked out: ${messageOf(error)}` };
  }
}
