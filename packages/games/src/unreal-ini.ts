// Everspace 2's Input.ini: find it, harvest the game's bindings from it, and write a setup's into it.
//
// The file (reference/game-files/everspace2-Input.before.ini) has no `ActionMappings` or
// `AxisMappings`. Under `[/Script/ES2.CustomPlayerInput]` it holds one `KeybindingsConfig=(...)`
// line per binding row per input group: `Keyboard` (keys and the mouse), `Gamepad` and `Joystick`.
// A row is an `Action` with a `Scale`: `MoveForward` at 1 is "Thrust forward", at -1 "Thrust
// backward". `bIsAxis=True` rows take an analog axis (`Gamepad_LeftY`, `MouseX`). Each line has two
// slots, `Key1` and `Key2`, each with a modifier (`Key1Mod`).
//
// What helmArray manages, and how:
// - Every row that isn't an axis is an action, named by its `DisplayName` (the game's words).
// - The keyboard set is the `Keyboard` line's two slots, the controller set the `Gamepad` line's.
//   A slot holding something helmArray can't name (an axis, a controller chord) is kept as it is.
// - `Joystick` lines are never touched: they are the owner's other devices (and later the pedals).
// - A controller stick reaches a row through its axis row: `Gamepad_LeftY` on `MoveForward`'s axis
//   row is "Thrust forward" on LS_UP and "Thrust backward" on LS_DOWN. Harvest reads it so. A write
//   that keeps both halves there leaves the axis row alone; one that moves either takes the stick
//   off the axis row and binds each half on its own line. Where a half also has a controller
//   binding of its own (the menus: Navigate up on the D-pad and the left stick), the stick isn't
//   helmArray's: the axis row stays as it is, and harvest lists it as kept. So do the mouse's axes
//   and an axis held with a button (`Roll` on the right stick with RS held).
// - Every other line, the header and the blank lines at the end are kept byte for byte.
//
// Where the game keeps the file (legacy repo, games/SpaceSims/everspace/game.yaml):
// `%LOCALAPPDATA%/ES2/Saved/Config/Windows/Input.ini`. The game rewrites it on exit: it must be
// closed before the file is written (the app's job, not this module's).

import type {
  Action,
  ActionId,
  BindingSet,
  Game,
  GameBinding,
  Mode,
  PadControl,
  Role,
  Signal,
} from '@helmarray/core';
import type { FolderReader, Line, Slot } from './game-file';
import {
  GameFileError,
  groupOf,
  assignSlots,
  entryOf,
  idMaker,
  joinLines,
  keepSeconds,
  linesOf,
  setOf,
  signalWords,
  takenBy,
  wantedByAction,
} from './game-file';
import type { UnrealKey } from './unreal-keys';
import { signalOfUnreal, unrealKeyOf } from './unreal-keys';

const SECTION = '[/Script/ES2.CustomPlayerInput]';
const ENTRY = 'KeybindingsConfig=(';

/** One field of a line: its raw value and where that value sits in the line. */
interface Field {
  value: string;
  start: number;
  end: number;
}

/** A `KeybindingsConfig` line this module can read. */
interface RowLine {
  index: number;
  fields: Map<string, Field>;
  slots: [UnrealKey, UnrealKey];
}

/** One binding row: an action at a scale, or an axis, with its line in each input group. */
interface Row {
  action: string;
  category: string;
  isAxis: boolean;
  scale: number;
  lines: Map<string, RowLine>;
}

/** A quoted value without its quotes; any other as it is. */
const unquote = (value: string): string => value.replace(/^"(.*)"$/, '$1');

/** The fields of `Name=(a=1,b="x, y",c=F("p", "q"))`, from the first after the parenthesis. */
function fieldsOf(text: string, from: number): Map<string, Field> | null {
  const fields = new Map<string, Field>();
  /** A field is `name=value`; a part with no `=` is a field with no name, which nothing reads. */
  const add = (start: number, end: number): void => {
    const eq = text.slice(start, end).indexOf('=');
    fields.set(text.slice(start, start + eq), {
      value: text.slice(start + eq + 1, end),
      start: start + eq + 1,
      end,
    });
  };
  let depth = 0;
  let quoted = false;
  let start = from;
  // Stryker disable next-line EqualityOperator: one step past the end reads no character, and no character is a quote, a parenthesis or a comma
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '(') depth++;
    else if (c === ')' && depth > 0) depth--;
    else if (c === ')') {
      add(start, i);
      return fields;
    } else if (c === ',' && depth === 0) {
      add(start, i);
      start = i + 1;
    }
  }
  return null;
}

