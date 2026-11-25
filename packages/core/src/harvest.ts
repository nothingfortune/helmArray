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
//   - Typed in by hand (in the data, not in the file and not in it at the last read) under the name
//     of an action the file has, the name compared in any case and with any spaces: it is the
//     file's action. In a mode the file has, only an action of that mode matches; in a mode the
//     file doesn't have (a game typed in on the Game screen has only `default`), the one action of
//     that name in any of the file's modes, and none when the file has the name more than once (all
//     are kept, and the list says so). Each of yours stands for one of the file's. A match takes the
//     file's id and mode, so Apply writes it into the file; every other field is merged as a never
//     read one (what you typed stays, what you left empty is filled), and the file's isn't added
//     beside it. `moves` lists each id that changed, for the store to rewrite what names it. A mode
//     of yours left empty by the moves goes, unless a setup still places something else in it.
// `file.format` is the file's. The game's id, Steam id and retired ids are the data's. Whether the
// sticks must send keys is the data's too, once the file has been read into it: a first read (into
// no data, or into a game typed in by hand) takes it from the file's head start.
// A file with nothing usable in it (no action, or a game core's gameProblem refuses: an empty
// file, or one of lines the adapter ignores) is refused, so a merge never gives a game that can't
// be saved.

import type { Action, ActionId, Game, Mode, ModeId, PadControl, Signal } from './model';
import type { GameBinding } from './plan';
import { clone } from './clone';
import { gameProblem } from './game-data';

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
  | { kind: 'gone'; action: ActionId; name: string }
  /**
   * An action you typed in (`action`, in mode `from`) has the name of one in the file (`file`, in
   * `mode`): it is that one now, with its id and mode, and the file's isn't added beside it. `kept`:
   * the fields of yours that stay though the file has another value.
   */
  | {
      kind: 'same-name';
      action: ActionId;
      name: string;
      file: ActionId;
      from: ModeId;
      mode: ModeId;
      kept: HarvestField[];
    }
  /**
   * An action you typed in, in a mode the file doesn't have, whose name the file has more than once
   * (in `modes`): matched to none, so yours stays and so do the file's.
   */
  | { kind: 'same-name-several'; action: ActionId; name: string; modes: ModeId[] }
  /** A mode of yours whose actions all moved to the file's modes: it goes. */
  | { kind: 'mode-removed'; mode: ModeId; name: string }
  /** The sticks must send keys from now on, as the game's head start says. */
  | { kind: 'key-stick' };

/**
 * An action of yours (`action`, in `mode`) that is the file's `to`, in `toMode`, from now on:
 * whatever names the old id (a setup's placements, the bindings applied, what the game holds) is
 * to name the new one.
 */
export interface ActionMove {
  action: ActionId;
  mode: ModeId;
  to: ActionId;
  toMode: ModeId;
}

/** Where a setup of the game places an action: what keeps a mode of yours from going. */
export interface ActionUse {
  mode: ModeId;
  action: ActionId;
}

export interface HarvestMerge {
  game: Game;
  changes: HarvestChange[];
  /** Each action of yours that took the file's id: empty when none did. */
  moves: ActionMove[];
}

/**
 * A value as comparable text: object keys in order, a key's modifiers in any order the same (the
 * only arrays a field holds). Nothing at all is no text, which no value is either.
 */
function canon(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (Array.isArray(v)) return [...(v as string[])].sort();
    if (typeof v !== 'object' || v === null) return v;
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

/** A name as it is compared with another: in any case, and with any spaces. */
// Stryker disable next-line MethodExpression: both names are folded the same way, so upper or lower case makes the same match
const nameKey = (name: string): string => name.toLowerCase().replace(/\s/g, '');

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
      : rows.some((r) => same(r.signal, value)));
  return actions.map((action) => {
    const rows = held.filter((r) => r.action === action.id);
    const keyRows = rows.filter((r) => r.set === 'keyboard');
    const padRows = rows.filter((r) => r.set === 'controller');
    const pad = action.native?.pad;
    const keyHeld = matches(keyRows, action.native?.key);
    const padHeld = matches(padRows, pad === undefined ? undefined : { kind: 'pad', control: pad });
    const before = base.get(action.id);
    return actionOf(action.id, (field) => {
      if (field === 'key' && keyHeld) return fieldOf(before, 'key');
      if (field === 'pad' && padHeld) return fieldOf(before, 'pad');
      return fieldOf(action, field);
    });
  });
}

/** What the field rule makes of one field that differs between yours and the file's. */
type FieldOutcome =
  | { kind: 'kept'; field: HarvestField; yours: unknown; file: unknown }
  | { kind: 'changed'; field: HarvestField; from: unknown; to: unknown };

