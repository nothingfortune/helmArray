// The Game screen's edits, as pure functions on a game: its name, its modes and its actions, and
// each action's defaults. Every one returns a new game and leaves the one it was given alone. The
// screen checks the result with core's `gameProblem` before it saves it.

import type { Action, ActionId, Game, ModeId, PadControl, Role, Signal } from '@helmarray/core';
import { idFromName, isDataId } from '@helmarray/core';
import type { GameEntry, Preset } from '../../shared/api';
import { isSafeId } from '../../shared/ids';
import { commit } from './editor-model';
import type { History } from './editor-model';

/** Which game the Game screen opens on. */
export type GameTarget =
  | { kind: 'edit'; gameId: string }
  /** A game helmArray doesn't have yet: from a Steam tile (its name and app id), or by name. */
  | { kind: 'new'; name: string; steamAppId?: number };

/** The mode a new game starts with: one is needed, and most games have only one. */
const FIRST_MODE = { id: 'default', name: 'Default' };
/** The role of the first action of a mode: the neutral one. Later ones take the one above. */
const FIRST_ROLE: Role = 'ability';

/**
 * A new game: the name, one mode, no actions yet. Its id is made from the name, unique among
 * `taken` and safe as a file name. A game set up from Steam keeps its app id, so the Library
 * matches it with Steam's entry.
 */
export function newGame(name: string, taken: Iterable<string>, steamAppId?: number): Game {
  const used = new Set(taken);
  const id = idFromName(name, (c) => isSafeId(c) && isDataId(c) && !used.has(c), 'game');
  return {
    id,
    name,
    ...(steamAppId === undefined ? {} : { steamAppId }),
    modes: [{ ...FIRST_MODE }],
    actions: [],
  };
}

export const renameGame = (game: Game, name: string): Game => ({ ...game, name });

/** The actions of one mode, in the game's order. */
export const actionsIn = (game: Game, mode: ModeId): Action[] =>
  game.actions.filter((a) => a.mode === mode);

const freeId = (taken: readonly { id: string }[]) => (id: string) =>
  isDataId(id) && !taken.some((t) => t.id === id);

/**
 * Adds an action at the end of its mode: its name trimmed, not required, no defaults yet, and the
 * role of the action above it (actions are usually added in groups).
 */
export function addAction(game: Game, mode: ModeId, name: string): { game: Game; id: ActionId } {
  const trimmed = name.trim();
  const id = idFromName(trimmed, freeId(game.actions), 'action');
  const above = actionsIn(game, mode).at(-1);
  const action: Action = {
    id,
    name: trimmed,
    mode,
    role: above?.role ?? FIRST_ROLE,
    required: false,
  };
  return { game: { ...game, actions: [...game.actions, action] }, id };
}

function changeAction(game: Game, id: ActionId, change: (a: Action) => Action): Game {
  if (!game.actions.some((a) => a.id === id)) return game;
  return { ...game, actions: game.actions.map((a) => (a.id === id ? change(a) : a)) };
}

/** A new name, role or required. The id never changes: setups name actions by it. */
export const updateAction = (
  game: Game,
  id: ActionId,
  patch: Partial<Pick<Action, 'name' | 'role' | 'required'>>,
): Game => changeAction(game, id, (a) => ({ ...a, ...patch }));

/** Sets one of an action's defaults, or clears it (null). No defaults left: none at all. */
function setNative(action: Action, part: 'key' | 'pad', value: Signal | PadControl | null): Action {
  const key = part === 'key' ? (value as Signal | null) : (action.native?.key ?? null);
  const pad = part === 'pad' ? (value as PadControl | null) : (action.native?.pad ?? null);
  const native: NonNullable<Action['native']> = {
    ...(key === null ? {} : { key: structuredClone(key) }),
    ...(pad === null ? {} : { pad }),
  };
  const rest: Action = {
    id: action.id,
    name: action.name,
    mode: action.mode,
    role: action.role,
    required: action.required,
  };
  return key === null && pad === null ? rest : { ...rest, native };
}

