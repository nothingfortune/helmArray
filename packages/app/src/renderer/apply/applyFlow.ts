// The Apply drawer, as a reducer and a view-model: what it holds at each step, and what it says
// and allows. Pure, so the guards (Apply only when ready, never twice, never closed mid-write)
// are tested without a window.

import type {
  AppState,
  ApplyButtonChange,
  ApplyGame,
  ApplyGameRow,
  ApplyPreview,
  ApplyResult,
  ApplyUnitChange,
  ReadyCheck,
} from '../../shared/api';
import { signalText } from '../screens/editor-view';
import { positionName } from '../unit/layout';

export type DrawerState =
  /** `notice`: why it is looking again (the scheme changed under the drawer). */
  | { phase: 'loading'; notice?: string }
  /** The preview could not be had at all (the main process did not answer). */
  | { phase: 'unavailable'; message: string }
  | { phase: 'ready'; preview: ApplyPreview; notice?: string }
  | { phase: 'applying'; preview: ApplyPreview }
  | { phase: 'done'; preview: ApplyPreview; result: ApplyResult };

export type DrawerEvent =
  | { type: 'open' }
  | { type: 'preview'; preview: ApplyPreview }
  | { type: 'previewFailed'; message: string }
  | { type: 'apply' }
  | { type: 'applied'; result: ApplyResult }
  | { type: 'applyFailed'; message: string }
  | { type: 'retry' };

export const START: DrawerState = { phase: 'loading' };

/** Whether Apply may be pressed: the preview says ready, and nothing is running. */
export const canApply = (state: DrawerState): boolean =>
  state.phase === 'ready' && state.preview.ready && !state.preview.busy;

export function reduce(state: DrawerState, event: DrawerEvent): DrawerState {
  switch (event.type) {
    case 'open':
      return START;
    case 'preview':
      // A fresh look replaces a stale one, but never what is being written or has been shown.
      if (state.phase === 'loading' || state.phase === 'ready') {
        return {
          phase: 'ready',
          preview: event.preview,
          ...(state.notice !== undefined && { notice: state.notice }),
        };
      }
      return state.phase === 'unavailable' ? { phase: 'ready', preview: event.preview } : state;
    case 'previewFailed':
      return state.phase === 'loading' || state.phase === 'unavailable'
        ? { phase: 'unavailable', message: event.message }
        : state;
    case 'apply':
      return canApply(state) && state.phase === 'ready'
        ? { phase: 'applying', preview: state.preview }
        : state;
    case 'applied':
      if (state.phase !== 'applying') return state;
      // Refused because the scheme changed since the preview: nothing was written. Look again,
      // and say why the layout shown is not the one that was.
      if (event.result.changed === true) return { phase: 'loading', notice: event.result.message };
      return { phase: 'done', preview: state.preview, result: event.result };
    case 'applyFailed':
      return state.phase === 'applying'
        ? {
            phase: 'done',
            preview: state.preview,
            result: { ok: false, message: event.message, units: [] },
          }
        : state;
    case 'retry':
      return state.phase === 'done' && !state.result.ok ? START : state;
  }
}

/**
 * Changes whenever what the preview says could be different now, and not otherwise (a unit being
 * asked again, with the same answer, must not look again):
 *  - the Azeron app opening or closing (`writeBlock`);
 *  - a unit coming or going, or being told which hand it is, and its state;
 *  - a unit read or not read (a refused or failed read, then recovered), and the slot it runs
 *    (the profile button), which the slots to be deleted rest on;
 *  - the scheme changing since it was applied, which the pill's words say (an edit elsewhere).
 * A scheme edited in a way the pill does not show is caught when Apply is pressed instead: it
 * carries the fingerprint of the layout shown and is refused if that has changed.
 */
export function previewKey(state: AppState | null): string {
  if (state === null) return '';
  return JSON.stringify([
    state.writeBlock,
    state.question === null,
    state.devices.map((d) => [d.hand, d.unitId, d.state, d.read, d.running]),
    state.sync.label,
  ]);
}

// ------------------------------------------------------------------------------------- view

export interface UnitLine {
  /**
   * `button`: one button that changes, in the game's words; `housekeeping`: the unit's other
   * layouts going, one muted line; `same`: nothing to do; `problem`: why it can't be done.
   */
  kind: 'button' | 'housekeeping' | 'same' | 'problem';
  text: string;
}

export interface UnitSection {
  hand: 'left' | 'right';
  title: string;
  /** One short line beside the title. */
  summary: string;
  lines: UnitLine[];
}

