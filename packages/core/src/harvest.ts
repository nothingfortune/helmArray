// A game's data filled from its own file (docs/plans/02-architecture.md, *Harvesting a game's
// defaults*): what an adapter harvests merged with what the person already has, so a re-read
// never loses anything they typed. Pure: the app reads the file, this decides what changes.
//
// The rule, per field (an action's name, mode, role, required, default key and default
// controller button; a mode's name), with three values: what the file has now, what it had when
// it was last read (`Game.fromFile`), and what the game's data has.
//   - Unchanged in the data since the last read: it takes what the file has now (the game was
//     updated, or rebound in its own menu).
//   - Changed in the data since: it is yours and stays, whatever the file says. Never read before,
//     a value the data has counts as yours; one it doesn't have is filled from the file.
//   - A binding the file has because helmArray put it there (what the game holds, its baseline) is
//     not news from the game: it counts as what the file had last time.
// Whole actions and modes:
//   - In the file and not in the data: added at the end of its mode, unless its id is retired (you
//     deleted it, or its mode) or its mode isn't there. A retired id never comes back.
//   - In the data and not in the file: kept as it is, added by hand or gone from the file.
// `file.format` is the file's. Everything else of the game (its id, Steam id, retired ids, whether
// the sticks must send keys) is the data's.

import type { Action, ActionId, Game, Mode, ModeId, PadControl, Signal } from './model';
import type { GameBinding } from './plan';
import { clone } from './clone';

/** The parts of an action the file and the person can both set. */
export type HarvestField = 'name' | 'mode' | 'role' | 'required' | 'key' | 'pad';

/** One thing a merge changes, or keeps against the file, for the list shown before it is saved. */
export type HarvestChange =
  /** The data takes the file's format: helmArray can write the game's file. */
  | { kind: 'format' }
  | { kind: 'mode-added'; mode: ModeId; name: string }
  | { kind: 'mode-renamed'; mode: ModeId; from: string; to: string }
  | { kind: 'added'; action: ActionId; name: string; mode: ModeId }
  /** A field takes the file's value. */
  | {
      kind: 'changed';
      action: ActionId;
      name: string;
      field: HarvestField;
      from: unknown;
      to: unknown;
    }
  /** A field you changed stays yours, though the file has another value. */
  | {
      kind: 'kept';
      action: ActionId;
      name: string;
      field: HarvestField;
      yours: unknown;
      file: unknown;
    }
  /** The file had the action last time and doesn't now: it stays in the data. */
  | { kind: 'gone'; action: ActionId; name: string };

export interface HarvestMerge {
  game: Game;
  changes: HarvestChange[];
}

/** A value as comparable text: object keys in order, a key's modifiers in any order the same. */
function canon(value: unknown): string {
  if (value === undefined) return '~';
  return JSON.stringify(value, (key, v: unknown) => {
    if (key === 'mods' && Array.isArray(v)) return [...(v as string[])].sort();
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    );
  });
}
const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b);

/** One field of an action, read the same way whichever it is. */
function fieldOf(action: Action | undefined, field: HarvestField): unknown {
  if (action === undefined) return undefined;
  if (field === 'key') return action.native?.key;
  if (field === 'pad') return action.native?.pad;
  return action[field];
}

/** An action rebuilt from its fields, with no `native` when it has no default, and no empty role. */
function actionOf(id: ActionId, get: (field: HarvestField) => unknown): Action {
  const role = get('role') as Action['role'];
  const key = get('key') as Signal | undefined;
  const pad = get('pad') as PadControl | undefined;
  return {
    id,
    name: get('name') as string,
    mode: get('mode') as ModeId,
    ...(role === undefined ? {} : { role }),
    required: get('required') as boolean,
    ...(key === undefined && pad === undefined
      ? {}
      : {
          native: { ...(key === undefined ? {} : { key }), ...(pad === undefined ? {} : { pad }) },
        }),
  };
}

/** In the order a person reads an action. */
const FIELDS: readonly HarvestField[] = ['name', 'mode', 'role', 'required', 'key', 'pad'];

/**
 * The file's actions with what helmArray put there itself set aside: a default that is the
 * binding the game holds from helmArray for that action and set (`held`) counts as what the file
 * had last time (`base`), so applying a setup and reading the file again changes no default.
 */
