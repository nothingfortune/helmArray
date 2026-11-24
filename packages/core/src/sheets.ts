// What is still to be set by hand in a game's own controls menu, worked out afresh every time and
// never accumulated: the bindings the latest applied plan gives the game, against the bindings the
// game holds as far as helmArray knows (its baseline, kept in sheets.json). Pure: the app keeps
// the file.
//
// - A game's baseline starts as what the game ships (no entry for it).
// - It moves only when the person says the game is set (*Done*): to what was applied. A game whose
//   file helmArray writes (M5) moves it when the file is written instead (`settleBaseline`, the
//   same call).
// - The reminder is `pendingRows(latest applied, baseline)`. An empty one is not shown.

import type { ActionId, ModeId, Signal } from './model';
import type { BindingSet, GameBinding, Plan } from './plan';
import { clone } from './clone';
import { gameRowsChanged } from './resolve';

/** One binding to set by hand in a game's own controls menu, as the Apply drawer words it. */
export interface SheetRow {
  /** The game's keyboard bindings or its controller bindings. */
  set: BindingSet;
  mode: ModeId;
  modeName: string;
  action: ActionId;
  actionName: string;
  /** What the action goes on; null: it comes off `from`. */
  to: Signal | null;
  /** What the game has it on now, as far as helmArray knows; null: on nothing. */
  from: Signal | null;
}

/** One game's rows still to set, worked out from its baseline. */
export interface KeptSheet {
  gameId: string;
  gameName: string;
  rows: SheetRow[];
}

/** One game's baseline: the bindings it holds, as far as helmArray knows. */
export interface GameBaseline {
  gameId: string;
  held: GameBinding[];
}

/** sheets.json: every game's baseline that has moved from what the game ships. */
export interface Baselines {
  games: GameBaseline[];
  /**
   * Set only when a version-1 file (reminder rows, not baselines) was read: how many games' rows
   * were dropped. The app says so in its log and writes the file again without it.
   */
  droppedReminders?: number;
}

export const NO_BASELINES: Baselines = { games: [] };

/** A row still to set, before the names are put on it. */
export type PendingRow = Pick<SheetRow, 'set' | 'mode' | 'action' | 'to' | 'from'>;

const keyOf = (b: { set: string; mode: string; action: string }) =>
  `${b.set}|${b.mode}|${b.action}`;

/** The game's baseline bindings, or null when it holds what it ships. */
export const heldBy = (baselines: Baselines, gameId: string): GameBinding[] | null =>
  baselines.games.find((g) => g.gameId === gameId)?.held ?? null;

/** The baseline as a plan's bindings, for the comparisons that take one; null: what it ships. */
export const heldPlan = (held: readonly GameBinding[] | null): Pick<Plan, 'gameBindings'> | null =>
  held === null ? null : { gameBindings: [...held] };

/**
 * What is still to set by hand: each action the latest applied bindings put somewhere other than
 * where the game holds it. An action given keys: one row per key it goes on ("Set Jump to J"),
 * with what it is on now. An action taken off everything: one row per binding it still has ("Take
 * Jump off Space"), so following the rows leaves it on nothing whatever came between.
 */
export function pendingRows(
  applied: readonly GameBinding[],
  held: readonly GameBinding[] | null,
): PendingRow[] {
  const holds = new Map<string, Signal[]>();
  for (const b of held ?? []) {
    holds.set(keyOf(b), [...(holds.get(keyOf(b)) ?? []), ...(b.signal === null ? [] : [b.signal])]);
  }
  const changed = gameRowsChanged({ gameBindings: [...applied] }, heldPlan(held));
  const groups = new Map<string, GameBinding[]>();
  for (const b of changed) groups.set(keyOf(b), [...(groups.get(keyOf(b)) ?? []), b]);
  const out: PendingRow[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    if (first === undefined) continue;
    const now = holds.has(key)
      ? (holds.get(key) ?? [])
      : first.native === null
        ? []
        : [first.native];
    const { set, mode, action } = first;
    const to = group.flatMap((b) => (b.signal === null ? [] : [b.signal]));
    if (to.length === 0) {
      for (const from of now) out.push({ set, mode, action, to: null, from });
    } else {
      for (const signal of to) out.push({ set, mode, action, to: signal, from: now[0] ?? null });
    }
  }
  return clone(out);
}

/**
 * The game now holds what was applied (*Done*, or its file written): the baseline of each action
 * the bindings cover becomes theirs; every other action keeps its own.
 */
export function settleBaseline(
  baselines: Baselines,
  gameId: string,
  applied: readonly GameBinding[],
): Baselines {
  const covered = new Set(applied.map(keyOf));
  const kept = (heldBy(baselines, gameId) ?? []).filter((b) => !covered.has(keyOf(b)));
  return {
    games: [
      { gameId, held: clone([...kept, ...applied]) },
      ...baselines.games.filter((g) => g.gameId !== gameId),
    ],
  };
}