/** A line without these isn't one this module can read, and is left as it is. */
const REQUIRED_FIELDS = [
  'Action',
  'Category',
  'bIsAxis',
  'Scale',
  'GroupName',
  'Key1',
  'Key1Mod',
  'Key2',
  'Key2Mod',
];

/** The last quoted text of `NSLOCTEXT("ns", "key", "Boost [HOLD]")`: what the game shows. */
function displayText(line: RowLine | undefined): string | null {
  const value = line?.fields.get('DisplayName')?.value;
  if (value === undefined) return null;
  const last = [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)].at(-1);
  const text = last === undefined ? '' : groupOf(last, 1).trim();
  return text === '' ? null : text;
}

/** A row's name in the game's words: its keyboard line's, else the first line's that has one. */
function nameOf(row: Row): string {
  const lines = [row.lines.get('Keyboard'), ...row.lines.values()];
  return lines.map(displayText).find((text) => text !== null) ?? row.action;
}

/**
 * The binding rows of the file, in the order they first appear. A row is its action, category,
 * scale and whether it is an axis; it has one line per input group, the first the file has.
 */
function rowsOf(lines: readonly Line[]): Row[] {
  const rows = new Map<string, Row>();
  let section: string | null = null;
  lines.forEach((line, index) => {
    if (line.text.startsWith('[')) section = line.text.trim();
    if (section !== SECTION || !line.text.startsWith(ENTRY)) return;
    const fields = fieldsOf(line.text, ENTRY.length);
    if (fields === null || REQUIRED_FIELDS.some((name) => !fields.has(name))) return;
    // Stryker disable next-line StringLiteral: every field read here is a required one, checked above, so the default is never used
    const get = (name: string): string => unquote(fields.get(name)?.value ?? '');
    const slot = (n: 1 | 2): UnrealKey => ({ key: get(`Key${n}`), mod: get(`Key${n}Mod`) });
    const action = get('Action');
    const category = get('Category');
    const isAxis = get('bIsAxis') === 'True';
    const scale = Number(get('Scale'));
    const identity = JSON.stringify([action, category, isAxis, scale]);
    const row = rows.get(identity) ?? { action, category, isAxis, scale, lines: new Map() };
    const group = get('GroupName');
    if (!row.lines.has(group)) row.lines.set(group, { index, fields, slots: [slot(1), slot(2)] });
    rows.set(identity, row);
  });
  return [...rows.values()];
}

// --- modes, roles, required ----------------------------------------------------------------

/**
 * The game's categories as modes. 0-3 (flight, combat and ship, opening menus, system) are live
 * together while flying, and 7 (screenshot, TrackIR) with them; 4 and 5 are the menus, which reuse
 * flight keys on purpose; 6 is photo mode (legacy games/SpaceSims/everspace/game.yaml).
 */
const MODES: readonly (Mode & { categories: readonly string[] })[] = [
  { id: 'flight', name: 'Flight', categories: ['0', '1', '2', '3', '7'] },
  { id: 'menus', name: 'Menus', categories: ['4', '5'] },
  { id: 'photo', name: 'Photo mode', categories: ['6'] },
];

function modeOf(category: string): Mode {
  const known = MODES.find((mode) => mode.categories.includes(category));
  if (known !== undefined) return { id: known.id, name: known.name };
  return { id: `category_${category.replace(/[^A-Za-z0-9]/g, '')}`, name: `Category ${category}` };
}

function roleOf(row: Row): Role | undefined {
  if (['2', '4', '5'].includes(row.category)) return 'menu';
  if (/Cruise|Travel/.test(row.action)) return 'travel';
  if (row.category === '0') return 'movement';
  if (/Fire|Target|Primary|Secondary/.test(row.action)) return 'combat';
  if (/Consumable|Device|ShipAbility/.test(row.action)) return 'ability';
  return undefined;
}

/** What no flight can do without: thrust and strafe (both ways), and the primary weapon. */
const REQUIRED = new Set(['0:MoveForward', '0:MoveRight', '1:FirePrimary']);

// --- the sticks through axis rows -----------------------------------------------------------