function setAside(
  actions: readonly Action[],
  held: readonly GameBinding[],
  base: ReadonlyMap<ActionId, Action>,
): Action[] {
  const matches = (rows: readonly GameBinding[], value: Signal | undefined): boolean =>
    rows.length > 0 &&
    (value === undefined
      ? rows.every((r) => r.signal === null)
      : rows.some((r) => r.signal !== null && same(r.signal, value)));
  return actions.map((action) => {
    const rows = held.filter((r) => r.action === action.id);
    const keyRows = rows.filter((r) => r.set === 'keyboard');
    const padRows = rows.filter((r) => r.set === 'controller');
    const pad = action.native?.pad;
    const keyHeld = matches(keyRows, action.native?.key);
    const padHeld = matches(padRows, pad === undefined ? undefined : { kind: 'pad', control: pad });
    if (!keyHeld && !padHeld) return action;
    const before = base.get(action.id);
    return actionOf(action.id, (field) => {
      if (field === 'key' && keyHeld) return fieldOf(before, 'key');
      if (field === 'pad' && padHeld) return fieldOf(before, 'pad');
      return fieldOf(action, field);
    });
  });
}

/**
 * The game's data with what its file holds merged in. `mine` is the data as it is (null: there is
 * none yet, and the file's is taken whole); `file` is the adapter's harvest; `held` is what the
 * game holds from helmArray's last apply, when it holds anything. The result keeps `fromFile` up
 * to date, and lists every change (`changes` empty: nothing to save).
 */
export function mergeHarvest(
  mine: Game | null,
  file: Game,
  held: readonly GameBinding[] | null = null,
): HarvestMerge {
  const baseActions = new Map((mine?.fromFile?.actions ?? []).map((a) => [a.id, a]));
  const baseModes = new Map((mine?.fromFile?.modes ?? []).map((m) => [m.id, m]));
  const theirs = setAside(file.actions, held ?? [], baseActions);
  const fromFile = clone({ modes: file.modes, actions: theirs });
  const changes: HarvestChange[] = [];

  if (mine === null) {
    const game: Game = { ...clone(file), actions: clone(theirs), fromFile };
    if (file.file !== undefined) changes.push({ kind: 'format' });
    for (const mode of file.modes)
      changes.push({ kind: 'mode-added', mode: mode.id, name: mode.name });
    for (const a of theirs)
      changes.push({ kind: 'added', action: a.id, name: a.name, mode: a.mode });
    return { game, changes };
  }

  const retiredModes = new Set(mine.retired?.modes ?? []);
  const retiredActions = new Set(mine.retired?.actions ?? []);

  // Modes: each of yours, renamed only where you hadn't; then the file's new ones.
  const fileModes = new Map(file.modes.map((m) => [m.id, m]));
  const modes: Mode[] = mine.modes.map((m) => {
    const t = fileModes.get(m.id);
    const b = baseModes.get(m.id);
    if (t === undefined || !same(m.name, b?.name) || m.name === t.name) return { ...m };
    changes.push({ kind: 'mode-renamed', mode: m.id, from: m.name, to: t.name });
    return { ...m, name: t.name };
  });
  for (const t of file.modes) {
    if (modes.some((m) => m.id === t.id) || retiredModes.has(t.id)) continue;
    modes.push({ ...t });
    changes.push({ kind: 'mode-added', mode: t.id, name: t.name });
  }
  const modeIds = new Set(modes.map((m) => m.id));

  // Actions: each of yours, field by field; then the file's new ones, at the end of their mode.
  const fileActions = new Map(theirs.map((a) => [a.id, a]));
  const actions: Action[] = mine.actions.map((m) => {
    const t = fileActions.get(m.id);
    if (t === undefined) {
      if (baseActions.has(m.id)) changes.push({ kind: 'gone', action: m.id, name: m.name });
      return clone(m);
    }
    const b = baseActions.get(m.id);
    const values = new Map<HarvestField, unknown>();
    for (const field of FIELDS) {
      const yours = fieldOf(m, field);
      const now = fieldOf(t, field);
      if (same(yours, now)) {
        values.set(field, yours);
      } else if (!same(yours, fieldOf(b, field))) {
        changes.push({ kind: 'kept', action: m.id, name: m.name, field, yours, file: now });
        values.set(field, yours);
      } else if (field === 'mode' && !modeIds.has(now as ModeId)) {
        // A mode the data doesn't have (you deleted it) is never moved into.
        values.set(field, yours);
      } else {
        changes.push({ kind: 'changed', action: m.id, name: m.name, field, from: yours, to: now });
        values.set(field, now);
      }
    }
    return clone(actionOf(m.id, (field) => values.get(field)));
  });
  for (const t of theirs) {
    if (actions.some((a) => a.id === t.id) || retiredActions.has(t.id) || !modeIds.has(t.mode))
      continue;
    const after = actions.findLastIndex((a) => a.mode === t.mode);
    actions.splice(after + 1, 0, clone(t));
    changes.push({ kind: 'added', action: t.id, name: t.name, mode: t.mode });
  }

  if (file.file !== undefined && mine.file?.format !== file.file.format)
    changes.push({ kind: 'format' });
  const game: Game = {
    ...clone(mine),
    modes,
    actions,
    ...(file.file === undefined ? {} : { file: { ...mine.file, format: file.file.format } }),
    fromFile,
  };
  return { game, changes };
}
