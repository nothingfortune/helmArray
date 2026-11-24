// A game's data as a person adds and edits it in the app (docs/plans/01-features.md, *Game data*):
// its modes, its actions, and each action's default key and controller button. Pure: the app
// checks a game here before it saves one, and makes the ids of new modes and actions here.

import { isKeyCode } from './keys';
import type {
  ActionId,
  Game,
  GameFileFormat,
  ModeId,
  Mod,
  MouseButton,
  Role,
  ScrollDirection,
} from './model';
import { PAD_CONTROLS } from './model';

/** Every role, in the order the app lists them. */
export const ROLES: readonly Role[] = ['combat', 'movement', 'ability', 'travel', 'menu'];
export const MOUSE_BUTTONS: readonly MouseButton[] = ['left', 'middle', 'right', 'back', 'forward'];
const MODS: readonly Mod[] = ['ctrl', 'shift', 'alt'];
const SCROLLS: readonly ScrollDirection[] = ['up', 'down', 'left', 'right'];
const FORMATS: readonly GameFileFormat[] = ['unreal-ini', 'elite-binds'];

const DATA_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/**
 * Whether this can be the id of a mode or an action. Mode ids are keys of a scheme's map, so an
 * id is never a name every object inherits (`constructor`, `toString`): a lookup by it would find
 * the prototype's instead of nothing.
 */
export function isDataId(value: unknown): value is string {
  return typeof value === 'string' && DATA_ID.test(value) && !(value in Object.prototype);
}

/** The longest id `idFromName` makes before a count is added. */
const ID_ROOT_LENGTH = 40;

/**
 * An id for something new, made from its name: lower case, letters and digits joined by `_`,
 * accents dropped. When `isFree` refuses it (taken, or not usable), `_2`, `_3` and so on are
 * added. A name with nothing usable in it starts from `fallback`.
 */
export function idFromName(
  name: string,
  isFree: (id: string) => boolean,
  fallback: string,
): string {
  const root =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, ID_ROOT_LENGTH)
      .replace(/_+$/, '') || fallback;
  if (isFree(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}_${n}`;
    if (isFree(candidate)) return candidate;
  }
}

type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';
const oneOf = <T>(list: readonly T[], value: unknown): value is T =>
  (list as readonly unknown[]).includes(value);

/** A signal a game binds in its keyboard set: a key (with modifiers), a mouse button, a scroll. */
function isKeyboardSignal(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value['kind']) {
    case 'key': {
      const mods = value['mods'];
      return (
        typeof value['code'] === 'string' &&
        isKeyCode(value['code']) &&
        (mods === undefined || (Array.isArray(mods) && mods.every((m) => oneOf(MODS, m))))
      );
    }
    case 'mouse':
      return oneOf(MOUSE_BUTTONS, value['button']);
    case 'scroll':
      return (
        oneOf(SCROLLS, value['dir']) &&
        typeof value['speed'] === 'number' &&
        Number.isFinite(value['speed'])
      );
    default:
      return false;
  }
}

/** The first thing wrong with one action, or null. */
function actionProblem(value: unknown, modes: ReadonlySet<string>): string | null {
  if (!isRecord(value) || !isText(value['name'])) return 'Every action needs a name.';
  const name = value['name'].trim();
  if (!isDataId(value['id'])) return `${name} has an id helmArray can't use.`;
  if (typeof value['mode'] !== 'string' || !modes.has(value['mode']))
    return `${name} is in a mode the game doesn't have.`;
  if (!oneOf(ROLES, value['role']))
    return `${name} needs a role: combat, movement, ability, travel or menu.`;
  if (typeof value['required'] !== 'boolean') return `${name} must be required or not.`;
  const native = value['native'];
  if (native === undefined) return null;
  if (!isRecord(native) || (native['key'] !== undefined && !isKeyboardSignal(native['key'])))
    return `${name}'s default key isn't a key or mouse button helmArray knows.`;
  if (native['pad'] !== undefined && !oneOf(PAD_CONTROLS, native['pad']))
    return `${name}'s default controller button isn't one an Xbox controller has.`;
  return null;
}

/**
 * The first thing wrong with a game, in one plain sentence, or null when it can be saved. Read in
 * the order a person reads the game: its name, its modes, then each action. A game may have no
 * actions yet: it is being set up.
 */
export function gameProblem(game: unknown): string | null {
  if (!isRecord(game)) return "This isn't a game helmArray can read.";
  if (!isText(game['name'])) return 'The game needs a name.';
  const appId = game['steamAppId'];
  if (appId !== undefined && !(Number.isSafeInteger(appId) && (appId as number) > 0))
    return "The game's Steam id must be a whole number.";
  const file = game['file'];
  if (file !== undefined && !(isRecord(file) && oneOf(FORMATS, file['format'])))
    return "The game's file format isn't one helmArray knows.";
  if (game['needsKeyStick'] !== undefined && typeof game['needsKeyStick'] !== 'boolean')
    return 'Whether the sticks must send keys must be yes or no.';

  const modes = game['modes'];
  if (!Array.isArray(modes) || modes.length === 0) return 'The game needs at least one mode.';
  const modeIds = new Set<string>();
  for (const mode of modes) {
    if (!isRecord(mode) || !isText(mode['name'])) return 'Every mode needs a name.';
    if (!isDataId(mode['id']))
      return `The mode ${mode['name'].trim()} has an id helmArray can't use.`;
    if (modeIds.has(mode['id'])) return `Two modes have the same id, "${mode['id']}".`;
    modeIds.add(mode['id']);
  }

  const actions = game['actions'];
  if (!Array.isArray(actions)) return "The game's actions can't be read.";
  const actionIds = new Set<string>();
  for (const action of actions) {
    const problem = actionProblem(action, modeIds);
    if (problem !== null) return problem;
    const id = (action as Rec)['id'] as string;
    if (actionIds.has(id)) return `Two actions have the same id, "${id}".`;
    actionIds.add(id);
  }
  return null;
}

/**
 * Whether the game has this action in this mode. A setup names actions by id and is never
 * rewritten when the game is edited, so it can name one the game no longer has there: deleted,
 * gone with its mode, or moved to another mode. Such an action is on nothing.
 */
export function hasAction(game: Game, mode: ModeId, action: ActionId): boolean {
  return game.actions.some((a) => a.id === action && a.mode === mode);
}