/** A controller stick's axis, and the direction its positive and negative ends are. */
const STICK_AXES: ReadonlyMap<string, readonly [PadControl, PadControl]> = new Map([
  ['Gamepad_LeftX', ['LS_RIGHT', 'LS_LEFT']],
  ['Gamepad_LeftY', ['LS_UP', 'LS_DOWN']],
  ['Gamepad_RightX', ['RS_RIGHT', 'RS_LEFT']],
  ['Gamepad_RightY', ['RS_UP', 'RS_DOWN']],
] as const);

/** An axis row's stick, when its controller line holds one plain stick axis and nothing else. */
interface Stick {
  row: Row;
  line: RowLine;
  slot: 1 | 2;
  ends: readonly [PadControl, PadControl];
  /** A negative scale or `bInvert` turns the axis round; both turn it back. */
  flipped: boolean;
}

function stickOf(row: Row): Stick | null {
  const line = row.lines.get('Gamepad');
  if (!row.isAxis || line === undefined) return null;
  const used = line.slots.flatMap((s, i) =>
    s.key === 'None' ? [] : [{ s, slot: (i + 1) as 1 | 2 }],
  );
  const only = used.length === 1 ? used[0] : undefined;
  const ends = only === undefined ? undefined : STICK_AXES.get(only.s.key);
  if (only === undefined || ends === undefined || only.s.mod !== 'None') return null;
  const inverted = line.fields.get('bInvert')?.value === 'True';
  return { row, line, slot: only.slot, ends, flipped: row.scale < 0 !== inverted };
}

/** The stick direction an axis row gives a row that isn't an axis: its half of the stick. */
function halfOf(stick: Stick, row: Row): PadControl {
  return row.scale < 0 !== stick.flipped ? stick.ends[1] : stick.ends[0];
}

/** The rows an axis row drives: the rows of its action, in its category, that aren't axes. */
const halvesOf = (rows: readonly Row[], axis: Row): Row[] =>
  rows.filter((row) => !row.isAxis && row.action === axis.action && row.category === axis.category);

/** The axis rows that drive a row. */
const axesOf = (rows: readonly Row[], half: Row): Row[] =>
  rows.filter((axis) => axis.isAxis && halvesOf([half], axis).length > 0);

/**
 * The sticks helmArray manages, by the rows they drive: an axis row whose controller line holds one
 * plain stick axis, where no row it drives has a controller binding of its own. Where one does
 * (the menus: Navigate up on the D-pad, and on the left stick through its axis row), the stick is
 * left as the game has it and listed as kept: moving Navigate up moves its own binding only.
 */
const sticksOf = (rows: readonly Row[]): Map<Row, Stick> => {
  const out = new Map<Row, Stick>();
  for (const axis of rows) {
    const stick = stickOf(axis);
    const halves = halvesOf(rows, axis);
    const own = halves.some((half) =>
      (half.lines.get('Gamepad')?.slots ?? []).some((slot) => slot.key !== 'None'),
    );
    if (stick !== null && !own) for (const half of halves) out.set(half, stick);
  }
  return out;
};

// --- reading --------------------------------------------------------------------------------

const describeKey = (key: UnrealKey): string =>
  key.mod === 'None' ? key.key : `${key.key} with ${key.mod} held`;

const SETS: readonly BindingSet[] = ['keyboard', 'controller'];

/** The group each binding set lives in. */
const GROUPS: Readonly<Record<BindingSet, string>> = {
  keyboard: 'Keyboard',
  controller: 'Gamepad',
};

/** A row's slots in one set: a slot holding a signal of the other set is kept, not read. */
function slotsOf(row: Row, set: BindingSet): Slot[] {
  return (row.lines.get(GROUPS[set])?.slots ?? []).map((key): Slot => {
    const signal = signalOfUnreal(key);
    if (signal === 'empty') return { state: 'empty' };
    return signal !== null && setOf(signal) === set ? { state: 'read', signal } : { state: 'kept' };
  });
}

const readOf = (slots: readonly Slot[]): Signal[] =>
  slots.flatMap((slot) => (slot.state === 'read' ? [slot.signal] : []));

/** A row's controller bindings as the game has them: its half of a stick, else its own line's. */
function padOf(row: Row, sticks: ReadonlyMap<Row, Stick>): PadControl[] {
  const stick = sticks.get(row);
  return stick === undefined
    ? readOf(slotsOf(row, 'controller')).flatMap((s) => (s.kind === 'pad' ? [s.control] : []))
    : [halfOf(stick, row)];
}

const padSignals = (controls: readonly PadControl[]): Signal[] =>
  controls.map((control) => ({ kind: 'pad', control }));

