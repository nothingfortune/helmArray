// The action picker (canvas board docs/design/canvas/EditorPicker.dc.html, drawn in Editor.dc.html):
// "Change" or "Add" on a press opens it over the side panel, to choose that press's action by
// search and role. Pure: what it offers comes from the editor's own view (`lists`, `moves`,
// `onStick`), so the picker and the list under the panel never disagree.

import type { ActionId, ControlId, Game, ModeId, Press, Role, Scheme } from '@helmarray/core';
import { ROLES, own } from '@helmarray/core';
import { shownAction } from './editor-model';
import type { ActionRef, ControlWord, EditorView } from './editor-view';
import type { Picking } from './reveal';
import { ROLE_WORDS } from './role-words';

/** A role, actions with none (#98), or every action. */
export type RoleFilter = 'all' | 'none' | Role;

/**
 * Where an action is now: on no control of the set, on another control of it (or another press of
 * this one: picking moves it here), or on a stick (picking puts it here as well).
 */
export type GroupId = 'free' | 'placed' | 'stick';

export interface PickerCandidate extends ActionRef {
  group: GroupId;
  /** Where it is now, in the panel's words; none for an action on no control. */
  where?: string;
  /** The player's key label for it, where it is shown on a control in this mode. */
  label?: string;
}

/** What the picker offers for the press being chosen. */
export interface PickerSource {
  /** What the selected control is called: key, mouse button or button (#91). */
  word: ControlWord;
  /** Each action of the mode once, in the game's order; never the one already on the press. */
  candidates: readonly PickerCandidate[];
}

export interface PickerGroup {
  id: GroupId;
  title: string;
  rows: PickerCandidate[];
}

export interface FilterChip {
  id: RoleFilter;
  name: string;
  /** The role, for its colour; none for All and No role. */
  role?: Role;
  pressed: boolean;
}

export interface PickerView {
  /** The groups with something to show, in the board's order. */
  groups: PickerGroup[];
  /** Every row shown, in order: what the arrow keys move through. */
  rows: PickerCandidate[];
  filters: FilterChip[];
  /** "7 actions", or "4 of 7 Ship actions" while some are filtered out. */
  count: string;
  /** What is said in place of the results when there are none; null while some are shown. */
  empty: string | null;
  placeholder: string;
}

/** The words of a text, lower case: letters and digits, split at everything else. */
const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '');

/**
 * How well a search matches a text, best first: 0 the whole text (or an empty search), 1 its
 * start, 2 every word of the search starting a word of the text, 3 every word of it found inside
 * the text. Null when one word of the search is not there. Case is ignored, and the search's words
 * may be partial and in any order.
 */
export function matchRank(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === '') return 0;
  const t = text.toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  const tokens = wordsOf(q);
  // A search of punctuation alone ("%") is looked for as it is.
  if (tokens.length === 0) return t.includes(q) ? 3 : null;
  const words = wordsOf(t);
  if (tokens.every((token) => words.some((w) => w.startsWith(token)))) return 2;
  return tokens.every((token) => t.includes(token)) ? 3 : null;
}

/** How well a candidate matches: by its name, else by its key label just after an equal name. */
function candidateRank(query: string, c: PickerCandidate): number | null {
  const byName = matchRank(query, c.name);
  const byLabel = c.label === undefined ? null : matchRank(query, c.label);
  const ranks = [
    ...(byName === null ? [] : [byName * 2]),
    ...(byLabel === null ? [] : [byLabel * 2 + 1]),
  ];
  return ranks.length === 0 ? null : Math.min(...ranks);
}

/** The key labels of a mode, by the action each one's control shows. */
function labelsOf(scheme: Scheme, mode: ModeId): Map<ActionId, string> {
  const labels = new Map<ActionId, string>();
  for (const [control, label] of Object.entries(own(scheme.keyLabels ?? {}, mode) ?? {})) {
    const shown = shownAction(scheme, mode, control);
    if (shown !== undefined && typeof label === 'string' && !labels.has(shown.id))
      labels.set(shown.id, label);
  }
  return labels;
}

/**
 * What the picker offers for the selected control's target press, from the editor's view of it:
 * the actions on no control of its set, those on another control of the set or another press of
 * this one, and those a stick does. Null with nothing selected, or a stick (it takes no action).
 */
export function pickerSource(
  view: EditorView,
  scheme: Scheme,
  game: Game,
  mode: ModeId,
): PickerSource | null {
  const panel = view.panel;
  if (panel === null || panel.stick) return null;
  const word = view.controlWord;
  const labels = labelsOf(scheme, mode);
  const order = new Map(game.actions.map((a, i) => [a.id, i]));
  const target = panel.presses.find((r) => r.target);
  // The action on the press being chosen is where it would go: it is offered nowhere.
  const seen = new Set<ActionId>(target?.action === undefined ? [] : [target.action.id]);
  const byGroup: Record<GroupId, PickerCandidate[]> = { free: [], placed: [], stick: [] };
  const add = (group: GroupId, a: ActionRef, where?: string) => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    const label = labels.get(a.id);
    byGroup[group].push({
      id: a.id,
      name: a.name,
      ...(a.role === undefined ? {} : { role: a.role }),
      group,
      ...(where === undefined ? {} : { where }),
      ...(label === undefined ? {} : { label }),
    });
  };
  for (const list of view.lists) for (const a of list.actions) add('free', a);
  for (const row of panel.presses)
    if (row.action !== undefined) add('placed', row.action, `${row.word} on this ${word}`);
  for (const a of view.moves) add('placed', a, a.where);
  for (const a of view.onStick) add('stick', a, a.where);
  const inGameOrder = (list: PickerCandidate[]) =>
    [...list].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return {
    word,
    candidates: [
      ...inGameOrder(byGroup.free),
      ...inGameOrder(byGroup.placed),
      ...inGameOrder(byGroup.stick),
    ],
  };
}