/** The key (or mouse button) the game ships the action on; null clears it. */
export const setDefaultKey = (game: Game, id: ActionId, signal: Signal | null): Game =>
  changeAction(game, id, (a) => setNative(a, 'key', signal));

/** The controller button the game ships the action on; null clears it. */
export const setDefaultPad = (game: Game, id: ActionId, pad: PadControl | null): Game =>
  changeAction(game, id, (a) => setNative(a, 'pad', pad));

/** Moves an action up (-1) or down (1) past the next action of its own mode. */
export function moveAction(game: Game, id: ActionId, by: -1 | 1): Game {
  const action = game.actions.find((a) => a.id === id);
  if (action === undefined) return game;
  const mode = actionsIn(game, action.mode);
  const other = mode[mode.indexOf(action) + by];
  if (other === undefined) return game;
  return {
    ...game,
    actions: game.actions.map((a) => (a === action ? other : a === other ? action : a)),
  };
}

export const deleteAction = (game: Game, id: ActionId): Game => ({
  ...game,
  actions: game.actions.filter((a) => a.id !== id),
});

/** Adds a mode at the end. Its id is a key of every setup's map, so never an inherited name. */
export function addMode(game: Game, name: string): { game: Game; id: ModeId } {
  const trimmed = name.trim();
  const id = idFromName(trimmed, freeId(game.modes), 'mode');
  return { game: { ...game, modes: [...game.modes, { id, name: trimmed }] }, id };
}

export const renameMode = (game: Game, id: ModeId, name: string): Game => ({
  ...game,
  modes: game.modes.map((m) => (m.id === id ? { ...m, name } : m)),
});

/** Moves a mode left (-1) or right (1). */
export function moveMode(game: Game, id: ModeId, by: -1 | 1): Game {
  const at = game.modes.findIndex((m) => m.id === id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= game.modes.length) return game;
  const modes = [...game.modes];
  [modes[at], modes[to]] = [modes[to] as Game['modes'][number], modes[at] as Game['modes'][number]];
  return { ...game, modes };
}

/** Deletes a mode and its actions. The last mode stays: a game has at least one. */
export function deleteMode(game: Game, id: ModeId): Game {
  if (game.modes.length <= 1) return game;
  return {
    ...game,
    modes: game.modes.filter((m) => m.id !== id),
    actions: game.actions.filter((a) => a.mode !== id),
  };
}

/**
 * What a scheme of this game can start from: *Xbox controller* once it has an action, and *Game's
 * own keys* once an action has a default key (the Library's rule).
 */
export function canStartFrom(game: Game): Preset[] {
  if (game.actions.length === 0) return [];
  return game.actions.some((a) => a.native?.key !== undefined) ? ['xbox', 'keys'] : ['xbox'];
}

/**
 * Adds an edit to the undo history. An edit of the same text field as the one before replaces it
 * instead, so typing a name is one step to undo, not one per letter.
 */
export function record<T>(
  history: History<T>,
  next: T,
  field: string | null,
  lastField: string | null,
): History<T> {
  if (field !== null && field === lastField && history.past.length > 0)
    return { ...history, present: next, future: [] };
  return commit(history, next);
}

/**
 * What the Game screen opens on: the game helmArray knows (with whose it is), or a new game made
 * from the target, not saved yet. Null when the game asked for isn't there any more.
 */
export function loadedOf(
  target: GameTarget,
  games: readonly GameEntry[],
): {
  game: Game;
  builtIn: boolean;
  edited: boolean;
  saved: boolean;
  taken?: string[];
} | null {
  if (target.kind === 'new') {
    const taken = games.map((g) => g.game.id);
    const game = newGame(target.name, taken, target.steamAppId);
    return { game, builtIn: false, edited: false, saved: false, taken };
  }
  const entry = games.find((g) => g.game.id === target.gameId);
  if (entry === undefined) return null;
  return { game: entry.game, builtIn: entry.builtIn, edited: entry.edited === true, saved: true };
}
