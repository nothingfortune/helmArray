// Properties of the merge of a game's file into its data (core's mergeHarvest), over the games'
// own files (reference/game-files, read only): harvest, the person edits, the game changes, and the
// file is read again. For random edits and random game changes:
// - every edit the person made is still there (a name, a default key or button set or cleared, a
//   role, an action deleted, an action added by hand); a field left as the file had it is no edit;
// - the result is a game that can be saved;
// - reading the same file once more changes nothing.

import { readFileSync } from 'node:fs';
import type { Action, Game, PadControl, Role, Signal } from '@helmarray/core';
import { KEY_CODES, PAD_CONTROLS, ROLES, gameProblem, mergeHarvest } from '@helmarray/core';
import { harvestEliteBinds, harvestUnrealIni } from '@helmarray/games';
import { describe, expect, it } from 'vitest';

const read = (name: string): string =>
  readFileSync(new URL(`../reference/game-files/${name}`, import.meta.url), 'utf8');
const META = { id: 'g', name: 'G' };

const FILES: { name: string; harvest: () => Game }[] = [
  {
    name: 'Everspace 2',
    harvest: () => harvestUnrealIni(read('everspace2-Input.before.ini'), META).game,
  },
  {
    name: 'Elite, Custom',
    harvest: () => harvestEliteBinds(read('elite-Custom.4.1.binds'), META).game,
  },
];

/** A small seeded generator (mulberry32): the same seed, the same runs, on every machine. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RUNS = 60;

/** What the person did to one action, field by field; the last edit of a field wins. */
interface Expected {
  name?: string;
  key?: Signal | null;
  pad?: PadControl | null;
  role?: Role;
  deleted?: true;
  added?: Action;
}

function withNative(a: Action, key: Signal | undefined, pad: PadControl | undefined): Action {
  const rest = { ...a };
  delete rest.native;
  return key === undefined && pad === undefined
    ? rest
    : {
        ...rest,
        native: { ...(key === undefined ? {} : { key }), ...(pad === undefined ? {} : { pad }) },
      };
}

/** Up to eight edits, as the Game screen makes them, and what each should leave. */
function edit(game: Game, next: () => number): { game: Game; expected: Map<string, Expected> } {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  const expected = new Map<string, Expected>();
  let g = game;
  const n = 1 + Math.floor(next() * 8);
  for (let i = 0; i < n; i++) {
    const action = pick(g.actions);
    const id = action.id;
    const had = expected.get(id) ?? {};
    const change = (a: Action): void => {
      g = { ...g, actions: g.actions.map((x) => (x.id === id ? a : x)) };
    };
    switch (pick(['name', 'key', 'clear-key', 'pad', 'clear-pad', 'role', 'delete', 'add'])) {
      case 'name': {
        const name = `${action.name} (mine ${i})`;
        change({ ...action, name });
        expected.set(id, { ...had, name });
        break;
      }
      case 'key': {
        const key: Signal = { kind: 'key', code: pick(KEY_CODES) };
        change(withNative(action, key, action.native?.pad));
        expected.set(id, { ...had, key });
        break;
      }
      case 'clear-key':
        change(withNative(action, undefined, action.native?.pad));
        expected.set(id, { ...had, key: null });
        break;
      case 'pad': {
        const pad = pick(PAD_CONTROLS);
        change(withNative(action, action.native?.key, pad));
        expected.set(id, { ...had, pad });
        break;
      }
      case 'clear-pad':
        change(withNative(action, action.native?.key, undefined));
        expected.set(id, { ...had, pad: null });
        break;
      case 'role': {
        const role = pick(ROLES);
        change({ ...action, role });
        expected.set(id, { ...had, role });
        break;
      }
      case 'delete':
        if (expected.get(id)?.added !== undefined) break;
        g = {
          ...g,
          actions: g.actions.filter((a) => a.id !== id),
          retired: {
            modes: g.retired?.modes ?? [],
            actions: [...(g.retired?.actions ?? []), id],
          },
        };
        expected.set(id, { deleted: true });
        break;
      case 'add': {
        const added: Action = {
          id: `mine_${i}`,
          name: `Mine ${i}`,
          mode: action.mode,
          required: false,
          native: { key: { kind: 'key', code: pick(KEY_CODES) } },
        };
        g = { ...g, actions: [...g.actions, added] };
        expected.set(added.id, { added });
        break;
      }
    }
  }
  // An action added by hand and then edited is expected as it ends up. A field left as the file
  // had it (set to the value it had, or changed and changed back) was not changed: it follows the
  // file, as a field never touched does.
  for (const [id, want] of expected) {
    const now = g.actions.find((a) => a.id === id);
    if (want.added !== undefined && now !== undefined) expected.set(id, { added: now });
    const was = game.actions.find((a) => a.id === id);
    if (was === undefined || want.deleted === true || want.added !== undefined) continue;
    const kept: Expected = { ...want };
    if (kept.name === was.name) delete kept.name;
    if (kept.role === was.role) delete kept.role;
    if (JSON.stringify(kept.key) === JSON.stringify(was.native?.key ?? null)) delete kept.key;
    if (kept.pad === (was.native?.pad ?? null)) delete kept.pad;
    expected.set(id, kept);
  }
  return { game: g, expected };
}

