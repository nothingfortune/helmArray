// The Game screen's edits, as pure functions on a game: its name, its modes and its actions, and
// each action's defaults. Every one returns a new game and leaves the one it was given alone. The
// screen checks the result with core's `gameProblem` before it saves it.

import type {
  Action,
  ActionId,
  ActionUse,
  Game,
  ModeId,
  PadControl,
  Scheme,
  Signal,
} from '@helmarray/core';
import { idFromName, isDataId } from '@helmarray/core';
import type { GameEntry, Preset } from '../../shared/api';
import { isSafeId } from '../../shared/ids';
import { commit } from './editor-model';
import type { History } from './editor-model';

/** Which game the Game screen opens on. */
export type GameTarget =
  | { kind: 'edit'; gameId: string }
  /**
   * A game helmArray doesn't have yet: from a Steam tile (its name and app id, and why its own
   * file couldn't be used, when it has one helmArray reads), or by name.
   */
  | { kind: 'new'; name: string; steamAppId?: number; note?: string }
  /**
   * A game read from its own file and deleted since, set up again from its Steam tile: its file is
   * read afresh (`restoreGame`), and the game found opened. A new game from the tile's name and app
   * id should the file be gone meanwhile.
   */
  | { kind: 'restore'; gameId: string; name: string; steamAppId?: number };

/** The mode a new game starts with: one is needed, and most games have only one. */
const FIRST_MODE = { id: 'default', name: 'Default' };

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

/** Ids no new mode or action may take, besides the game's own: those its saved schemes name. */
export interface Reserved {
  modes: readonly string[];
  actions: readonly string[];
}
const NONE: Reserved = { modes: [], actions: [] };

/**
 * An id is free when nothing has it, nothing had it (the game's retired ids) and no saved scheme
 * names it (a copy of a built-in game dropped forgets what it retired; its schemes don't).
 */
const freeId =
  (live: readonly { id: string }[], ...gone: (readonly string[])[]) =>
  (id: string) =>
    isDataId(id) && !live.some((t) => t.id === id) && !gone.some((list) => list.includes(id));

const retiredOf = (game: Game): Reserved => game.retired ?? NONE;

/** The game with these ids retired too, each once. */
function retire(game: Game, modes: readonly string[], actions: readonly string[]): Game {
  const before = retiredOf(game);
  return {
    ...game,
    retired: {
      modes: [...new Set([...before.modes, ...modes])],
      actions: [...new Set([...before.actions, ...actions])],
    },
  };
}

/** Every mode and action the schemes name: never given to anything new in their game. */
export function referencedIds(schemes: readonly Scheme[]): Reserved {
  const modes = new Set<string>();
  const actions = new Set<string>();
  for (const scheme of schemes) {
    for (const [mode, controls] of Object.entries(scheme.map)) {
      modes.add(mode);
      for (const presses of Object.values(controls))
        for (const action of Object.values(presses)) if (action !== undefined) actions.add(action);
    }
  }
  return { modes: [...modes], actions: [...actions] };
}

/** Where the schemes place each action, in each mode: a read of the game's file keeps those modes. */
export function usesOf(schemes: readonly Scheme[]): ActionUse[] {
  const uses: ActionUse[] = [];
  for (const scheme of schemes)
    for (const [mode, controls] of Object.entries(scheme.map))
      for (const presses of Object.values(controls))
        for (const action of Object.values(presses))
          if (action !== undefined) uses.push({ mode, action });
  return uses;
}

/**
 * Adds an action at the end of its mode: its name trimmed, not required, and no defaults and no
 * role yet. The role is chosen, never guessed: a wrong colour reads as a fact.
 */
