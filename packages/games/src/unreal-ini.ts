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
//   off the axis row and binds each half on its own line, so nothing stays on the stick unseen.
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
  assignSlots,
  entryOf,
  idMaker,
  joinLines,
  keepSeconds,
  linesOf,
  setOf,
  signalKey,
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
  axisName: string;
  category: string;
  isAxis: boolean;
  scale: number;
  lines: Map<string, RowLine>;
  name: string;
}

const unquote = (value: string): string =>
  value.startsWith('"') && value.endsWith('"') && value.length >= 2 ? value.slice(1, -1) : value;

/** The fields of `Name=(a=1,b="x, y",c=F("p", "q"))`, from the first after the parenthesis. */
function fieldsOf(text: string, from: number): Map<string, Field> | null {
  const fields = new Map<string, Field>();
  const add = (start: number, end: number): void => {
    const eq = text.indexOf('=', start);
    if (eq < 0 || eq >= end) return;
    fields.set(text.slice(start, eq), { value: text.slice(eq + 1, end), start: eq + 1, end });
  };
  let depth = 0;
  let quoted = false;
  let start = from;
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

const REQUIRED_FIELDS = ['Action', 'Category', 'bIsAxis', 'Scale', 'GroupName'];

/** The last quoted text of `NSLOCTEXT("ns", "key", "Boost [HOLD]")`: what the game shows. */
function displayText(field: Field | undefined): string | null {
  const texts = [...(field?.value ?? '').matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? '');
  const last = texts.at(-1)?.trim();
  return last === undefined || last === '' ? null : last;
}

/** The binding rows of the file, in the order they first appear. */
function rowsOf(lines: readonly Line[]): Row[] {
  const rows = new Map<string, Row>();
  let section = '';
  lines.forEach((line, index) => {
    if (line.text.startsWith('[')) section = line.text.trim();
    if (section !== SECTION || !line.text.startsWith(ENTRY)) return;
    const fields = fieldsOf(line.text, ENTRY.length);
    if (fields === null || REQUIRED_FIELDS.some((name) => !fields.has(name))) return;
    const get = (name: string): string => unquote(fields.get(name)?.value ?? '');
    const slot = (n: 1 | 2): UnrealKey => ({
      key: get(`Key${n}`) || 'None',
      mod: get(`Key${n}Mod`) || 'None',
    });
    const action = get('Action');
    const axisName = get('AxisName');
    const category = get('Category');
    const isAxis = get('bIsAxis') === 'True';
    const scale = Number(get('Scale'));
    const identity = JSON.stringify([action, get('ActionName'), axisName, category, isAxis, scale]);
    const row = rows.get(identity) ?? {
      action,
      axisName,
      category,
      isAxis,
      scale,
      lines: new Map<string, RowLine>(),
      name: '',
    };
    const group = get('GroupName');
    if (!row.lines.has(group)) row.lines.set(group, { index, fields, slots: [slot(1), slot(2)] });
    if (row.name === '' || group === 'Keyboard')
      row.name = displayText(fields.get('DisplayName')) ?? '';
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
  const n = category.replace(/[^0-9]/g, '') || '0';
  return { id: `category_${n}`, name: `Category ${n}` };
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
  sign: number;
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
  const inverted = unquote(line.fields.get('bInvert')?.value ?? '') === 'True';
  return { row, line, slot: only.slot, ends, sign: Math.sign(row.scale) * (inverted ? -1 : 1) };
}

/** The stick direction an axis row gives a row that isn't an axis: its half of the stick. */
function halfOf(stick: Stick, row: Row): PadControl {
  return Math.sign(row.scale) * stick.sign >= 0 ? stick.ends[0] : stick.ends[1];
}

const sticksOf = (rows: readonly Row[]): Map<Row, Stick> => {
  const out = new Map<Row, Stick>();
  for (const axis of rows) {
    const stick = stickOf(axis);
    if (stick === null) continue;
    for (const row of rows)
      if (
        !row.isAxis &&
        row.action === axis.action &&
        row.axisName === axis.axisName &&
        row.category === axis.category
      )
        out.set(row, stick);
  }
  return out;
};

// --- reading --------------------------------------------------------------------------------

/** The group each binding set lives in, and the kinds of signal it takes. */
const GROUPS: Readonly<Record<BindingSet, { group: string; takes: (s: Signal) => boolean }>> = {
  keyboard: { group: 'Keyboard', takes: (s) => setOf(s) === 'keyboard' },
  controller: { group: 'Gamepad', takes: (s) => setOf(s) === 'controller' },
};

function slotsOf(row: Row, set: BindingSet): Slot[] {
  const { group, takes } = GROUPS[set];
  const line = row.lines.get(group);
  if (line === undefined) return [];
  return line.slots.map((key): Slot => {
    const signal = signalOfUnreal(key);
    if (signal === 'empty') return { state: 'empty' };
    return signal !== null && takes(signal) ? { state: 'read', signal } : { state: 'kept' };
  });
}

const readOf = (slots: readonly Slot[]): Signal[] =>
  slots.flatMap((slot) => (slot.state === 'read' ? [slot.signal] : []));

/** A row's controller signals as the game has them: its own line's, else its half of a stick. */
function padOf(row: Row, sticks: ReadonlyMap<Row, Stick>): Signal[] {
  const own = readOf(slotsOf(row, 'controller'));
  const stick = sticks.get(row);
  return own.length > 0 || stick === undefined
    ? own
    : [{ kind: 'pad', control: halfOf(stick, row) }];
}

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
    for (const set of ['keyboard', 'controller'] as const) {
      const line = row.lines.get(GROUPS[set].group);
      let read = 0;
      slotsOf(row, set).forEach((slot, i) => {
        const key = line?.slots[i];
        if (slot.state === 'read') read++;
        if (key !== undefined && (slot.state === 'kept' || (read > 1 && slot.state === 'read')))
          kept.push({
            action: id,
            set,
            text: key.mod === 'None' ? key.key : `${key.key} with ${key.mod} held`,
          });
      });
    }
    const key = readOf(slotsOf(row, 'keyboard'))[0];
    const pad = padOf(row, sticks)[0];
    const role = roleOf(row);
    return {
      id,
      name: row.name || row.action,
      mode: mode.id,
      ...(role === undefined ? {} : { role }),
      required: REQUIRED.has(`${row.category}:${row.action}`),
      ...(key === undefined && pad?.kind !== 'pad'
        ? {}
        : {
            native: {
              ...(key === undefined ? {} : { key }),
              ...(pad?.kind === 'pad' ? { pad: pad.control } : {}),
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

const sameSignals = (a: readonly Signal[], b: readonly Signal[]): boolean =>
  a.length === b.length &&
  [...a.map(signalKey)].sort().join('|') === [...b.map(signalKey)].sort().join('|');

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
  const actions = actionsOf(all);
  const byId = new Map(actions.map(({ id, row }) => [id, row]));
  const idOf = new Map(actions.map(({ id, row }) => [row, id]));
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
    const line = row.lines.get(GROUPS[set].group);
    if (line === undefined) {
      if (list.length > 0) problems.push(`${row.name}: the file has no ${set} line for it.`);
      return;
    }
    const others = taken(modeOf(row.category).id, idOf.get(row) ?? '');
    const { slots, short } = assignSlots(
      keepSeconds(slotsOf(row, set), set, list, others),
      new Map([[set, [...list]]]),
    );
    for (const signal of short)
      problems.push(
        `${row.name}: a line holds two bindings, so ${signalWords(signal)} doesn't fit.`,
      );
    slots.forEach((signal, i) => {
      if (signal === undefined) return;
      const key = signal === null ? NONE : unrealKeyOf(signal);
      if (typeof key === 'string') problems.push(`${row.name}: ${key}`);
      else change(line, (i + 1) as 1 | 2, key);
    });
  };

  const wanted = wantedByAction(rows);
  const controller = new Map<Row, Signal[]>();
  for (const [id, sets] of wanted) {
    const row = byId.get(id);
    if (row === undefined) {
      problems.push(`The file has no action "${id}".`);
      continue;
    }
    for (const [set, list] of sets) {
      const misplaced = list.filter((signal) => setOf(signal) !== set);
      for (const signal of misplaced)
        problems.push(`${row.name}: ${signalWords(signal)} isn't a ${set} binding.`);
      if (misplaced.length > 0) continue;
      if (set === 'keyboard') place(row, set, list);
      else controller.set(row, list);
    }
  }

  // The controller set, a stick at a time: a stick's halves move together or not at all.
  const done = new Set<Row>();
  for (const [row, list] of controller) {
    if (done.has(row)) continue;
    const stick = sticks.get(row);
    if (stick === undefined) {
      place(row, 'controller', list);
      continue;
    }
    const halves = [...sticks].filter(([, s]) => s === stick).map(([half]) => half);
    const want = (half: Row): Signal[] => controller.get(half) ?? padOf(half, sticks);
    for (const half of halves) done.add(half);
    if (halves.every((half) => sameSignals(want(half), padOf(half, sticks)))) continue;
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