const GROUPS: readonly GroupId[] = ['free', 'placed', 'stick'];

function groupTitle(group: GroupId, word: ControlWord): string {
  if (group === 'free') return `Not on a ${word}`;
  if (group === 'placed') return `Already on a ${word} · picking moves it here`;
  return 'On the stick · picking puts it here too';
}

const inRole = (role: RoleFilter, c: PickerCandidate): boolean =>
  role === 'all' || (role === 'none' ? c.role === undefined : c.role === role);

const filterName = (role: RoleFilter): string =>
  role === 'all' ? 'All' : role === 'none' ? 'No role' : ROLE_WORDS[role];

/** What is said when nothing is shown. */
function emptyLine(query: string, role: RoleFilter): string {
  const q = query.trim();
  const within = role === 'all' ? '' : ` in ${filterName(role)}`;
  if (q !== '') return `Nothing matches “${q}”${within}.`;
  if (role === 'none') return 'No actions without a role here.';
  if (role === 'all') return 'No actions to pick here.';
  return `No ${ROLE_WORDS[role]} actions here.`;
}

/**
 * The picker as drawn for a search and a role: the candidates that match both, best match first
 * within each group (the game's order between equals), each group counted, the filter chips (No
 * role only when an action has none), and the count of what is shown.
 */
export function pickerView(
  source: PickerSource,
  query: string,
  role: RoleFilter,
  modeName: string | null,
): PickerView {
  const ranked: { c: PickerCandidate; rank: number; at: number }[] = [];
  source.candidates.forEach((c, at) => {
    if (!inRole(role, c)) return;
    const rank = candidateRank(query, c);
    if (rank !== null) ranked.push({ c, rank, at });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.at - b.at);
  const groups = GROUPS.map((id) => ({
    id,
    title: groupTitle(id, source.word),
    rows: ranked.filter((r) => r.c.group === id).map((r) => r.c),
  })).filter((g) => g.rows.length > 0);
  const rows = groups.flatMap((g) => g.rows);
  const total = source.candidates.length;
  const noun = `${modeName === null ? '' : `${modeName} `}actions`;
  const roles: RoleFilter[] = [
    'all',
    ...ROLES,
    ...(source.candidates.some((c) => c.role === undefined) ? (['none'] as const) : []),
  ];
  return {
    groups,
    rows,
    filters: roles.map((id) => ({
      id,
      name: filterName(id),
      ...(id === 'all' || id === 'none' ? {} : { role: id }),
      pressed: id === role,
    })),
    count: rows.length === total ? `${total} ${noun}` : `${rows.length} of ${total} ${noun}`,
    empty: rows.length === 0 ? emptyLine(query, role) : null,
    placeholder: `Search ${noun}`,
  };
}

/**
 * The result an arrow key moves to, from `active` among `length`; it stops at the ends. Null for
 * any other key: Home and End stay the search field's, to move in what is typed.
 */
export function stepActive(active: number, key: string, length: number): number | null {
  if (key === 'ArrowDown') return Math.min(active + 1, Math.max(0, length - 1));
  if (key === 'ArrowUp') return Math.max(active - 1, 0);
  return null;
}

/** What a key does in the picker: close it, pick the result shown, or move to another. */
export type PickerKey = { kind: 'close' } | { kind: 'pick' } | { kind: 'move'; to: number };

/**
 * What a key pressed in the picker does. Esc closes it from anywhere in it; Enter and the arrows
 * act from the search field only, so on a chip or Close they stay those buttons' own. Null: the
 * key is left to what has the focus (typing, Tab).
 */
export function pickerKey(
  key: string,
  inSearch: boolean,
  active: number,
  length: number,
): PickerKey | null {
  if (key === 'Escape') return { kind: 'close' };
  if (!inSearch) return null;
  if (key === 'Enter') return length > 0 ? { kind: 'pick' } : null;
  const to = stepActive(active, key, length);
  return to === null ? null : { kind: 'move', to };
}

/** The filter after a chip is pressed: its role, or every role when it was the one in use. */
export const nextRole = (current: RoleFilter, chip: RoleFilter): RoleFilter =>
  chip === current ? 'all' : chip;

/**
 * The picker asked for, while it still stands: its control selected with the side panel shown on
 * it, at its press. Anything that moves the selection or the press (a fix, an undo, a tab, a switch
 * of output) shuts it, rather than leaving it choosing for somewhere else.
 */
export function openPicker(
  picking: Picking | null,
  now: {
    inspector: boolean;
    selected: ControlId | undefined;
    panel: ControlId | undefined;
    target: Press;
  },
): Picking | null {
  if (picking === null || !now.inspector) return null;
  const here =
    picking.control === now.selected &&
    picking.control === now.panel &&
    picking.press === now.target;
  return here ? picking : null;
}

/** What the picker keeps while it is open: the search, the role, the result Enter would pick. */
export interface PickerState {
  query: string;
  role: RoleFilter;
  active: number;
}

export const PICKER_START: PickerState = { query: '', role: 'all', active: 0 };

export type PickerAction =
  | { type: 'query'; text: string }
  | { type: 'role'; chip: RoleFilter }
  | { type: 'move'; to: number };

/** The picker after a search is typed, a chip pressed or an arrow moved: a new list starts at its top. */
export function pickerReducer(state: PickerState, action: PickerAction): PickerState {
  if (action.type === 'query') return { ...state, query: action.text, active: 0 };
  if (action.type === 'role')
    return { ...state, role: nextRole(state.role, action.chip), active: 0 };
  return { ...state, active: action.to };
}
