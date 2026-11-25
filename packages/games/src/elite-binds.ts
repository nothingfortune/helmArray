// Elite Dangerous's .binds and StartPreset: find the file the game reads, harvest the game's
// bindings from it, and write a setup's into it.
//
// A .binds file is XML, one element per control, kept here line by line so that every line a write
// doesn't change stays byte for byte (the BOM of the shipped presets and CRLF included). A button
// control holds a `Primary` and a `Secondary` slot: a device, a key, and optional children
// (`Modifier`: a key held with it; `Hold`). An axis control holds a `Binding` instead and is not an
// action: axes (and the pedals on them) are a later part of M5.
//
// The slots, and which belong to helmArray:
// - A slot on `Keyboard` or `Mouse` belongs to the keyboard set; one on a controller key
//   (`GamePad_*`, whatever device id the file gives the controller) to the controller set. A slot
//   on any other device (a joystick, the pedals) is the owner's and no write touches it, nor one
//   helmArray can't name (a chord, a key with no name): it holds its slot.
// - A write puts each action's keyboard and controller bindings in the slots of their set, keeping
//   a binding that doesn't change where it is, then filling the free slots, Primary first,
//   keyboard first. Two slots in all: an action on two keys and a controller button doesn't fit,
//   and nor does one whose other slot holds a joystick. Both are errors that say so.
// - A new controller binding goes on the device the file's controller bindings already use (the
//   owner's file says `28DE11FF`, Steam's virtual controller). A file with none needs to be told.
//
// Where the files are (legacy repo, games/SpaceSims/eliteDangerous/game.yaml): the player's under
// `%LOCALAPPDATA%/Frontier Developments/Elite Dangerous/Options/Bindings/` (`Custom.4.1.binds`),
// beside `StartPreset.4.start`, which names the preset the game uses, one line per category of
// controls; the shipped presets under `<install>/Products/elite-dangerous-odyssey-64/
// ControlSchemes/<name>.binds`. The game reads `Custom.4.1.binds` only when StartPreset names
// `Custom`, and rewrites its files on exit: it must be closed before either is written.
//
// A player who has only ever used a preset the game ships has no file of their own: StartPreset
// names that preset, and the game reads it from its install folder. helmArray then makes one, as
// the legacy app did (its game.yaml: "applying writes that file from the installed
// KeyboardMouseOnly preset ..., sets the presets to Custom, and keeps both previous files beside
// them"; legacy CLAUDE.md, *Elite Dangerous's .binds*: "Writing starts from `ingame_preset`, a
// preset the game ships (KeyboardMouseOnly)"):
// - from `KeyboardMouseOnly.binds` under the install folder's ControlSchemes, whichever preset
//   StartPreset names (legacy game.yaml `ingame_preset`; src/lib/tasks.ts `applyElite` reads it
//   whatever StartPreset says);
// - as `Custom.4.1.binds` beside StartPreset (game.yaml `ingame_config`), its root line made
//   `<Root PresetName="Custom" MajorVersion="4" MinorVersion="1">` and nothing else changed
//   (legacy src/lib/elite.ts `applyBinds`, and its test "is a Custom preset 4.1, and says so on the
//   root"; reference/game-files/elite-Custom.4.1.binds, the file the game wrote, has that root);
// - then every line of StartPreset names `Custom` (tasks.ts `applyElite`: "every line of
//   `StartPreset.4.start` is set to `Custom`"). Which line is which category of controls isn't
//   known; the legacy app set them all alike, and so does this.