/**
 * One action of yours merged with the file's (`now`), field by field, against what the file had at
 * the last read (`base`): each field's value, and what became of each field that differs.
 */
function mergeFields(
  mine: Action,
  now: Action,
  base: Action | undefined,
  modeIds: ReadonlySet<ModeId>,
): { values: Map<HarvestField, unknown>; outcomes: FieldOutcome[] } {
  const values = new Map<HarvestField, unknown>();
  const outcomes: FieldOutcome[] = [];
  for (const field of FIELDS) {
    const yours = fieldOf(mine, field);
    const theirs = fieldOf(now, field);
    if (same(yours, theirs)) {
      values.set(field, yours);
    } else if (!same(yours, fieldOf(base, field))) {
      outcomes.push({ kind: 'kept', field, yours, file: theirs });
      values.set(field, yours);
    } else if (field === 'mode' && !modeIds.has(theirs as ModeId)) {
      // A mode the data doesn't have (you deleted it) is never moved into.
      values.set(field, yours);
    } else {
      outcomes.push({ kind: 'changed', field, from: yours, to: theirs });
      values.set(field, theirs);
    }
  }
  return { values, outcomes };
}

/**
 * The game's data with what its file holds merged in. `mine` is the data as it is (null: there is
 * none yet, and the file's is taken whole); `file` is the adapter's harvest; `held` is what the
 * game holds from helmArray's last apply, when it holds anything; `uses` is where the game's setups
 * place its actions (a mode of yours one still places something in is never removed). The result
 * keeps `fromFile` up to date, lists every change (`changes` empty: nothing to save), and gives each
 * action of yours that took the file's id (`moves`). Throws for a file with nothing usable in it: no
 * action, or a game core refuses.
 */
