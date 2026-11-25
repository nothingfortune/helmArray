// What is still to be set by hand in each game's own controls, for the Library's card: worked out
// afresh every time from the plan applied to the game last and the bindings the game holds (its
// baseline, sheets.json), never kept apply by apply. *Done* moves a baseline, and so does writing
// the game's file (Apply, through `DataStore.settleBaseline`). Pure: the store is handed in.

import type { GameBinding, KeptSheet, Plan } from '@helmarray/core';
import { heldPlan } from '@helmarray/core';
import type { GameEntry } from '../shared/api';
import { changedRows } from './apply-service';

export interface ReminderSource {
  listGames(): Promise<GameEntry[]>;
  /** The scheme of the game applied last, and when, or null when none was. */
  lastApplied(gameId: string): Promise<{ schemeId: string; at: number } | null>;
  getApplied(schemeId: string): Promise<Plan | null>;
  /** The bindings the game holds as far as helmArray knows; null: what it ships. */
  heldBindings(gameId: string): Promise<GameBinding[] | null>;
}

/** The plan applied to a game last, or null when none was (or it can't be read). */
async function latest(source: Pick<ReminderSource, 'lastApplied' | 'getApplied'>, gameId: string) {
  const last = await source.lastApplied(gameId);
  if (last === null) return null;
  const plan = await source.getApplied(last.schemeId);
  return plan === null ? null : { plan, at: last.at };
}

/**
 * Each game with something still to set by hand, the one applied last first. A game whose file was
 * written holds what was applied, so it has nothing to set; one whose file wasn't (not found, the
 * game running, a write that failed) has, whatever its plan says of the file.
 */
export async function reminders(source: ReminderSource): Promise<KeptSheet[]> {
  const found: (KeptSheet & { at: number })[] = [];
  for (const { game } of await source.listGames()) {
    const applied = await latest(source, game.id);
    if (applied === null) continue;
    const rows = changedRows(applied.plan, game, heldPlan(await source.heldBindings(game.id)));
    if (rows.length > 0) found.push({ gameId: game.id, gameName: game.name, rows, at: applied.at });
  }
  return found
    .sort((a, b) => b.at - a.at)
    .map((sheet) => ({ gameId: sheet.gameId, gameName: sheet.gameName, rows: sheet.rows }));
}

/**
 * *Done*: the person set what was left to set, so the game now holds the bindings applied to it
 * last. Nothing when nothing was applied to it.
 */
export async function settleReminder(
  source: Pick<ReminderSource, 'lastApplied' | 'getApplied'> & {
    settleBaseline(gameId: string, bindings: readonly GameBinding[]): Promise<void>;
  },
  gameId: string,
): Promise<void> {
  const applied = await latest(source, gameId);
  if (applied !== null) await source.settleBaseline(gameId, applied.plan.gameBindings);
}