export function addAction(
  game: Game,
  mode: ModeId,
  name: string,
  reserved: Reserved = NONE,
): { game: Game; id: ActionId } {
  const trimmed = name.trim();
  const id = idFromName(
    trimmed,
    freeId(game.actions, retiredOf(game).actions, reserved.actions),
    'action',
  );
  const action: Action = { id, name: trimmed, mode, required: false };
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
    ...(action.role === undefined ? {} : { role: action.role }),
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

/** Deletes an action. Its id is retired: never given to another action of this game. */
export const deleteAction = (game: Game, id: ActionId): Game =>
  game.actions.some((a) => a.id === id)
    ? retire({ ...game, actions: game.actions.filter((a) => a.id !== id) }, [], [id])
    : game;

/** Adds a mode at the end. Its id is a key of every setup's map, so never an inherited name. */
export function addMode(
  game: Game,
  name: string,
  reserved: Reserved = NONE,
): { game: Game; id: ModeId } {
  const trimmed = name.trim();
  const id = idFromName(trimmed, freeId(game.modes, retiredOf(game).modes, reserved.modes), 'mode');
  return { game: { ...game, modes: [...game.modes, { id, name: trimmed }] }, id };
}

/**
 * Whether the modes are shown at all. A game with one mode has nothing to tell apart: it shows no
 * tab and no mode name until *Add mode*. Unless that mode has no name: the game isn't saved until
 * it has one, so its field is shown to type it in.
 */
export const showsModes = (game: Game): boolean =>
  game.modes.length > 1 || game.modes.some((m) => m.name.trim() === '');

/**
 * *Add mode*: a mode named for its place (*Mode 2*), at the end. A first mode still called by the
 * name a new game starts with is named *Mode 1* with it, in the same step: until now that name was
 * never shown, and two tabs need two names.
 */
export function addNextMode(game: Game, reserved: Reserved = NONE): { game: Game; id: ModeId } {
  const first = game.modes[0];
  const named =
    game.modes.length === 1 && first !== undefined && first.name === FIRST_MODE.name
      ? renameMode(game, first.id, 'Mode 1')
      : game;
  return addMode(named, `Mode ${game.modes.length + 1}`, reserved);
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

/**
 * Deletes a mode and its actions, retiring all their ids. The last mode stays: a game has at
 * least one.
 */
export function deleteMode(game: Game, id: ModeId): Game {
  if (game.modes.length <= 1 || !game.modes.some((m) => m.id === id)) return game;
  return retire(
    {
      ...game,
      modes: game.modes.filter((m) => m.id !== id),
      actions: game.actions.filter((a) => a.mode !== id),
    },
    [id],
    game.actions.filter((a) => a.mode === id).map((a) => a.id),
  );
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
  schemes: readonly Scheme[] = [],
): {
  game: Game;
  builtIn: boolean;
  edited: boolean;
  saved: boolean;
  found?: boolean;
  readsFile?: boolean;
  taken?: string[];
  reserved?: Reserved;
  uses?: ActionUse[];
  setupsOff?: number;
  note?: string;
} | null {
  const entry = target.kind === 'new' ? undefined : games.find((g) => g.game.id === target.gameId);
  if (target.kind === 'new' || (target.kind === 'restore' && entry === undefined)) {
    const taken = games.map((g) => g.game.id);
    const game = newGame(target.name, taken, target.steamAppId);
    return {
      game,
      builtIn: false,
      edited: false,
      saved: false,
      taken,
      ...(target.kind === 'new' && target.note !== undefined ? { note: target.note } : {}),
    };
  }
  if (entry === undefined) return null;
  const off = schemes.filter((s) => !s.writeGameFile).length;
  return {
    game: entry.game,
    builtIn: entry.builtIn,
    edited: entry.edited === true,
    // A game read from its file just now is saved at its first edit, under the id it has.
    saved: entry.found !== true,
    ...(entry.found === true ? { found: true } : {}),
    ...(entry.readsFile === true ? { readsFile: true } : {}),
    reserved: referencedIds(schemes),
    uses: usesOf(schemes),
    // The setups made before the game had its file format: a read that gives it one turns them on.
    ...(off === 0 ? {} : { setupsOff: off }),
  };
}