export function mergeHarvest(
  mine: Game | null,
  file: Game,
  held: readonly GameBinding[] | null = null,
  uses: readonly ActionUse[] = [],
): HarvestMerge {
  if (file.actions.length === 0 || gameProblem(file) !== null)
    throw new Error("There is nothing in the game's file helmArray can use.");
  const baseActions = new Map((mine?.fromFile?.actions ?? []).map((a) => [a.id, a]));
  const baseModes = new Map((mine?.fromFile?.modes ?? []).map((m) => [m.id, m]));
  const theirs = setAside(file.actions, held ?? [], baseActions);
  const fromFile = clone({ modes: file.modes, actions: theirs });
  const changes: HarvestChange[] = [];
  const keyStick = file.needsKeyStick === true;

  if (mine === null) {
    const game: Game = { ...clone(file), actions: clone(theirs), fromFile };
    if (file.file !== undefined) changes.push({ kind: 'format' });
    for (const mode of file.modes)
      changes.push({ kind: 'mode-added', mode: mode.id, name: mode.name });
    for (const a of theirs)
      changes.push({ kind: 'added', action: a.id, name: a.name, mode: a.mode });
    if (keyStick) changes.push({ kind: 'key-stick' });
    return { game, changes, moves: [] };
  }

  const retiredModes = new Set(mine.retired?.modes);
  const retiredActions = new Set(mine.retired?.actions);

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

  // Yours typed in by hand, never the file's: each may be one of the file's, by its name. One the
  // data doesn't have yet, whose id isn't retired and whose mode is there.
  const fileActions = new Map(theirs.map((a) => [a.id, a]));
  const mineIds = new Set(mine.actions.map((a) => a.id));
  const free = (t: Action): boolean =>
    !mineIds.has(t.id) && !retiredActions.has(t.id) && modeIds.has(t.mode);
  const typed = mine.actions.filter((a) => !fileActions.has(a.id) && !baseActions.has(a.id));
  const matchOf = new Map<ActionId, Action>();
  const taken = new Set<ActionId>();
  // In a mode the file has: the first of that name in the same mode.
  for (const t of theirs) {
    if (!free(t)) continue;
    const m = typed.find(
      (a) => !matchOf.has(a.id) && a.mode === t.mode && nameKey(a.name) === nameKey(t.name),
    );
    if (m === undefined) continue;
    matchOf.set(m.id, t);
    taken.add(t.id);
  }
  // In a mode the file doesn't have: the one of that name in any of the file's modes; none when
  // the file has the name more than once.
  const fileModeIds = new Set(file.modes.map((m) => m.id));
  const several = new Map<ActionId, ModeId[]>();
  for (const m of typed) {
    if (matchOf.has(m.id) || fileModeIds.has(m.mode)) continue;
    const named = theirs.filter((t) => nameKey(t.name) === nameKey(m.name));
    if (named.length > 1) {
      several.set(m.id, [...new Set(named.map((t) => t.mode))]);
      continue;
    }
    const t = named[0];
    if (t === undefined || !free(t) || taken.has(t.id)) continue;
    matchOf.set(m.id, t);
    taken.add(t.id);
  }
  // A match is the file's action with yours merged in as a never read one, in the file's mode.
  const matched = new Map<ActionId, { mine: Action; action: Action; kept: HarvestField[] }>();
  for (const m of typed) {
    const t = matchOf.get(m.id);
    if (t === undefined) continue;
    const { values, outcomes } = mergeFields(m, t, baseActions.get(t.id), modeIds);
    values.set('mode', t.mode);
    const kept = outcomes.flatMap((o) =>
      o.kind === 'kept' && o.field !== 'mode' ? [o.field] : [],
    );
    matched.set(t.id, { mine: m, action: clone(actionOf(t.id, (f) => values.get(f))), kept });
  }

  // Actions: each of yours, field by field (one matched in its own mode stays where it is; one that
  // moves mode goes where the file's would); then the file's new ones, at the end of their mode.
  const actions: Action[] = [];
  for (const m of mine.actions) {
    const t = matchOf.get(m.id);
    if (t !== undefined) {
      const match = matched.get(t.id);
      if (match !== undefined && t.mode === m.mode) actions.push(match.action);
      continue;
    }
    const now = fileActions.get(m.id);
    if (now === undefined) {
      if (baseActions.has(m.id)) changes.push({ kind: 'gone', action: m.id, name: m.name });
      actions.push(clone(m));
      continue;
    }
    const { values, outcomes } = mergeFields(m, now, baseActions.get(m.id), modeIds);
    for (const o of outcomes) {
      changes.push(
        o.kind === 'kept'
          ? {
              kind: 'kept',
              action: m.id,
              name: m.name,
              field: o.field,
              yours: o.yours,
              file: o.file,
            }
          : { kind: 'changed', action: m.id, name: m.name, field: o.field, from: o.from, to: o.to },
      );
    }
    actions.push(clone(actionOf(m.id, (field) => values.get(field))));
  }
  const moves: ActionMove[] = [];
  for (const t of theirs) {
    const match = matched.get(t.id);
    if (match !== undefined) {
      const m = match.mine;
      if (m.mode !== t.mode)
        actions.splice(actions.findLastIndex((a) => a.mode === t.mode) + 1, 0, match.action);
      changes.push({
        kind: 'same-name',
        action: m.id,
        name: m.name,
        file: t.id,
        from: m.mode,
        mode: t.mode,
        kept: match.kept,
      });
      moves.push({ action: m.id, mode: m.mode, to: t.id, toMode: t.mode });
      continue;
    }
    if (actions.some((a) => a.id === t.id) || retiredActions.has(t.id) || !modeIds.has(t.mode))
      continue;
    const after = actions.findLastIndex((a) => a.mode === t.mode);
    actions.splice(after + 1, 0, clone(t));
    changes.push({ kind: 'added', action: t.id, name: t.name, mode: t.mode });
  }
  for (const m of typed) {
    const where = several.get(m.id);
    if (where !== undefined)
      changes.push({ kind: 'same-name-several', action: m.id, name: m.name, modes: where });
  }

  // A mode of yours whose actions all moved to the file's goes, unless a setup still places
  // something other than what moved in it.
  // (A move within one mode leaves the moved action in it, so that mode is never empty.)
  const movedFrom = new Set(moves.map((mv) => mv.mode));
  const movedIds = new Set(moves.map((mv) => mv.action));
  const left = modes.filter((m) => {
    if (
      !movedFrom.has(m.id) ||
      actions.some((a) => a.mode === m.id) ||
      uses.some((u) => u.mode === m.id && !movedIds.has(u.action))
    )
      return true;
    changes.push({ kind: 'mode-removed', mode: m.id, name: m.name });
    return false;
  });

  if (file.file !== undefined && mine.file?.format !== file.file.format)
    changes.push({ kind: 'format' });
  // The file's head start fills it on the first read into data you have, unless you set it.
  const fillKeyStick = keyStick && mine.fromFile === undefined && mine.needsKeyStick === undefined;
  if (fillKeyStick) changes.push({ kind: 'key-stick' });
  const game: Game = {
    ...clone(mine),
    modes: left,
    actions,
    ...(file.file === undefined ? {} : { file: { ...mine.file, format: file.file.format } }),
    ...(fillKeyStick ? { needsKeyStick: true } : {}),
    fromFile,
  };
  return { game, changes, moves };
}