import type {
  Action,
  ActionId,
  BindingSet,
  GameBinding,
  Mode,
  ModeId,
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
import type { EliteInput, EliteKey } from './elite-keys';
import { KEYBOARD, MOUSE, NO_DEVICE, eliteKeyOf, isPadKey, signalOfElite } from './elite-keys';
import type { Harvest, KeptBinding } from './unreal-ini';

/** One `Primary` or `Secondary`: the lines it spans and what it holds. */
interface EliteSlot extends EliteKey {
  name: string;
  first: number;
  last: number;
  /** The ending of its last line. */
  end: string;
  indent: string;
  /** Children other than `Modifier` and `Hold`: nothing helmArray knows. */
  unknown: boolean;
}

/** A control with a Primary and a Secondary. */
interface Control {
  tag: string;
  indent: string;
  slots: [EliteSlot, EliteSlot];
}

const OPEN = /^(\s*)<([A-Za-z_][\w.-]*)>\s*$/;
// The shipped presets spell an attribute `key` here and there: the game reads either.
const SLOT = /^(\s*)<(Primary|Secondary) [Dd]evice="([^"]*)" [Kk]ey="([^"]*)"\s*(\/?)>\s*$/;
const MODIFIER = /^\s*<Modifier [Dd]evice="([^"]*)" [Kk]ey="([^"]*)"\s*\/>\s*$/;
const HOLD = /^\s*<Hold\b[^>]*\/>\s*$/;

/** The file's button controls, in file order. */
function controlsOf(lines: readonly Line[]): Control[] {
  const controls: Control[] = [];
  let open: { tag: string; indent: string; slots: EliteSlot[] } | null = null;
  let slot: EliteSlot | null = null;
  lines.forEach(({ text, end }, index) => {
    if (slot !== null) {
      const modifier = MODIFIER.exec(text);
      if (text.trim() === `</${slot.name}>`) {
        slot.last = index;
        slot.end = end;
        slot = null;
      } else if (modifier !== null)
        slot.modifiers.push({ device: groupOf(modifier, 1), key: groupOf(modifier, 2) });
      else if (!HOLD.test(text)) slot.unknown = true;
      return;
    }
    if (open === null) {
      const start = OPEN.exec(text);
      if (start !== null) open = { tag: groupOf(start, 2), indent: groupOf(start, 1), slots: [] };
      return;
    }
    if (text.trim() === `</${open.tag}>`) {
      const [primary, secondary] = open.slots;
      if (open.slots.length === 2 && primary?.name === 'Primary' && secondary?.name === 'Secondary')
        controls.push({ tag: open.tag, indent: open.indent, slots: [primary, secondary] });
      open = null;
      return;
    }
    const found = SLOT.exec(text);
    if (found === null) return;
    const next: EliteSlot = {
      name: groupOf(found, 2),
      device: groupOf(found, 3),
      key: groupOf(found, 4),
      modifiers: [],
      first: index,
      last: index,
      end,
      indent: groupOf(found, 1),
      unknown: false,
    };
    open.slots.push(next);
    if (found[5] !== '/') slot = next;
  });
  return controls;
}

function stateOf(slot: EliteSlot): Slot {
  if (
    (slot.device === NO_DEVICE || slot.key === '') &&
    slot.modifiers.length === 0 &&
    !slot.unknown
  )
    return { state: 'empty' };
  const signal = slot.unknown ? null : signalOfElite(slot);
  return signal === null ? { state: 'kept' } : { state: 'read', signal };
}

// --- modes, names, roles ------------------------------------------------------------------

/**
 * The game's modes of play, in the order the app shows them. Which control is in which is read
 * from its name (legacy CLAUDE.md, *Modes of play*, and the legacy key table's notes): the buggy's
 * say Buggy or are among a few that don't, on foot's say Humanoid, and so on; the rest are the
 * ship's.
 */
const MODES: readonly Mode[] = [
  { id: 'ship', name: 'Ship' },
  { id: 'landing', name: 'Landing' },
  { id: 'srv', name: 'SRV' },
  { id: 'foot', name: 'On foot' },
  { id: 'fss', name: 'System scanner' },
  { id: 'dss', name: 'Surface scanner' },
  { id: 'fighter', name: 'Fighter orders' },
  { id: 'multicrew', name: 'Multicrew' },
  { id: 'ui', name: 'Menus and panels' },
  { id: 'map', name: 'Galaxy map' },
  { id: 'headlook', name: 'Headlook' },
  { id: 'camera', name: 'Camera' },
  { id: 'store', name: 'Store' },
  { id: 'general', name: 'Everywhere' },
  { id: 'construction', name: 'Construction' },
];

/** The buggy's controls that don't say Buggy (its speed axes say nothing either, but are axes). */
const SRV = new Set([
  'ToggleDriveAssist',
  'SteerLeftButton',
  'SteerRightButton',
  'VerticalThrustersButton',
  'IncreaseSpeedButtonMax',
  'DecreaseSpeedButtonMax',
  'RecallDismissShip',
]);
/** Controls that work whatever the player is doing. */
const GENERAL = new Set([
  'Pause',
  'FriendsMenu',
  'MicrophoneMute',
  'HMDReset',
  'ShowPGScoreSummaryInput',
  'MouseReset',
  'BlockMouseDecay',
]);
/** The camera suite's controls, by how their names start, contain, or are. */
const CAMERA_STARTS = ['PitchCamera', 'YawCamera', 'RollCamera', 'FStop'];
const CAMERA_HAS = ['FreeCam', 'VanityCamera', 'PhotoCameraToggle'];
const CAMERA = new Set([
  'ToggleRotationLock',
  'FixCameraRelativeToggle',
  'FixCameraWorldToggle',
  'QuitCamera',
  'ToggleAdvanceMode',
]);
const HEADLOOK_STARTS = ['HeadLookReset', 'HeadLookPitch', 'HeadLookYaw'];
const UI = new Set(['CycleNextPanel', 'CyclePreviousPanel', 'CycleNextPage', 'CyclePreviousPage']);

const startsWithAny = (tag: string, starts: readonly string[]): boolean =>
  starts.some((start) => tag.startsWith(start));

function modeOf(tag: string): ModeId {
  if (['Settlement', 'Colonisation', 'ConstructionOption'].some((s) => tag.includes(s)))
    return 'construction';
  // Before the buggy and on foot: ToggleVanityCamera_Buggy is the camera's.
  if (startsWithAny(tag, ['FocusDistance', 'ToggleVanityCamera'])) return 'camera';
  if (tag.startsWith('Humanoid') || tag.endsWith('_Humanoid')) return 'foot';
  if (tag.includes('Buggy') || SRV.has(tag)) return 'srv';
  if (tag.endsWith('_Landing')) return 'landing';
  // The scanner is entered from the ship; everything else about it is done inside.
  if (tag === 'ExplorationFSSEnter') return 'ship';
  if (tag.startsWith('ExplorationFSS')) return 'fss';
  if (startsWithAny(tag, ['ExplorationSAA', 'SAA'])) return 'dss';
  if (tag.startsWith('MultiCrew')) return 'multicrew';
  if (tag.startsWith('Order') || tag === 'OpenOrders') return 'fighter';
  if (/^Cam[A-Z]/.test(tag) || tag === 'GalaxyMapHome') return 'map';
  if (startsWithAny(tag, ['Store', 'CommanderCreator'])) return 'store';
  if (startsWithAny(tag, HEADLOOK_STARTS)) return 'headlook';
  if (
    startsWithAny(tag, CAMERA_STARTS) ||
    CAMERA_HAS.some((s) => tag.includes(s)) ||
    CAMERA.has(tag)
  )
    return 'camera';
  if (tag.startsWith('UI_') || UI.has(tag)) return 'ui';
  if (tag.startsWith('GalnetAudio') || GENERAL.has(tag)) return 'general';
  return 'ship';
}

/**
 * A control's name in words, from its tag: `HumanoidPrimaryFireButton` is "Primary fire",
 * `ExplorationFSSZoomIn` "Exploration FSS zoom in". The file has no other words for it.
 */
function nameOf(tag: string): string {
  const words = tag
    .replace(/^Humanoid/, '')
    .replace(/_(Buggy|Humanoid|Landing)$/, '')
    .replace(/Button$/, '')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .replace(/[_\s]+/g, ' ')
    .trim()
    .split(' ')
    .map((word, i) => (i > 0 && word !== word.toUpperCase() ? word.toLowerCase() : word));
  return words.join(' ') || tag;
}

const MOVING_MODES = new Set(['ship', 'landing', 'srv', 'foot']);
const TRAVEL = new Set(['Supercruise', 'Hyperspace', 'HyperSuperCombination', 'UseBoostJuice']);

function roleOf(tag: string, mode: ModeId): Role | undefined {
  if (mode === 'ui' || mode === 'map' || mode === 'store') return 'menu';
  if (!MOVING_MODES.has(mode)) return undefined;
  if (TRAVEL.has(tag)) return 'travel';
  if (/Fire|Target|Hardpoint|Weapon|Grenade|Melee|Reload|ECM|Chaff|HeatSink|ShieldCell/.test(tag))
    return 'combat';
  if (/Yaw|Pitch|Roll|Thrust|Forward|Backward|Strafe|Steer|Speed|Sprint|Crouch|Jump|Walk/.test(tag))
    return 'movement';
  return undefined;
}

// --- reading ------------------------------------------------------------------------------

function actionsOf(controls: readonly Control[]): { id: ActionId; control: Control }[] {
  const id = idMaker();
  return controls.map((control) => ({ id: id(control.tag), control }));
}

const describe = (slot: EliteKey): string =>
  slot.modifiers.length === 0
    ? slot.key
    : `${slot.key} with ${slot.modifiers.map((m) => m.key).join(' and ')} held`;

/** The set a slot that isn't empty is in; null for another device, which is in neither. */
function setOfSlot(slot: EliteSlot, state: Slot): BindingSet | null {
  if (state.state === 'read') return setOf(state.signal);
  if (isPadKey(slot.key)) return 'controller';
  return slot.device === KEYBOARD || slot.device === MOUSE ? 'keyboard' : null;
}

/**
 * The game as a .binds file has it: its modes of play, every button control as an action, and
 * what each is bound to on the keyboard and the controller. The game's id and name are the
 * caller's.
 */
export function harvestEliteBinds(file: string, game: { id: string; name: string }): Harvest {
  const kept: KeptBinding[] = [];
  const actions = actionsOf(controlsOf(linesOf(file))).map(({ id, control }): Action => {
    let key: Signal | undefined;
    let pad: PadControl | undefined;
    for (const slot of control.slots) {
      const state = stateOf(slot);
      const set = state.state === 'empty' ? null : setOfSlot(slot, state);
      if (set === null) continue;
      if (state.state === 'read' && state.signal.kind === 'pad' && pad === undefined)
        pad = state.signal.control;
      else if (state.state === 'read' && state.signal.kind !== 'pad' && key === undefined)
        key = state.signal;
      else kept.push({ action: id, set, text: describe(slot) });
    }
    const mode = modeOf(control.tag);
    const role = roleOf(control.tag, mode);
    return {
      id,
      name: nameOf(control.tag),
      mode,
      ...(role === undefined ? {} : { role }),
      required: false,
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
  const used = new Set(actions.map((a) => a.mode));
  return {
    game: {
      id: game.id,
      name: game.name,
      modes: MODES.filter((mode) => used.has(mode.id)),
      actions,
      file: { format: 'elite-binds' },
    },
    kept,
  };
}

// --- writing ------------------------------------------------------------------------------

/** A slot as the file writes it: one line, or with its modifiers, one per line inside it. */
function slotText(slot: EliteSlot, control: Control, key: EliteKey, end: string): string {
  // One level deeper than the slot, by the file's own step from the control to the slot.
  const step = slot.indent.slice(control.indent.length) || '\t';
  const head = `${slot.indent}<${slot.name} Device="${key.device}" Key="${key.key}"`;
  if (key.modifiers.length === 0) return `${head} />`;
  const inner = key.modifiers.map(
    (m: EliteInput) => `${slot.indent}${step}<Modifier Device="${m.device}" Key="${m.key}" />`,
  );
  return [`${head}>`, ...inner, `${slot.indent}</${slot.name}>`].join(end);
}

const EMPTY: EliteKey = { device: NO_DEVICE, key: '', modifiers: [] };

/**
 * The file with the setup's bindings in it: for each action and binding set the rows name, the
 * set's slots hold exactly the rows' signals (a null row: nothing); an action or set with no rows
 * keeps what it has. Slots on other devices, and bindings helmArray can't name, are never touched.
 * Every line that doesn't change stays byte for byte. Throws a `GameFileError` naming every row it
 * can't write. `padDevice` is the controller's device id, for a file that names none.
 */
export function writeEliteBinds(
  file: string,
  rows: readonly GameBinding[],
  options: { padDevice?: string } = {},
): string {
  const lines = linesOf(file);
  const controls = controlsOf(lines);
  const byId = new Map(actionsOf(controls).map(({ id, control }) => [id, control]));
  const taken = takenBy(rows, (id) => {
    const control = byId.get(id);
    return control === undefined ? undefined : modeOf(control.tag);
  });
  // The device the file's controller bindings are on: a new one goes there too.
  const padDevice =
    controls.flatMap((control) => control.slots).find((slot) => isPadKey(slot.key))?.device ??
    options.padDevice ??
    null;
  const problems: string[] = [];
  /** Per first line of a slot: the slot, and what it becomes. */
  const changes = new Map<number, { slot: EliteSlot; control: Control; key: EliteKey }>();

  for (const [id, wanted] of wantedByAction(rows)) {
    const control = byId.get(id);
    if (control === undefined) {
      problems.push(`The file has no action "${id}".`);
      continue;
    }
    const name = nameOf(control.tag);
    let slots = control.slots.map(stateOf);
    for (const [set, list] of wanted) {
      for (const signal of list.filter((s) => setOf(s) !== set))
        problems.push(`${name}: ${signalWords(signal)} isn't a ${set} binding.`);
      slots = keepSeconds(slots, set, list, taken(modeOf(control.tag)));
    }
    const placed = assignSlots(slots, wanted);
    for (const signal of placed.short)
      problems.push(
        `${name}: a control holds two bindings, so ${signalWords(signal)} doesn't fit.`,
      );
    control.slots.forEach((slot, i) => {
      const signal = placed.slots[i];
      if (signal === undefined) return;
      if (signal?.kind === 'pad' && padDevice === null) {
        problems.push(
          `${name}: the file has no controller in it to bind ${signalWords(signal)} to.`,
        );
        return;
      }
      const key = signal === null ? EMPTY : eliteKeyOf(signal, padDevice ?? NO_DEVICE);
      if (typeof key === 'string') problems.push(`${name}: ${key}`);
      else changes.set(slot.first, { slot, control, key });
    });
  }

  if (problems.length > 0) throw new GameFileError(problems);
  const out: Line[] = [];
  let skipTo = -1;
  lines.forEach((line, i) => {
    if (i <= skipTo) return;
    const change = changes.get(i);
    if (change === undefined) {
      out.push(line);
      return;
    }
    out.push({
      text: slotText(change.slot, change.control, change.key, line.end),
      end: change.slot.end,
    });
    skipTo = change.slot.last;
  });
  return joinLines(out);
}

// --- StartPreset and finding the file ------------------------------------------------------

/** The preset each line of `StartPreset.4.start` names, in order. */
export function readStartPreset(text: string): string[] {
  return linesOf(text)
    .map((line) => line.text.trim())
    .filter((name) => name !== '');
}

const BOM = '\uFEFF';

/**
 * `StartPreset.4.start` with every line naming `preset`: the game then reads that preset for every
 * category of controls (legacy src/lib/tasks.ts `applyElite` sets every line that isn't blank).
 * The number of lines and their endings stay as they were, a byte order mark at the start is kept,
 * and a line that names `preset` already, or none, stays byte for byte.
 */
export function writeStartPreset(text: string, preset: string): string {
  return joinLines(
    linesOf(text).map((line, i) => {
      const bom = i === 0 && line.text.startsWith(BOM) ? BOM : '';
      const name = line.text.trim();
      return name === '' || name === preset ? line : { text: bom + preset, end: line.end };
    }),
  );
}

/** The file helmArray makes when the player has none, and the preset StartPreset then names. */
export const ELITE_NEW_BINDS = 'Custom.4.1.binds';
export const ELITE_NEW_PRESET = 'Custom';
/** The preset the game ships that the new file is made from. */
const BASE_PRESET = 'KeyboardMouseOnly.binds';
const ROOT = /^(\s*)<Root\b/;

/**
 * The player's own file, made from the text of the preset the game ships: its root line says it is
 * the Custom preset, version 4.1, and every other line stays byte for byte (the BOM and the CRLF
 * included). Throws a `GameFileError` for a file with no root line.
 */
export function newEliteBinds(shipped: string): string {
  const lines = linesOf(shipped);
  const at = lines.findIndex((line) => ROOT.test(line.text));
  const root = lines[at];
  if (root === undefined)
    throw new GameFileError(["The game's preset has no Root line to make the new file from."]);
  const indent = groupOf(ROOT.exec(root.text) as RegExpExecArray, 1);
  lines[at] = {
    text: `${indent}<Root PresetName="${ELITE_NEW_PRESET}" MajorVersion="4" MinorVersion="1">`,
    end: root.end,
  };
  return joinLines(lines);
}

const BINDINGS = ['Frontier Developments', 'Elite Dangerous', 'Options', 'Bindings'];
const START_PRESET = 'StartPreset.4.start';
const CONTROL_SCHEMES = ['Products', 'elite-dangerous-odyssey-64', 'ControlSchemes'];

export interface EliteFound {
  /** The bindings folder: where the player's own presets and StartPreset are, and are written. */
  folder: string;
  startPreset: string;
  /** Per line of StartPreset: the preset it names and its file, null when there is none. */
  presets: { name: string; path: string | null }[];
  /** The one file every line names, or null when they name different ones or one is missing. */
  binds: string | null;
}

const walk = (fs: FolderReader, from: string | null, names: readonly string[]): string | null =>
  names.reduce<string | null>(
    (path, name) => (path === null ? null : entryOf(fs, path, name)),
    from,
  );

/**
 * The file a preset name stands for: the player's own (`Custom.4.1.binds`, the highest version
 * when there are several), else the one the game ships under its install folder.
 */
function presetFile(
  fs: FolderReader,
  folder: string,
  installDir: string | null,
  name: string,
): string | null {
  const own = fs
    .list(folder)
    .flatMap((entry) => {
      const match = /(.*)\.(\d+)\.(\d+)\.binds$/i.exec(entry);
      return match !== null && groupOf(match, 1).toLowerCase() === name.toLowerCase()
        ? [{ entry, major: Number(groupOf(match, 2)), minor: Number(groupOf(match, 3)) }]
        : [];
    })
    .sort((a, b) => b.major - a.major || b.minor - a.minor)[0];
  if (own !== undefined) return fs.join(folder, own.entry);
  return walk(fs, installDir, [...CONTROL_SCHEMES, `${name}.binds`]);
}

/**
 * Where the game's bindings are: the first of `localAppData` (the user's `%LOCALAPPDATA%`, as the
 * app finds it) with a `StartPreset.4.start`, and the file each of its lines names. Null when
 * none has one (the game hasn't been run).
 */
export function findEliteBinds(
  where: { installDir: string | null; localAppData: readonly string[] },
  fs: FolderReader,
): EliteFound | null {
  for (const root of where.localAppData) {
    const folder = walk(fs, root, BINDINGS);
    const startPreset = folder === null ? null : entryOf(fs, folder, START_PRESET);
    const text = startPreset === null ? null : fs.read(startPreset);
    if (folder === null || startPreset === null || text === null) continue;
    const presets = readStartPreset(text).map((name) => ({
      name,
      path: presetFile(fs, folder, where.installDir, name),
    }));
    const paths = new Set(presets.map((p) => p.path));
    const [only] = paths;
    return {
      folder,
      startPreset,
      presets,
      binds: paths.size === 1 && only !== undefined ? only : null,
    };
  }
  return null;
}

export interface EliteNewBinds {
  /** The bindings folder, where StartPreset is and the new file goes. */
  folder: string;
  startPreset: string;
  /** The preset the game ships, under its install folder, that the new file is made from. */
  from: string;
  /** The new file: `Custom.4.1.binds` in the bindings folder. */
  path: string;
}

/**
 * Where helmArray makes the player's own file, when the player has none: StartPreset is there (the
 * game has run), no line of it names a file of the player's, the folder holds no `Custom` file of
 * any version (one the game would read once StartPreset names `Custom`, and which a new one must
 * never be written over), and the install folder holds the preset the new file is made from. Null
 * otherwise.
 */
export function findEliteNewBinds(
  where: { installDir: string | null; localAppData: readonly string[] },
  fs: FolderReader,
): EliteNewBinds | null {
  const found = findEliteBinds({ installDir: null, localAppData: where.localAppData }, fs);
  if (found === null || found.presets.some((p) => p.path !== null)) return null;
  if (presetFile(fs, found.folder, null, ELITE_NEW_PRESET) !== null) return null;
  const from = walk(fs, where.installDir, [...CONTROL_SCHEMES, BASE_PRESET]);
  if (from === null) return null;
  return {
    folder: found.folder,
    startPreset: found.startPreset,
    from,
    path: fs.join(found.folder, ELITE_NEW_BINDS),
  };
}
