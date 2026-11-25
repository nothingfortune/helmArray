// The Game screen's *Read from the game's file*, as words: what a read of the game's own file
// changes in the game's data (core's mergeHarvest), as one plain list to read before it is saved,
// and whether there is anything to save at all. Pure.

import type { Game, HarvestChange, HarvestField, PadControl, Role, Signal } from '@helmarray/core';
import { mergeHarvest } from '@helmarray/core';
import type { GameFileRead } from '../../shared/api';
import { padWord, signalText } from './editor-view';
import { ROLE_WORDS } from './role-words';

/** What a read leaves for the screen to show: why it couldn't, nothing to save, or the list. */
export type FileReadView =
  | { kind: 'failed'; message: string }
  /** Nothing to save; `lines` says what of yours stays though the file differs. */
  | { kind: 'same'; message: string; lines: string[] }
  | { kind: 'changes'; game: Game; lines: string[] };

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

/**
 * The list, in the order a person checks it: the file's format, modes, then each action's
 * changes in the game's order, the new actions by mode, what of yours stays, and what the file no
 * longer has. `after` is the data as it would be.
 */
export function readLines(changes: readonly HarvestChange[], after: Game): string[] {
  const lines: string[] = [];
  const added = new Map<string, string[]>();
  const kept: string[] = [];
  const gone: string[] = [];
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
    }
  }
  for (const [mode, list] of added) {
    const modeName = after.modes.find((m) => m.id === mode)?.name ?? mode;
    const count = list.length === 1 ? '1 new action' : `${list.length} new actions`;
    lines.push(`${count} in ${modeName}: ${names(list)}.`);
  }
  if (gone.length > 0)
    lines.push(
      `${names(gone)} ${gone.length === 1 ? "isn't" : "aren't"} in the file any more, and ${gone.length === 1 ? 'stays' : 'stay'}.`,
    );
  return [...lines, ...kept];
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

/** What a read of the game's file means for the game as the screen has it. */
export function fileReadView(game: Game, read: GameFileRead): FileReadView {
  if (!read.ok) return { kind: 'failed', message: read.message };
  const merged = mergeHarvest(game, read.file, read.held);
  const lines = readLines(merged.changes, merged.game);
  if (sameData(merged.game, game))
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
  };
}
