// The Game screen's *Read from the game's file*, as words: what a read of the game's own file
// changes in the game's data (core's mergeHarvest), as one plain list to read before it is saved,
// and whether there is anything to save at all. Pure.

import type {
  ActionMove,
  ActionUse,
  Game,
  HarvestChange,
  HarvestField,
  PadControl,
  Role,
  Signal,
} from '@helmarray/core';
import { mergeHarvest } from '@helmarray/core';
import type { GameFileRead } from '../../shared/api';
import { padWord, signalText } from './editor-view';
import { ROLE_WORDS } from './role-words';

/** What a read leaves for the screen to show: why it couldn't, nothing to save, or the list. */
export type FileReadView =
  | { kind: 'failed'; message: string }
  /** Nothing to save; `lines` says what of yours stays though the file differs. */
  | { kind: 'same'; message: string; lines: string[] }
  /**
   * `moves`: the actions of yours that took the file's ids, for main to follow when it saves.
   * `fileOn`: how many of the game's setups the read turns file writing on for (made before the
   * game had its file format), when there are some: main turns them on as it saves.
   */
  | { kind: 'changes'; game: Game; lines: string[]; moves: ActionMove[]; fileOn?: number };

/** How many new actions of one mode are named before the rest are counted. */
const NAMED = 5;

/** A field's name in a line; a name and *required* are said their own way. */
const FIELD_WORDS: Readonly<Record<Exclude<HarvestField, 'name' | 'required'>, string>> = {
  mode: 'mode',
  role: 'role',
  key: 'default key',
  pad: 'default controller button',
};

/** A value of a field in words: a key's caption, a button's, a role's name, a mode's. */
function valueWords(game: Game, field: HarvestField, value: unknown): string {
  if (value === undefined) return 'none';
  switch (field) {
    case 'key':
      return signalText(value as Signal);
    case 'pad':
      return `Xbox ${padWord(value as PadControl)}`;
    case 'role':
      return ROLE_WORDS[value as Role];
    case 'mode':
      return game.modes.find((m) => m.id === value)?.name ?? String(value);
    case 'required':
      return value === true ? 'required' : 'not required';
    case 'name':
      return String(value);
  }
}

/** A list of names: `A`, `A and B`, `A, B and C`, past five `A, B, C, D, E and 12 more`. */
function names(list: readonly string[]): string {
  const more = list.length - NAMED;
  if (more > 0) return `${list.slice(0, NAMED).join(', ')} and ${more} more`;
  // Stryker disable next-line StringLiteral: names is only given a list with a name in it, so it always has a last
  const last = list.at(-1) ?? '';
  return list.length === 1 ? last : `${list.slice(0, -1).join(', ')} and ${last}`;
}

/** One line for a field the file changed. */
function changedLine(game: Game, c: Extract<HarvestChange, { kind: 'changed' }>): string {
  const to = valueWords(game, c.field, c.to);
  switch (c.field) {
    case 'name':
      return `${String(c.from)} is now called ${to}.`;
    case 'mode':
      return `${c.name} moves to ${to}.`;
    case 'required':
      return c.to === true ? `${c.name} is now required.` : `${c.name} is no longer required.`;
    default:
      return `${c.name}: ${FIELD_WORDS[c.field]} ${valueWords(game, c.field, c.from)} → ${to}.`;
  }
}

/** One line for a field of yours that stays, though the file has another value. */
function keptLine(game: Game, c: Extract<HarvestChange, { kind: 'kept' }>): string {
  const file = valueWords(game, c.field, c.file);
  switch (c.field) {
    case 'name':
      return `${c.name} keeps the name you gave it (the file calls it ${file}).`;
    case 'required':
      return `${c.name} stays ${valueWords(game, c.field, c.yours)}, as you set it (the file says ${file}).`;
    default:
      return `${c.name} keeps your ${FIELD_WORDS[c.field]}, ${valueWords(game, c.field, c.yours)} (the file has ${file}).`;
  }
}

/** The fields of yours a move keeps, as the line says them: the name is said by the line itself. */
const MOVE_WORDS: Readonly<Partial<Record<HarvestField, string>>> = {
  role: 'role',
  key: 'key',
  pad: 'controller button',
};

/**
 * One line for an action of yours that moves to the mode the file has it in: "Boost moves to
 * Flight, where the game's file has it; your key stays."
 */
function movedLine(after: Game, c: Extract<HarvestChange, { kind: 'same-name' }>): string {
  const mode = valueWords(after, 'mode', c.mode);
  const words = c.kept.flatMap((f) => {
    const word = MOVE_WORDS[f];
    return word === undefined ? [] : [word];
  });
  const parts: string[] = [];
  if (words.length > 0) parts.push(`your ${names(words)} ${words.length === 1 ? 'stays' : 'stay'}`);
  if (c.kept.includes('required')) {
    const required = after.actions.find((a) => a.id === c.file)?.required === true;
    parts.push(`it stays ${required ? 'required' : 'not required'}`);
  }
  const rest = parts.length === 0 ? '' : `; ${parts.join(', and ')}`;
  return `${c.name} moves to ${mode}, where the game's file has it${rest}.`;
}

