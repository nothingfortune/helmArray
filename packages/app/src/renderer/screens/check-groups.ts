// The checks as the Editor lists them: a finding that repeats for several actions of one role is
// one line ("4 movement actions aren't on a button"), opened to show each. Pure.

import type { Game, Role, Scheme } from '@helmarray/core';
import type { FindingRow } from './editor-view';
import type { Fix } from './fixes';

/** Several findings of one rule about actions of one role, in one mode, said as one. */
export interface CheckGroup {
  kind: 'group';
  /** Stable across edits, so the list does not flicker. */
  key: string;
  rule: string;
  role: Role | null;
  /** Every finding in it, in the order they were listed. */
  rows: FindingRow[];
  /** The sentence, its subject apart to draw bold: "4 movement actions", " aren't on a button." */
  subject: string;
  rest: string;
  /** Every finding in it has a fix: one click applies them all, each on the scheme as it then is. */
  fix?: Fix;
  /** Every finding in it can be kept. */
  canKeep: boolean;
}

export type CheckItem = { kind: 'row'; row: FindingRow } | CheckGroup;

/** The rules whose findings are grouped by role, and what the group says after its subject. */
const GROUPED: Readonly<Record<string, { rest: string; fix: string }>> = {
  'missing-required': { rest: " aren't on a button", fix: 'Put them on buttons' },
};

const ROLE_WORDS: Readonly<Record<Role, string>> = {
  combat: 'combat',
  movement: 'movement',
  ability: 'ability',
  travel: 'travel',
  menu: 'menu',
};

/**
 * The findings in the order given, with every two or more of a grouped rule about actions of one
 * role, in one mode, in one group at the place of the first. Anything else stays a row of its own.
 */
export function groupChecks(
  rows: readonly FindingRow[],
  game: Game,
  /**
   * Whether the group's one fix settles all its findings (the fix gate), by its key; without it,
   * trusted.
   */
  works: (fix: Fix, rows: readonly FindingRow[], key: string) => boolean = () => true,
): CheckItem[] {
  const roleOf = (row: FindingRow): Role | null =>
    game.actions.find((a) => a.id === row.finding.action)?.role ?? null;
  const groupKey = (row: FindingRow): string | null =>
    Object.hasOwn(GROUPED, row.finding.rule) && row.finding.action !== undefined
      ? `${row.finding.rule}|${roleOf(row) ?? ''}|${row.finding.mode ?? ''}`
      : null;
  const members = new Map<string, FindingRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    if (key !== null) members.set(key, [...(members.get(key) ?? []), row]);
  }
  const out: CheckItem[] = [];
  const placed = new Set<string>();
  for (const row of rows) {
    const key = groupKey(row);
    const group = key === null ? undefined : members.get(key);
    if (key === null || group === undefined || group.length < 2) {
      out.push({ kind: 'row', row });
      continue;
    }
    if (placed.has(key)) continue;
    placed.add(key);
    out.push(groupOf(key, group, roleOf(row), game, works));
  }
  return out;
}

function groupOf(
  key: string,
  rows: FindingRow[],
  role: Role | null,
  game: Game,
  works: (fix: Fix, rows: readonly FindingRow[], key: string) => boolean,
): CheckGroup {
  const rule = rows[0]?.finding.rule ?? '';
  const words = GROUPED[rule] ?? { rest: '', fix: '' };
  const mode = rows[0]?.finding.mode;
  const inMode =
    game.modes.length > 1 && mode !== undefined
      ? ` in ${game.modes.find((m) => m.id === mode)?.name ?? mode}`
      : '';
  const fixes = rows.map((r) => r.fix);
  const group: CheckGroup = {
    kind: 'group',
    key: `group|${key}`,
    rule,
    role,
    rows,
    subject: `${rows.length} ${role === null ? '' : `${ROLE_WORDS[role]} `}actions`,
    rest: `${words.rest}${inMode}.`,
    canKeep: rows.every((r) => r.canKeep),
  };
  if (fixes.every((f): f is Fix => f !== undefined)) {
    // It puts several on: it reveals their mode, and selects none of them.
    const fix: Fix = {
      label: words.fix,
      apply: (scheme: Scheme) => fixes.reduce((s, f) => f.apply(s), scheme),
      ...(mode === undefined ? {} : { reveal: () => ({ mode }) }),
    };
    if (works(fix, rows, group.key)) group.fix = fix;
  }
  return group;
}