/** The game's half: the bindings Apply changes, grouped by binding set and mode. */
export interface GameSection {
  title: string;
  /** One short line beside the title. */
  summary: string;
  /** The game's file, by name, once found: only for the file helmArray writes. */
  file?: string;
  /**
   * For the file: how many bindings in each mode, and that a copy is kept; or that none change. For
   * a sheet: why the rows are set by hand, when the file helmArray would write isn't there.
   */
  note?: string;
  /** A label only when there is more than one group. */
  groups: { label: string | null; lines: string[] }[];
}

export interface DrawerView {
  title: string;
  subtitle: string;
  /** "Looking at what changes…" while the preview is on its way, else null. */
  loading: string | null;
  /** The preview could not be had, in one sentence, else null. */
  unavailable: string | null;
  /** Why the layout shown is not the one before (it changed since), else null. */
  notice: string | null;
  /** Only what can fail or needs doing: the Azeron app, and anything not ready. */
  checks: ReadyCheck[];
  sections: UnitSection[];
  /** The game's bindings that change, before Apply; null when none does. */
  game: GameSection | null;
  /**
   * Before Apply, beside the file: the bindings of actions the file doesn't have, to set by hand;
   * null when there are none.
   */
  byHand: GameSection | null;
  /**
   * After an Apply that went through: the bindings still to be set by hand in the game's own
   * controls (the bind sheet, until helmArray writes the game's file); null when there are none.
   */
  sheet: GameSection | null;
  /** Shown while it writes, else null. */
  progress: string | null;
  /** How it ended, once it has. */
  result: { ok: boolean; headline: string; lines: string[] } | null;
  cancel: { label: string; disabled: boolean };
  /** Amber; absent once the apply has ended well. */
  apply: { label: string; disabled: boolean } | null;
  /** The drawer may be closed (Escape, the scrim, Cancel): never while it writes. */
  closable: boolean;
}

/** What the stick does, in the words the side panel uses. */
function stickWords(stick: NonNullable<ApplyButtonChange['stick']>): string {
  switch (stick.mode) {
    case 'pad-left':
      return 'Xbox left stick';
    case 'pad-right':
      return 'Xbox right stick';
    case 'mouse':
      return 'Mouse movement';
    case 'keys': {
      const keys = (['up', 'left', 'down', 'right'] as const).flatMap((d) => {
        const signal = stick.directions?.[d];
        return signal === undefined ? [] : [signalText(signal)];
      });
      return keys.length === 0 ? 'sends nothing' : keys.join(' ');
    }
  }
}

/**
 * One button that changes, as the canvas words it: "Middle 1 · Frame shift drive", "Index 5 ·
 * Silent running · new" for a button that sent nothing before, "D-pad ↑ · cleared" for one that
 * sends nothing now.
 */
export function buttonLine(button: ApplyButtonChange): string {
  const where = positionName(button.position);
  if (button.stick !== null) return `${where} · ${stickWords(button.stick)}`;
  if (button.nowEmpty) return `${where} · cleared`;
  const what =
    button.actions.length > 0
      ? button.actions.join(', ')
      : button.sends === null
        ? 'sends nothing'
        : signalText(button.sends);
  return button.wasEmpty ? `${where} · ${what} · new` : `${where} · ${what}`;
}

/**
 * A layout Apply removes that isn't this scheme's own earlier copy, by name and, when the units'
 * record says, its game: "Your layout “Xbox controller” from Helldivers 2 is removed."
 */
export function removedLine(layout: { name: string; game: string | null }): string {
  const what = layout.name === '' ? 'A layout with no name' : `Your layout “${layout.name}”`;
  return `${what}${layout.game === null ? '' : ` from ${layout.game}`} is removed.`;
}

export function unitSection(unit: ApplyUnitChange, azeronOpen: boolean): UnitSection {
  const title = unit.hand === 'left' ? 'Left Azeron' : 'Right Azeron';
  const base = { hand: unit.hand, title };
  if (azeronOpen) {
    return { ...base, summary: 'Waiting for the Azeron app to close', lines: [] };
  }
  if (!unit.connected) return { ...base, summary: 'Not connected', lines: [] };
  const lines: UnitLine[] = unit.buttons.map((b) => ({ kind: 'button', text: buttonLine(b) }));
  // Every layout that goes and isn't this scheme's own earlier copy (by identity, from main, never
  // by name) is said, muted, one line each. A layout written over is never the scheme's own: the
  // unit doesn't run it.
  const gone = [
    ...unit.deletes.filter((layout) => !layout.ownCopy),
    ...(unit.write?.overwrites ? [{ ...unit.write.overwrites, game: null }] : []),
  ];
  for (const layout of gone) lines.push({ kind: 'housekeeping', text: removedLine(layout) });
  if (unit.problem !== null) lines.push({ kind: 'problem', text: unit.problem });
  if (!unit.write && unit.deletes.length === 0 && unit.problem === null) {
    lines.push({ kind: 'same', text: 'It already holds this layout.' });
  }
  const n = unit.buttons.length;
  const summary =
    unit.problem !== null
      ? "Can't be done"
      : n > 0
        ? n === 1
          ? '1 button'
          : `${n} buttons`
        : unit.write || unit.deletes.length > 0
          ? 'No button changes'
          : 'No change';
  return { ...base, summary, lines };
}