/** The game updated: some defaults moved, some actions renamed, gone or new. */
function update(file: Game, next: () => number): Game {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  const actions = file.actions.flatMap((a): Action[] => {
    const r = next();
    if (r < 0.05) return [];
    if (r < 0.15) return [withNative(a, { kind: 'key', code: pick(KEY_CODES) }, a.native?.pad)];
    if (r < 0.2) return [withNative(a, a.native?.key, pick(PAD_CONTROLS))];
    if (r < 0.25) return [{ ...a, name: `${a.name} v2` }];
    return [a];
  });
  const mode = pick(file.modes).id;
  return {
    ...file,
    actions: [...actions, { id: 'NewInUpdate', name: 'New in the update', mode, required: false }],
  };
}

/** Every edit that didn't survive the merge, in words. */
function lost(merged: Game, expected: ReadonlyMap<string, Expected>): string[] {
  const faults: string[] = [];
  for (const [id, want] of expected) {
    const a = merged.actions.find((x) => x.id === id);
    if (want.deleted === true) {
      if (a !== undefined) faults.push(`${id} came back`);
      continue;
    }
    if (a === undefined) {
      faults.push(`${id} is gone`);
      continue;
    }
    if (want.added !== undefined && JSON.stringify(a) !== JSON.stringify(want.added))
      faults.push(`${id}, added by hand, changed`);
    if (want.name !== undefined && a.name !== want.name) faults.push(`${id} lost its name`);
    if (want.role !== undefined && a.role !== want.role) faults.push(`${id} lost its role`);
    if (
      want.key !== undefined &&
      JSON.stringify(a.native?.key ?? null) !== JSON.stringify(want.key)
    )
      faults.push(`${id} lost its key`);
    if (want.pad !== undefined && (a.native?.pad ?? null) !== want.pad)
      faults.push(`${id} lost its controller button`);
  }
  return faults;
}

describe.each(FILES)('reading $name again after edits and an update', ({ harvest }) => {
  const runs = Array.from({ length: RUNS }, (_, run) => {
    const next = random(0x4a7 + run);
    const file = harvest();
    const first = mergeHarvest(null, file).game;
    const { game: mine, expected } = edit(first, next);
    const later = update(file, next);
    const merged = mergeHarvest(mine, later).game;
    return { run, expected, later, merged };
  });

  it(`never loses an edit the person made, over ${RUNS} runs`, () => {
    const faults = runs.flatMap(({ run, merged, expected }) =>
      lost(merged, expected).map((f) => `run ${run}: ${f}`),
    );
    expect(faults).toEqual([]);
  });

  it(`gives a game that can be saved, over ${RUNS} runs`, () => {
    const faults = runs.flatMap(({ run, merged }) => {
      const problem = gameProblem(merged);
      return problem === null ? [] : [`run ${run}: ${problem}`];
    });
    expect(faults).toEqual([]);
  });

  it(`changes nothing when the same file is read once more, over ${RUNS} runs`, () => {
    const faults = runs.flatMap(({ run, merged, later }) => {
      const again = mergeHarvest(merged, later);
      return JSON.stringify(again.game) === JSON.stringify(merged) &&
        again.changes.every((c) => c.kind === 'kept' || c.kind === 'gone')
        ? []
        : [`run ${run}`];
    });
    expect(faults).toEqual([]);
  });

  it(`takes every default the update moved that the person left alone, over ${RUNS} runs`, () => {
    const faults = runs.flatMap(({ run, merged, later, expected }) =>
      later.actions.flatMap((t) => {
        const want = expected.get(t.id);
        if (want !== undefined) return [];
        const a = merged.actions.find((x) => x.id === t.id);
        return JSON.stringify(a?.native) === JSON.stringify(t.native) && a?.name === t.name
          ? []
          : [`run ${run}: ${t.id}`];
      }),
    );
    expect(faults).toEqual([]);
  });
});
