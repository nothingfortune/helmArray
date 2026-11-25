// What the two game file adapters share: the error they throw, the folder reader `find` is given,
// the lines of a file with their endings kept, and the ids they make from the game's own names.

import type { ActionId, BindingSet, GameBinding, Signal } from '@helmarray/core';

/**
 * Thrown when a file can't be read or written as asked. `problems` holds every reason, one plain
 * sentence each: a write that can't name three signals says all three, not the first.
 */
export class GameFileError extends Error {
  override readonly name = 'GameFileError';
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(problems.join(' '));
    this.problems = problems;
  }
}

/**
 * The folders `find` may look in, as the app hands them over. `find` reads nothing else: the app
 * passes the real disk, a test passes a fake or a temp folder.
 */
export interface FolderReader {
  /** The names in a folder, as the disk spells them; empty when there is no such folder. */
  list(dir: string): readonly string[];
  /** A file's text, or null when there is no such file. */
  read(path: string): string | null;
  /** A path inside a folder. */
  join(dir: string, ...names: string[]): string;
}

/** The entry of a folder named `name`, matched as Windows matches names: whatever the case. */
export function entryOf(fs: FolderReader, dir: string, name: string): string | null {
  const wanted = name.toLowerCase();
  const found = fs.list(dir).find((entry) => entry.toLowerCase() === wanted);
  return found === undefined ? null : fs.join(dir, found);
}

/** One line of a file: its text, and the ending it had (`\r\n`, `\n`, or none on the last). */
export interface Line {
  text: string;
  end: string;
}

/** A group of a regex that matched: text, whenever the group is one that always takes part. */
export function groupOf(match: RegExpMatchArray, n: number): string {
  // Stryker disable next-line StringLiteral: every group read through here always takes part in the match, so the default is never used
  return match[n] ?? '';
}

/** A file's lines, each with its own ending, so that joining them gives the file back exactly. */
export function linesOf(file: string): Line[] {
  const lines: Line[] = [];
  for (const match of file.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)) {
    if (match[0] === '') break;
    lines.push({ text: groupOf(match, 1), end: groupOf(match, 2) });
  }
  return lines;
}

export function joinLines(lines: readonly Line[]): string {
  return lines.map((line) => line.text + line.end).join('');
}

const ID_CHARS = /[^A-Za-z0-9_.-]/g;
const ID_LENGTH = 60;

/**
 * Makes ids for the game's own names, in file order. Core's `isDataId` is the contract: letters,
 * digits, `_`, `.` and `-`, a letter or digit first, at most 64 long, and never a name every
 * object inherits (`constructor`, `__proto__`). A name that is already such an id keeps it; any
 * other is made into one, and a clash takes `_2`, `_3` and so on. The same file always gives the
 * same ids, which is how a write finds the lines a harvest named.
 */
export function idMaker(): (name: string) => string {
  const taken = new Set<string>();
  return (name) => {
    const root =
      name
        .replace(ID_CHARS, '_')
        .replace(/^[^A-Za-z0-9]+/, '')
        .slice(0, ID_LENGTH) || 'action';
    let id = root;
    for (let n = 2; taken.has(id) || id in Object.prototype; n++) id = `${root}_${n}`;
    taken.add(id);
    return id;
  };
}

/** What a write is asked for one action: per binding set, the signals it should be on. */
export type Wanted = Map<BindingSet, Signal[]>;

/**
 * The rows grouped by action, in the order they came. A set with no rows for an action is not in
 * its map: the file keeps what it has there. A row whose signal is null asks for nothing, so a set
 * whose only row is null is an empty list: whatever the set had is cleared.
 */
export function wantedByAction(rows: readonly GameBinding[]): Map<ActionId, Wanted> {
  const out = new Map<ActionId, Wanted>();
  for (const row of rows) {
    const wanted = out.get(row.action) ?? new Map<BindingSet, Signal[]>();
    const list = wanted.get(row.set) ?? [];
    if (row.signal !== null) list.push(row.signal);
    wanted.set(row.set, list);
    out.set(row.action, wanted);
  }
  return out;
}

/** Which binding set a signal belongs to: Xbox controls are the controller's, the rest the keyboard's. */
export function setOf(signal: Signal): BindingSet {
  return signal.kind === 'pad' ? 'controller' : 'keyboard';
}