/**
 * What can fail or needs doing: the Azeron app and the game whose file is written (always: what
 * the person may have to close), and any other check not ready.
 */
const shownChecks = (checks: readonly ReadyCheck[]): ReadyCheck[] =>
  checks.filter((c) => !c.ok || c.kind === 'azeron-app' || c.kind === 'game');

/**
 * The drawer waits for the game to close: it is the one thing not ready, and nothing tells the
 * window when it closes, so the drawer looks again by itself until it has.
 */
export const waitingOnGame = (state: DrawerState): boolean =>
  state.phase === 'ready' && state.preview.checks.some((c) => !c.ok && c.kind === 'game');

const SET_WORD = { controller: 'Controller', keyboard: 'Keyboard and mouse' } as const;

/** One binding to set, in the words of the game's own controls menu. */
function rowLine(row: ApplyGameRow): string {
  if (row.to !== null) return `Set ${row.actionName} to ${signalText(row.to)}`;
  return row.from === null
    ? `Leave ${row.actionName} on nothing`
    : `Take ${row.actionName} off ${signalText(row.from)}`;
}

/** One binding helmArray writes into the file, as a unit's button is said: what · on what. */
function fileLine(row: ApplyGameRow): string {
  if (row.to !== null) return `${row.actionName} · ${signalText(row.to)}`;
  return row.from === null
    ? `${row.actionName} · on nothing`
    : `${row.actionName} · off ${signalText(row.from)}`;
}

/** The file's note: the bindings in each mode, when there are several, and the copy kept. */
function fileNote(game: ApplyGame): string {
  if (game.file?.same === true) return 'It already holds these bindings.';
  const modes = new Map<string, number>();
  for (const row of game.rows) modes.set(row.modeName, (modes.get(row.modeName) ?? 0) + 1);
  if (modes.size < 2) return 'A copy of the old file is kept.';
  return [...[...modes].map(([mode, n]) => `${mode} ${n}`), 'a copy of the old file is kept'].join(
    ' · ',
  );
}

/** The game's half, or null when no binding changes and no file is written. */
export function gameSection(game: ApplyGame, title?: string): GameSection | null {
  // Main sends the file only for the file it writes.
  const { file } = game;
  if (game.rows.length === 0 && file === undefined) return null;
  const sets = new Set(game.rows.map((r) => r.set));
  const modes = new Set(game.rows.map((r) => r.mode));
  const groups = new Map<string, { label: string; lines: string[] }>();
  for (const row of game.rows) {
    const key = `${row.set}|${row.mode}`;
    // Only what tells the groups apart: the set when there are two, the mode when there are more.
    const label = [
      ...(sets.size > 1 ? [SET_WORD[row.set]] : []),
      ...(modes.size > 1 ? [row.modeName] : []),
    ].join(' · ');
    const group = groups.get(key) ?? { label, lines: [] };
    group.lines.push(game.via === 'file' ? fileLine(row) : rowLine(row));
    groups.set(key, group);
  }
  const n = game.rows.length;
  const sheet = game.via === 'sheet';
  const counted = n === 1 ? '1 binding' : `${n} bindings`;
  return {
    title: title ?? (sheet ? "In the game's controls" : 'Game file'),
    summary: sheet ? `${n} to set by hand` : file?.same === true ? 'No change' : counted,
    ...(file === undefined || file.name === null ? {} : { file: file.name }),
    ...(file !== undefined
      ? { note: fileNote(game) }
      : game.note === undefined
        ? {}
        : { note: game.note }),
    groups: [...groups.values()].map((g) => ({
      label: groups.size > 1 ? g.label : null,
      lines: g.lines,
    })),
  };
}

/**
 * What the drawer says while Apply runs: what is being written, for the units the setup uses, and
 * the game's file when it changes.
 */
