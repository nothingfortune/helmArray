import { describe, expect, it } from 'vitest';
import type { Signal } from './model';
import type { KeptSheets, SheetRow } from './sheets';
import { NO_SHEETS, dismissSheet, keepSheet } from './sheets';

const row = (action: string, to: Signal | null, over: Partial<SheetRow> = {}): SheetRow => ({
  set: 'keyboard',
  mode: 'default',
  modeName: 'Default',
  action,
  actionName: action,
  to,
  from: null,
  ...over,
});
const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;
const keyOf = (r: SheetRow) => `${r.set}|${r.mode}|${r.action}`;

/** The rows of one game's sheet, grouped by action (set, mode and action), each group in order. */
const groups = (rows: readonly SheetRow[]) => {
  const out = new Map<string, SheetRow[]>();
  for (const r of rows) out.set(keyOf(r), [...(out.get(keyOf(r)) ?? []), r]);
  return Object.fromEntries([...out].sort(([a], [b]) => (a < b ? -1 : 1)));
};

/** A small seeded generator, so a failure names the run that found it. */
function random(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    s ^= s >>> 13;
    return s % n;
  };
}

describe('the bind sheet kept across applies', () => {
  it('keeps every row an apply gave one action, not only the last (two keys for one action)', () => {
    const first = keepSheet(NO_SHEETS, 'g', 'Game', [row('jump', key('J'))]);
    const second = keepSheet(first, 'g', 'Game', [row('jump', key('K')), row('jump', key('L'))]);
    expect(second.games[0]?.rows).toEqual([row('jump', key('K')), row('jump', key('L'))]);
  });

  it('for any run of applies, holds the latest rows of each action, and older ones for actions not touched since', () => {
    const actions = ['jump', 'fire', 'map', 'reload'];
    const sets = ['keyboard', 'controller'] as const;
    const codes = ['A', 'B', 'C', 'D', 'E'];
    const faults: string[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const pick = random(seed);
      let kept: KeptSheets = NO_SHEETS;
      // What each action's rows should be: those of the latest apply that had it.
      const latest = new Map<string, SheetRow[]>();
      const applies = 1 + pick(6);
      for (let n = 0; n < applies; n++) {
        const rows: SheetRow[] = [];
        for (const action of actions) {
          if (pick(2) === 0) continue;
          const set = sets[pick(2)] ?? 'keyboard';
          const count = 1 + pick(3);
          for (let i = 0; i < count; i++) {
            const to = pick(4) === 0 ? null : key(codes[pick(codes.length)] ?? 'A');
            rows.push(row(action, to, { set }));
          }
        }
        kept = keepSheet(kept, 'g', 'Game', rows);
        const fresh = new Map<string, SheetRow[]>();
        for (const r of rows) fresh.set(keyOf(r), [...(fresh.get(keyOf(r)) ?? []), r]);
        for (const [k, group] of fresh) latest.set(k, group);
      }
      const want = groups([...latest.values()].flat());
      const got = groups(kept.games.find((g) => g.gameId === 'g')?.rows ?? []);
      if (JSON.stringify(got) !== JSON.stringify(want)) faults.push(`seed ${seed}`);
    }
    expect(faults).toEqual([]);
  });

  it('puts the game applied last first, keeps the others, and Done drops only that game', () => {
    const both = keepSheet(keepSheet(NO_SHEETS, 'a', 'A', [row('jump', key('J'))]), 'b', 'B', [
      row('fire', key('F')),
    ]);
    expect([
      both.games.map((g) => g.gameId),
      dismissSheet(both, 'b').games.map((g) => g.gameId),
    ]).toEqual([['b', 'a'], ['a']]);
  });

  it('keeps nothing new for an apply that left nothing to set', () => {
    const kept = keepSheet(NO_SHEETS, 'a', 'A', [row('jump', key('J'))]);
    expect(keepSheet(kept, 'a', 'A', [])).toEqual(kept);
  });
});