/** A signal as a comparable string; modifiers in any order are the same signal. */
export function signalKey(signal: Signal): string {
  switch (signal.kind) {
    case 'key': {
      // Stryker disable next-line StringLiteral,ArrayDeclaration: the default stands for no modifiers on both sides of every comparison, and ctrl, shift and alt joined with or without a separator are still distinct, so the separator changes nothing
      const mods = [...(signal.mods ?? [])].sort().join('+');
      return `key:${mods}+${signal.code}`;
    }
    case 'mouse':
      return `mouse:${signal.button}`;
    case 'scroll':
      return `scroll:${signal.dir}`;
    case 'pad':
      return `pad:${signal.control}`;
    case 'macro':
      // Stryker disable next-line StringLiteral: no file holds a macro, so a macro is never compared with anything its key could be confused with
      return `macro:${signal.trigger}`;
  }
}

/**
 * One place a file binds an action: Key1 or Key2 of an Unreal row, Primary or Secondary of an
 * Elite control. `empty` holds nothing; `read` holds a signal helmArray can name; `kept` holds
 * something helmArray doesn't manage (a joystick, the pedals, a chord it has no words for), which
 * no write ever touches.
 */
export type Slot = { state: 'empty' } | { state: 'read'; signal: Signal } | { state: 'kept' };

/**
 * What a write does to each slot of one action: `undefined` leaves it exactly as it is, a signal
 * puts that signal there, null empties it. A set the write isn't asked about keeps its slots. A
 * slot already on a signal the set wants keeps it, wherever it is, so a binding that doesn't change
 * never moves; the rest are emptied, and what is still wanted fills the empty slots in order,
 * keyboard first. `short` counts the signals that found no slot.
 */
export function assignSlots(
  slots: readonly Slot[],
  wanted: Wanted,
): { slots: (Signal | null | undefined)[]; short: Signal[] } {
  const out: (Signal | null | undefined)[] = slots.map(() => undefined);
  const remaining = new Map([...wanted].map(([set, list]) => [set, [...list]]));
  slots.forEach((slot, i) => {
    if (slot.state !== 'read') return;
    const want = remaining.get(setOf(slot.signal));
    if (want === undefined) return;
    const at = want.findIndex((s) => signalKey(s) === signalKey(slot.signal));
    if (at >= 0) want.splice(at, 1);
    else out[i] = null;
  });
  const free = slots.flatMap((slot, i) => (slot.state === 'empty' || out[i] === null ? [i] : []));
  const queue = [...(remaining.get('keyboard') ?? []), ...(remaining.get('controller') ?? [])];
  const short: Signal[] = [];
  for (const signal of queue) {
    const i = free.shift();
    if (i === undefined) short.push(signal);
    else out[i] = signal;
  }
  return { slots: out, short };
}

/**
 * The game's data holds one default per action and set, the first binding the file has; a second
 * (Elite's Secondary, Unreal's Key2) is what the file knows and the data doesn't. A write that puts
 * the action somewhere keeps such a second binding as it is, unless the write puts it on an action
 * of the mode (`taken`), this one included. A write that puts the action on nothing clears it.
 */
export function keepSeconds(
  slots: readonly Slot[],
  set: BindingSet,
  wanted: readonly Signal[],
  taken: (signal: Signal) => boolean,
): Slot[] {
  let first = true;
  return slots.map((slot): Slot => {
    if (slot.state !== 'read' || setOf(slot.signal) !== set) return slot;
    if (first || wanted.length === 0) {
      first = false;
      return slot;
    }
    return taken(slot.signal) ? slot : { state: 'kept' };
  });
}

/**
 * What a write puts on each signal, per mode: `taken(mode)(signal)` says whether any row puts the
 * signal on an action of that mode, whichever.
 */
export function takenBy(
  rows: readonly GameBinding[],
  modeOf: (action: ActionId) => string | undefined,
): (mode: string) => (signal: Signal) => boolean {
  const on = new Set<string>();
  for (const row of rows)
    if (row.signal !== null) on.add(JSON.stringify([modeOf(row.action), signalKey(row.signal)]));
  return (mode) => (signal) => on.has(JSON.stringify([mode, signalKey(signal)]));
}

/** Words for a signal in an error: `F13`, `Ctrl+Shift+A`, `the mouse's back button`. */
export function signalWords(signal: Signal): string {
  switch (signal.kind) {
    case 'key':
      return [
        ...(signal.mods ?? []).map((m) => m[0]?.toUpperCase() + m.slice(1)),
        signal.code,
      ].join('+');
    case 'mouse':
      return `the mouse's ${signal.button} button`;
    case 'scroll':
      return `scroll ${signal.dir}`;
    case 'pad':
      return `the controller's ${signal.control}`;
    case 'macro':
      return `a macro on ${signal.trigger}`;
  }
}