/** The file's actions: every row that isn't an axis, with the id a harvest gives it. */
function actionsOf(rows: readonly Row[]): { id: ActionId; row: Row }[] {
  const id = idMaker();
  return rows
    .filter((row) => !row.isAxis)
    .map((row) => ({ id: id(row.scale < 0 ? `${row.action}.neg` : row.action), row }));
}

/**
 * A binding the game's data can't hold: one helmArray can't name (a chord, an axis), never touched
 * by a write; or a second key, which a write keeps unless it puts the action on nothing or the key
 * on another action of its mode.
 */
export interface KeptBinding {
  action: ActionId;
  set: BindingSet;
  /** The slot as the file has it: `Gamepad_RightX` with `Gamepad_RightThumbstick` held. */
  text: string;
}

export interface Harvest {
  game: Game;
  /** Bindings the file has that the game's data can't hold. */
  kept: KeptBinding[];
}

/** Where Everspace 2 keeps its Input.ini, under the user's local app data folder. */
const INI_PATH = ['ES2', 'Saved', 'Config', 'Windows', 'Input.ini'];

/**
 * The Input.ini the game reads, or null when there is none yet (the game writes it once a binding
 * is changed in its menu). `localAppData` holds the folders to look in, first found wins: the
 * user's `%LOCALAPPDATA%`, as the app finds it.
 */
export function findEverspace2Ini(
  localAppData: readonly string[],
  fs: FolderReader,
): string | null {
  for (const root of localAppData) {
    let path: string | null = root;
    for (const name of INI_PATH) path = path === null ? null : entryOf(fs, path, name);
    if (path !== null) return path;
  }
  return null;
}

/** What a row's lines hold that the game's data can't: what isn't read, and a second binding. */
function keptOf(
  action: ActionId,
  row: Row,
  rows: readonly Row[],
  sticks: ReadonlyMap<Row, Stick>,
): KeptBinding[] {
  const out: KeptBinding[] = [];
  for (const set of SETS) {
    const states = slotsOf(row, set);
    let first = true;
    (row.lines.get(GROUPS[set])?.slots ?? []).forEach((key, i) => {
      const state = states[i]?.state;
      if (state === 'kept' || (state === 'read' && !first))
        out.push({ action, set, text: describeKey(key) });
      if (state === 'read') first = false;
    });
  }
  // What the row's axis rows hold that helmArray doesn't manage: a mouse axis, a stick it leaves.
  for (const axis of axesOf(rows, row))
    for (const set of SETS) {
      if (set === 'controller' && sticks.get(row)?.row === axis) continue;
      for (const key of axis.lines.get(GROUPS[set])?.slots ?? [])
        if (key.key !== 'None') out.push({ action, set, text: `${describeKey(key)} (axis)` });
    }
  return out;
}

/**
 * The game as its Input.ini has it: the modes, every action in the game's words, and what each is
 * bound to on the keyboard and the controller. The game's id and name are the caller's.
 */
export function harvestUnrealIni(file: string, game: { id: string; name: string }): Harvest {
  const rows = rowsOf(linesOf(file));
  const sticks = sticksOf(rows);
  const modes = new Map<string, Mode>();
  const kept: KeptBinding[] = [];
  const actions = actionsOf(rows).map(({ id, row }): Action => {
    const mode = modeOf(row.category);
    modes.set(mode.id, mode);
    kept.push(...keptOf(id, row, rows, sticks));
    const key = readOf(slotsOf(row, 'keyboard'))[0];
    const pad = padOf(row, sticks)[0];
    const role = roleOf(row);
    return {
      id,
      name: nameOf(row),
      mode: mode.id,
      ...(role === undefined ? {} : { role }),
      required: REQUIRED.has(`${row.category}:${row.action}`),
      ...(key === undefined && pad === undefined
        ? {}
        : {
            native: {
              ...(key === undefined ? {} : { key }),
              ...(pad === undefined ? {} : { pad }),
            },
          }),
    };
  });
  return {
    game: {
      id: game.id,
      name: game.name,
      modes: [...modes.values()],
      actions,
      file: { format: 'unreal-ini' },
    },
    kept,
  };
}

// --- writing --------------------------------------------------------------------------------