/**
 * The list, in the order a person checks it: the file's format, modes, then each action's
 * changes in the game's order, whether the sticks must send keys, the new actions by mode, what the
 * file no longer has, the actions you typed in that the file has too (in the same mode, then each
 * one that moves to the file's mode, then each whose name the file has more than once), a mode of
 * yours left empty, and what of yours stays. `after` is the data as it would be.
 */
export function readLines(changes: readonly HarvestChange[], after: Game): string[] {
  const lines: string[] = [];
  const added = new Map<string, string[]>();
  const kept: string[] = [];
  const gone: string[] = [];
  const typed: string[] = [];
  const moved: string[] = [];
  const several: string[] = [];
  const removed: string[] = [];
  let keyStick = false;
  for (const c of changes) {
    switch (c.kind) {
      case 'format':
        lines.push("Apply can write the game's controls file from now on.");
        break;
      case 'mode-added':
        lines.push(`New mode: ${c.name}.`);
        break;
      case 'mode-renamed':
        lines.push(`The mode ${c.from} is now called ${c.to}.`);
        break;
      case 'changed':
        lines.push(changedLine(after, c));
        break;
      case 'added':
        added.set(c.mode, [...(added.get(c.mode) ?? []), c.name]);
        break;
      case 'kept':
        kept.push(keptLine(after, c));
        break;
      case 'gone':
        gone.push(c.name);
        break;
      case 'same-name':
        if (c.from === c.mode) typed.push(c.name);
        else moved.push(movedLine(after, c));
        break;
      case 'same-name-several': {
        const modes = c.modes.map((m) => valueWords(after, 'mode', m));
        several.push(
          `${c.name} is in the file more than once (${names(modes)}): yours stays as it is, beside the file's.`,
        );
        break;
      }
      case 'mode-removed':
        removed.push(`The mode ${c.name} goes: nothing is left in it.`);
        break;
      case 'key-stick':
        keyStick = true;
        break;
    }
  }
  if (keyStick) lines.push(`${after.name} plays on keys: from now on its sticks must send keys.`);
  for (const [mode, list] of added) {
    const modeName = after.modes.find((m) => m.id === mode)?.name ?? mode;
    const count = list.length === 1 ? '1 new action' : `${list.length} new actions`;
    lines.push(`${count} in ${modeName}: ${names(list)}.`);
  }
  if (gone.length > 0)
    lines.push(
      `${names(gone)} ${gone.length === 1 ? "isn't" : "aren't"} in the file any more, and ${gone.length === 1 ? 'stays' : 'stay'}.`,
    );
  // Typed in by hand under a name the file has too: one line for all of them.
  if (typed.length > 0)
    lines.push(
      typed.length === 1
        ? `${names(typed)} is in the file too: yours stays, and the file's isn't added beside it.`
        : `${names(typed)} are in the file too: yours stay, and the file's aren't added beside them.`,
    );
  return [...lines, ...moved, ...several, ...removed, ...kept];
}

/** Whether two games are the same data, whatever the order of each object's keys. */
const sameData = (a: Game, b: Game): boolean => {
  const canon = (g: Game) =>
    JSON.stringify(g, (_k, v: unknown) =>
      typeof v === 'object' && v !== null && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)))
        : v,
    );
  return canon(a) === canon(b);
};

/** The setups that will write the game's file from now on, in one line. */
const setupsLine = (game: Game, n: number): string =>
  `Your ${n === 1 ? 'setup' : `${n} setups`} for ${game.name} will now write its controls file.`;

/**
 * What a read of the game's file means for the game as the screen has it. `uses`: where the game's
 * setups place its actions, so a mode of yours one still places something in stays. `setups`: how
 * many of the game's setups don't write its file (made before it had a format): with the format,
 * the read turns them on, and says so after the format's line.
 */
export function fileReadView(
  game: Game,
  read: GameFileRead,
  uses: readonly ActionUse[] = [],
  setups = 0,
): FileReadView {
  if (!read.ok) return { kind: 'failed', message: read.message };
  let merged: ReturnType<typeof mergeHarvest>;
  try {
    merged = mergeHarvest(game, read.file, read.held, uses);
  } catch {
    // A file with nothing usable in it: the merge refuses it, so nothing can be saved from it.
    return {
      kind: 'failed',
      message: `${game.name}'s controls file has nothing helmArray can read.`,
    };
  }
  const lines = readLines(merged.changes, merged.game);
  const fileOn = merged.game.file === undefined ? 0 : setups;
  if (fileOn > 0) {
    const format = lines.indexOf("Apply can write the game's controls file from now on.");
    lines.splice(format + 1, 0, setupsLine(merged.game, fileOn));
  }
  if (sameData(merged.game, game) && fileOn === 0)
    return {
      kind: 'same',
      message: `Nothing to change from ${game.name}'s file.`,
      lines,
    };
  return {
    kind: 'changes',
    game: merged.game,
    // Only the last read moved (the file is as it was, less what helmArray wrote): said so.
    lines:
      lines.length > 0
        ? lines
        : ['Nothing you see changes: helmArray notes what the file has now.'],
    moves: merged.moves,
    ...(fileOn === 0 ? {} : { fileOn }),
  };
}
