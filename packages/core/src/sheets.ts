// The bind sheet kept after an apply: what is still to be set by hand in each game's own controls
// menu, until the person says it is done (sheets.json). Pure: the app keeps the file.

import type { ActionId, ModeId, Signal } from './model';
import type { BindingSet } from './plan';
import { clone } from './clone';

/** One binding to set by hand in a game's own controls menu, as the Apply drawer words it. */
export interface SheetRow {
  /** The game's keyboard bindings or its controller bindings. */
  set: BindingSet;
  mode: ModeId;
  modeName: string;
  action: ActionId;
  actionName: string;
  /** What the action goes on; null: on nothing (it comes off what it is on). */
  to: Signal | null;
  /** What the game had it on, as far as helmArray knew; null: on nothing. */
  from: Signal | null;
}

/** One game's rows still to set. */
export interface KeptSheet {
  gameId: string;
  gameName: string;
  rows: SheetRow[];
}

/** Every game's, the one applied last first. */
export interface KeptSheets {
  games: KeptSheet[];
}

export const NO_SHEETS: KeptSheets = { games: [] };

const keyOf = (row: SheetRow) => `${row.set}|${row.mode}|${row.action}`;

/**
 * After an apply that left rows to set by hand: they go on that game's sheet, and the game goes
 * first. Each action the apply touched (set, mode and action) has its whole group of rows
 * replaced by the apply's, in the place the group had: an action may be on several keys at once,
 * and every one of them is kept. Actions the apply didn't touch keep the rows still to set from
 * before; new ones go after, in the apply's order.
 */
export function keepSheet(
  kept: KeptSheets,
  gameId: string,
  gameName: string,
  rows: readonly SheetRow[],
): KeptSheets {
  if (rows.length === 0) return kept;
  const fresh = new Map<string, SheetRow[]>();
  for (const row of rows) fresh.set(keyOf(row), [...(fresh.get(keyOf(row)) ?? []), row]);
  const before = kept.games.find((s) => s.gameId === gameId)?.rows ?? [];
  const merged: SheetRow[] = [];
  const placed = new Set<string>();
  for (const row of before) {
    const key = keyOf(row);
    const group = fresh.get(key);
    if (group === undefined) merged.push(row);
    else if (!placed.has(key)) {
      merged.push(...group);
      placed.add(key);
    }
  }
  for (const [key, group] of fresh) if (!placed.has(key)) merged.push(...group);
  return {
    games: [
      { gameId, gameName, rows: clone(merged) },
      ...kept.games.filter((s) => s.gameId !== gameId),
    ],
  };
}

/** The person has set them: the game's sheet goes. */
export const dismissSheet = (kept: KeptSheets, gameId: string): KeptSheets => ({
  games: kept.games.filter((s) => s.gameId !== gameId),
});