/** A line with some slots changed: `Key<n>` and `Key<n>Mod` replaced in place, nothing else. */
function rewrite(line: RowLine, text: string, slots: ReadonlyMap<1 | 2, UnrealKey>): string {
  const edits: { field: Field; value: string }[] = [];
  for (const [n, key] of slots) {
    const keyField = line.fields.get(`Key${n}`);
    const modField = line.fields.get(`Key${n}Mod`);
    if (keyField !== undefined) edits.push({ field: keyField, value: key.key });
    if (modField !== undefined) edits.push({ field: modField, value: key.mod });
  }
  edits.sort((a, b) => b.field.start - a.field.start);
  let out = text;
  for (const { field, value } of edits)
    out = out.slice(0, field.start) + value + out.slice(field.end);
  return out;
}

const NONE: UnrealKey = { key: 'None', mod: 'None' };

/**
 * The file with the setup's bindings in it: for each action and binding set the rows name, the
 * set's slots hold exactly the rows' signals (a null row: nothing). An action or set with no rows
 * keeps what it has. Every line that doesn't change stays byte for byte. Throws a
 * `GameFileError` naming every row it can't write: an action the file doesn't have, a signal Unreal
 * has no name for, more than the two slots a line holds.
 */
export function writeUnrealIni(file: string, rows: readonly GameBinding[]): string {
  const lines = linesOf(file);
  const all = rowsOf(lines);
  const sticks = sticksOf(all);
  const byId = new Map(actionsOf(all).map(({ id, row }) => [id, row]));
  const taken = takenBy(rows, (id) => {
    const row = byId.get(id);
    return row === undefined ? undefined : modeOf(row.category).id;
  });
  const problems: string[] = [];
  /** Per line number: the line, and the slots that change on it. */
  const changes = new Map<number, { line: RowLine; slots: Map<1 | 2, UnrealKey> }>();
  const change = (line: RowLine, n: 1 | 2, key: UnrealKey): void => {
    const at = changes.get(line.index) ?? { line, slots: new Map<1 | 2, UnrealKey>() };
    changes.set(line.index, { line, slots: at.slots.set(n, key) });
  };

  /** Puts a set's wanted signals into a row's line, or says why not. */
  const place = (row: Row, set: BindingSet, list: readonly Signal[]): void => {
    const line = row.lines.get(GROUPS[set]);
    if (line === undefined) {
      if (list.length > 0) problems.push(`${nameOf(row)}: the file has no ${set} line for it.`);
      return;
    }
    const { slots, short } = assignSlots(
      keepSeconds(slotsOf(row, set), set, list, taken(modeOf(row.category).id)),
      new Map([[set, [...list]]]),
    );
    for (const signal of short)
      problems.push(
        `${nameOf(row)}: a line holds two bindings, so ${signalWords(signal)} doesn't fit.`,
      );
    slots.forEach((signal, i) => {
      if (signal === undefined) return;
      const key = signal === null ? NONE : unrealKeyOf(signal);
      if (typeof key === 'string') problems.push(`${nameOf(row)}: ${key}`);
      else change(line, (i + 1) as 1 | 2, key);
    });
  };

  const controller = new Map<Row, Signal[]>();
  for (const [id, sets] of wantedByAction(rows)) {
    const row = byId.get(id);
    if (row === undefined) {
      problems.push(`The file has no action "${id}".`);
      continue;
    }
    for (const [set, list] of sets) {
      for (const signal of list.filter((s) => setOf(s) !== set))
        problems.push(`${nameOf(row)}: ${signalWords(signal)} isn't a ${set} binding.`);
      if (set === 'keyboard') place(row, set, list);
      else controller.set(row, list);
    }
  }

  // The controller set, a stick at a time: a stick's halves move together or not at all.
  const handled = new Set<Stick>();
  for (const [row, list] of controller) {
    const stick = sticks.get(row);
    if (stick === undefined) {
      place(row, 'controller', list);
      continue;
    }
    if (handled.has(stick)) continue;
    handled.add(stick);
    const halves = [...sticks].filter(([, s]) => s === stick).map(([half]) => half);
    const want = (half: Row): Signal[] => controller.get(half) ?? padSignals(padOf(half, sticks));
    const stays = halves.every((half) => {
      const [only, ...more] = want(half);
      return more.length === 0 && only?.kind === 'pad' && only.control === halfOf(stick, half);
    });
    if (stays) continue;
    change(stick.line, stick.slot, NONE);
    for (const half of halves) place(half, 'controller', want(half));
  }

  if (problems.length > 0) throw new GameFileError(problems);
  return joinLines(
    lines.map((line, index) => {
      const at = changes.get(index);
      return at === undefined
        ? line
        : { text: rewrite(at.line, line.text, at.slots), end: line.end };
    }),
  );
}