function progressWords(preview: ApplyPreview): string {
  const used = [preview.left, preview.right].filter((u) => u.used).map((u) => u.hand);
  const { game } = preview;
  const name = preview.gameName === '' ? 'the game' : preview.gameName;
  const file = game.file !== undefined && !game.file.same;
  const its = `${preview.gameName === '' ? "the game's" : `${preview.gameName}'s`} controls file`;
  if (used.length === 0) return file ? `Writing ${its}. Keep ${name} closed.` : 'Applying…';
  const units =
    used.length === 2
      ? 'Writing to your Azerons, the left one first'
      : `Writing to your ${used[0] === 'left' ? 'left' : 'right'} Azeron`;
  const keep = used.length === 2 ? 'Keep them plugged in' : 'Keep it plugged in';
  if (file) return `${units}, then ${its}. ${keep}, and the Azeron app and ${name} closed.`;
  return `${units}. ${keep} and the Azeron app closed.`;
}

/**
 * The rows of actions the game's file doesn't have (added by hand), to set in the game's own menu;
 * null when there are none.
 */
export function byHandSection(preview: ApplyPreview, title?: string): GameSection | null {
  const rows = preview.game.byHand ?? [];
  if (rows.length === 0) return null;
  const file =
    preview.gameName === '' ? "The game's controls file" : `${preview.gameName}'s controls file`;
  const what = rows.length === 1 ? 'this action' : 'these actions';
  return gameSection(
    {
      via: 'sheet',
      rows,
      note: `${file} doesn't have ${what}, so set ${rows.length === 1 ? 'it' : 'them'} in the game's own menu.`,
    },
    title,
  );
}

export function drawerView(state: DrawerState): DrawerView {
  const closed: Pick<DrawerView, 'sections' | 'checks' | 'game' | 'byHand' | 'sheet'> = {
    sections: [],
    checks: [],
    game: null,
    byHand: null,
    sheet: null,
  };
  const idle = { progress: null, result: null, loading: null, unavailable: null, notice: null };
  if (state.phase === 'loading') {
    return {
      title: 'Apply',
      subtitle: 'What changes',
      ...idle,
      loading: 'Looking at what changes…',
      notice: state.notice ?? null,
      ...closed,
      cancel: { label: 'Cancel', disabled: false },
      apply: { label: 'Apply', disabled: true },
      closable: true,
    };
  }
  if (state.phase === 'unavailable') {
    return {
      title: 'Apply',
      subtitle: 'What changes',
      ...idle,
      unavailable: state.message,
      ...closed,
      cancel: { label: 'Close', disabled: false },
      apply: { label: 'Apply', disabled: true },
      closable: true,
    };
  }
  const { preview } = state;
  const head = {
    title: preview.schemeName === '' ? 'Apply' : `Apply ${preview.schemeName}`,
    subtitle: preview.gameName === '' ? 'What changes' : `${preview.gameName} · what changes`,
  };
  // A unit the setup doesn't use (the right one, for the left Azeron and the mouse) has no section.
  const sections = [preview.left, preview.right]
    .filter((u) => u.used)
    .map((u) => unitSection(u, preview.azeronOpen));
  const game = gameSection(preview.game);
  const byHand = byHandSection(preview);
  if (state.phase === 'ready') {
    return {
      ...head,
      ...idle,
      notice: state.notice ?? null,
      checks: shownChecks(preview.checks),
      sections,
      game,
      byHand,
      sheet: null,
      cancel: { label: 'Cancel', disabled: false },
      apply: { label: 'Apply', disabled: !canApply(state) },
      closable: true,
    };
  }
  if (state.phase === 'applying') {
    return {
      ...head,
      ...idle,
      progress: progressWords(preview),
      checks: shownChecks(preview.checks),
      sections,
      game,
      byHand,
      sheet: null,
      cancel: { label: 'Cancel', disabled: true },
      apply: { label: 'Applying…', disabled: true },
      closable: false,
    };
  }
  const { result } = state;
  const nowTitle =
    preview.gameName === ''
      ? "Now, in the game's controls"
      : `Now, in ${preview.gameName}'s controls`;
  return {
    ...head,
    ...idle,
    result: {
      ok: result.ok,
      headline: result.message,
      // The units' own sentences and the game file's, but not the one already said as the headline.
      lines: [
        ...result.units.map((u) => u.message),
        ...(result.gameFile ? [result.gameFile.message] : []),
      ].filter((m) => m !== result.message),
    },
    checks: [],
    sections: [],
    game: null,
    byHand: null,
    // Rows only the person can now set: the units are done, the game is theirs.
    sheet: !result.ok
      ? null
      : preview.game.via === 'sheet'
        ? gameSection(preview.game, nowTitle)
        : byHandSection(preview, nowTitle),
    cancel: { label: 'Close', disabled: false },
    apply: result.ok ? null : { label: 'Try again', disabled: false },
    closable: true,
  };
}
