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

import type {
  Action,
  ActionId,
  BindingSet,
  GameBinding,
  Mode,
  ModeId,
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
  lines.forEach(({ text }, index) => {
    if (slot !== null) {
      const modifier = MODIFIER.exec(text);
      if (text.trim() === `</${slot.name}>`) {
        slot.last = index;
        slot = null;
      } else if (modifier !== null)
        slot.modifiers.push({ device: modifier[1] ?? '', key: modifier[2] ?? '' });
      else if (!HOLD.test(text)) slot.unknown = true;
      return;
    }
    if (open === null) {
      const start = OPEN.exec(text);
      if (start !== null) open = { tag: start[2] ?? '', indent: start[1] ?? '', slots: [] };
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
      name: found[2] ?? '',
      device: found[3] ?? '',
      key: found[4] ?? '',
      modifiers: [],
      first: index,
      last: index,
      indent: found[1] ?? '',
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

/** The buggy's controls that don't say Buggy. */
const SRV = new Set([
  'ToggleDriveAssist',
  'SteerLeftButton',
  'SteerRightButton',
  'VerticalThrustersButton',
  'IncreaseSpeedButtonMax',
  'DecreaseSpeedButtonMax',
  'IncreaseSpeedButtonPartial',
  'DecreaseSpeedButtonPartial',
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
const CAMERA =
  /^(FocusDistance|ToggleVanityCamera)|FreeCam|VanityCamera|PhotoCameraToggle|^(Pitch|Yaw|Roll)Camera|^FStop|^(ToggleRotationLock|FixCamera(Relative|World)Toggle|QuitCamera|ToggleAdvanceMode)$/;

function modeOf(tag: string): ModeId {
  if (/Settlement|Colonisation|ConstructionOption/.test(tag)) return 'construction';
  if (/^(FocusDistance|ToggleVanityCamera)/.test(tag)) return 'camera';
  if (tag.startsWith('Humanoid') || tag.endsWith('_Humanoid')) return 'foot';
  if (tag.includes('Buggy') || SRV.has(tag)) return 'srv';
  if (tag.endsWith('_Landing')) return 'landing';
  // The scanner is entered from the ship; everything else about it is done inside.
  if (tag === 'ExplorationFSSEnter') return 'ship';
  if (tag.startsWith('ExplorationFSS')) return 'fss';
  if (tag.startsWith('ExplorationSAA') || tag.startsWith('SAA')) return 'dss';
  if (tag.startsWith('MultiCrew')) return 'multicrew';
  if (tag.startsWith('Order') || tag === 'OpenOrders') return 'fighter';
  if (/^Cam[A-Z]/.test(tag) || tag === 'GalaxyMapHome') return 'map';
  if (tag.startsWith('Store') || tag.startsWith('CommanderCreator')) return 'store';
  if (/^HeadLook(Reset|Pitch|Yaw)/.test(tag)) return 'headlook';
  if (CAMERA.test(tag)) return 'camera';
  if (tag.startsWith('UI_') || /^Cycle(Next|Previous)(Panel|Page)$/.test(tag)) return 'ui';
  if (tag.startsWith('GalnetAudio') || GENERAL.has(tag)) return 'general';
  return 'ship';
}

/**
 * A control's name in words, from its tag: `HumanoidPrimaryFireButton` is "Primary fire",
 * `ExplorationFSSZoomIn` "Exploration FSS zoom in". The file has no other words for it.
 */
function nameOf(tag: string): string {
  const words = tag
    .replace(/^Humanoid(?=[A-Z])/, '')
    .replace(/_(Buggy|Humanoid|Landing)$/, '')
    .replace(/Button$/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z0-9])|([A-Z]+)([A-Z][a-z])|([0-9])([A-Za-z])/g, (_, a, b, c, d, e, f) =>
      a !== undefined ? `${a} ${b}` : c !== undefined ? `${c} ${d}` : `${e} ${f}`,
    )
    .split(/\s+/)
    .filter((word) => word !== '')
    .map((word, i) => (i === 0 || /^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()));
  return words.join(' ') || tag;
}

const MOVING_MODES = new Set(['ship', 'landing', 'srv', 'foot']);

function roleOf(tag: string, mode: ModeId): Role | undefined {
  if (mode === 'ui' || mode === 'map' || mode === 'store') return 'menu';
  if (!MOVING_MODES.has(mode)) return undefined;
  if (/^(Supercruise|Hyperspace|HyperSuperCombination|UseBoostJuice)$/.test(tag)) return 'travel';
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

/**
 * The game as a .binds file has it: its modes of play, every button control as an action, and
 * what each is bound to on the keyboard and the controller. The game's id and name are the
 * caller's.
 */
export function harvestEliteBinds(file: string, game: { id: string; name: string }): Harvest {
  const kept: KeptBinding[] = [];
  const actions = actionsOf(controlsOf(linesOf(file))).map(({ id, control }): Action => {
    const states = control.slots.map(stateOf);
    const first = new Map<BindingSet, Signal>();
    states.forEach((state, i) => {
      const slot = control.slots[i];
      if (slot === undefined || state.state === 'empty') return;
      // A slot on another device (a joystick, the pedals) is in neither set: it isn't listed.
      const set =
        state.state === 'read'
          ? setOf(state.signal)
          : isPadKey(slot.key)
            ? 'controller'
            : slot.device === KEYBOARD || slot.device === MOUSE
              ? 'keyboard'
              : null;
      if (set === null) return;
      if (state.state === 'read' && !first.has(set)) first.set(set, state.signal);
      else kept.push({ action: id, set, text: describe(slot) });
    });
    const mode = modeOf(control.tag);
    const role = roleOf(control.tag, mode);
    const key = first.get('keyboard');
    const pad = first.get('controller');
    return {
      id,
      name: nameOf(control.tag),
      mode,
      ...(role === undefined ? {} : { role }),
      required: false,
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

/** The device the file's controller bindings are on, or null when it has none. */
function padDeviceOf(file: string): string | null {
  return /Device="([^"]*)" Key="(?:Pos_|Neg_)?GamePad_/.exec(file)?.[1] ?? null;
}

/** A slot as the file writes it: one line, or with its modifiers, one per line inside it. */
function slotText(slot: EliteSlot, control: Control, key: EliteKey, end: string): string {
  // One level deeper than the slot, by the step from the control to the slot.
  const step = slot.indent.startsWith(control.indent)
    ? slot.indent.slice(control.indent.length)
    : '';
  const head = `${slot.indent}<${slot.name} Device="${key.device}" Key="${key.key}"`;
  if (key.modifiers.length === 0) return `${head} />`;
  const inner = key.modifiers.map(
    (m: EliteInput) =>
      `${slot.indent}${step || '\t'}<Modifier Device="${m.device}" Key="${m.key}" />`,
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
  const actions = actionsOf(controlsOf(lines));
  const byId = new Map(actions.map(({ id, control }) => [id, control]));
  const taken = takenBy(rows, (id) => {
    const control = byId.get(id);
    return control === undefined ? undefined : modeOf(control.tag);
  });
  const padDevice = padDeviceOf(file) ?? options.padDevice ?? null;
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
    const others = taken(modeOf(control.tag), id);
    let slots = control.slots.map(stateOf);
    let fine = true;
    for (const [set, list] of wanted) {
      for (const signal of list.filter((s) => setOf(s) !== set)) {
        problems.push(`${name}: ${signalWords(signal)} isn't a ${set} binding.`);
        fine = false;
      }
      slots = keepSeconds(slots, set, list, others);
    }
    if (!fine) continue;
    const placed = assignSlots(slots, wanted);
    for (const signal of placed.short)
      problems.push(
        `${name}: a control holds two bindings, so ${signalWords(signal)} doesn't fit.`,
      );
    placed.slots.forEach((signal, i) => {
      const slot = control.slots[i];
      if (signal === undefined || slot === undefined) return;
      if (signal?.kind === 'pad' && padDevice === null) {
        problems.push(
          `${name}: the file has no controller in it to bind ${signalWords(signal)} to.`,
        );
        return;
      }
      const key = signal === null ? EMPTY : eliteKeyOf(signal, padDevice ?? '');
      if (typeof key === 'string') problems.push(`${name}: ${key}`);
      else changes.set(slot.first, { slot, control, key });
    });
  }

  if (problems.length > 0) throw new GameFileError(problems);
  const out: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const change = changes.get(i);
    if (line === undefined) continue;
    if (change === undefined) {
      out.push(line);
      continue;
    }
    const last = lines[change.slot.last] ?? line;
    out.push({ text: slotText(change.slot, change.control, change.key, line.end), end: last.end });
    i = change.slot.last;
  }
  return joinLines(out);
}

// --- StartPreset and finding the file ------------------------------------------------------

/** The preset each line of `StartPreset.4.start` names, in order. */
export function readStartPreset(text: string): string[] {
  return linesOf(text)
    .map((line) => line.text.trim())
    .filter((name) => name !== '');
}

/**
 * `StartPreset.4.start` with every line naming `preset`: the game then reads that preset for every
 * category of controls. The number of lines and their endings stay as they were.
 */
export function writeStartPreset(text: string, preset: string): string {
  return joinLines(
    linesOf(text).map((line) => (line.text.trim() === '' ? line : { text: preset, end: line.end })),
  );
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
    .map((entry) => ({
      entry,
      version: /^(.*)\.(\d+)\.(\d+)\.binds$/i.exec(entry),
    }))
    .filter(({ version }) => version?.[1]?.toLowerCase() === name.toLowerCase())
    .sort((a, b) => {
      const [, , aMajor = '0', aMinor = '0'] = a.version ?? [];
      const [, , bMajor = '0', bMinor = '0'] = b.version ?? [];
      return Number(bMajor) - Number(aMajor) || Number(bMinor) - Number(aMinor);
    })[0];
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
