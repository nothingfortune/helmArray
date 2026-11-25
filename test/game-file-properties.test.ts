// Properties of both adapters over the game's own files (reference/game-files, read only):
// - for random change lists drawn from the harvested actions, harvest(write(file, changes)) has
//   the changed bindings, every action the changes leave alone is as it was, and every line the
//   changes don't touch is byte for byte the line it was;
// - a plan from core's resolver, on the game's own presets, writes back the file it came from.

import { readFileSync } from 'node:fs';
import type { Action, GameBinding, Game, Signal } from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
  KEY_CODES,
  MOUSE_BUTTONS,
  PAD_CONTROLS,
  gameKeysPreset,
  resolve,
  signalId,
  xboxControllerPreset,
} from '@helmarray/core';
import type { Harvest } from '@helmarray/games';
import {
  GameFileError,
  eliteKeyOf,
  harvestEliteBinds,
  harvestUnrealIni,
  unrealKeyOf,
  writeEliteBinds,
  writeUnrealIni,
} from '@helmarray/games';
import { describe, expect, it } from 'vitest';

const read = (name: string): string =>
  readFileSync(new URL(`../reference/game-files/${name}`, import.meta.url), 'utf8');
const META = { id: 'g', name: 'G' };

interface Format {
  name: string;
  file: string;
  harvest: (file: string) => Harvest;
  write: (file: string, rows: readonly GameBinding[]) => string;
  names: (signal: Signal) => boolean;
  /** The file cut into pieces, each the action it belongs to, or null: a write may change only those. */
  units: (file: string) => { of: string | null; text: string }[];
}

/** Each line, belonging to the action its Action field names. */
const unrealUnits = (file: string) =>
  file
    .split(/(?<=\n)/)
    .map((text) => ({ of: /^KeybindingsConfig=\(Action=([^,]*),/.exec(text)?.[1] ?? null, text }));

/** Each control, from its opening line to its closing one, and each other line on its own. */
function eliteUnits(file: string): { of: string | null; text: string }[] {
  const out: { of: string | null; text: string }[] = [];
  let open: { of: string; text: string } | null = null;
  for (const text of file.split(/(?<=\n)/)) {
    if (open !== null) {
      open.text += text;
      if (text.trim() === `</${open.of}>`) {
        out.push(open);
        open = null;
      }
      continue;
    }
    const tag = /^\t<([A-Za-z_][\w.-]*)>\s*$/.exec(text)?.[1];
    if (tag === undefined) out.push({ of: null, text });
    else open = { of: tag, text };
  }
  return out;
}
const FORMATS: Format[] = [
  {
    name: 'Everspace 2',
    file: read('everspace2-Input.before.ini'),
    harvest: (file) => harvestUnrealIni(file, META),
    write: writeUnrealIni,
    names: (s) => typeof unrealKeyOf(s) !== 'string',
    units: unrealUnits,
  },
  {
    name: 'Elite, Custom',
    file: read('elite-Custom.4.1.binds'),
    harvest: (file) => harvestEliteBinds(file, META),
    write: writeEliteBinds,
    names: (s) => typeof eliteKeyOf(s, '28DE11FF') !== 'string',
    units: eliteUnits,
  },
  {
    name: 'Elite, KeyboardMouseOnly',
    file: read('elite-KeyboardMouseOnly.binds'),
    harvest: (file) => harvestEliteBinds(file, META),
    write: (file, rows) => writeEliteBinds(file, rows, { padDevice: 'GamePad' }),
    names: (s) => typeof eliteKeyOf(s, 'GamePad') !== 'string',
    units: eliteUnits,
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

const KEYBOARD: Signal[] = [
  ...KEY_CODES.map((code): Signal => ({ kind: 'key', code })),
  ...MOUSE_BUTTONS.map((button): Signal => ({ kind: 'mouse', button })),
  { kind: 'key', code: 'K', mods: ['ctrl'] },
  { kind: 'scroll', dir: 'up', speed: 1 },
];
const CONTROLLER: Signal[] = PAD_CONTROLS.map((control): Signal => ({ kind: 'pad', control }));

const key = (signal: Signal | null | undefined): string | null =>
  signal === null || signal === undefined ? null : signalId(signal);
const nativeOf = (action: Action | undefined, set: GameBinding['set']): string | null =>
  set === 'keyboard'
    ? key(action?.native?.key)
    : key(action?.native?.pad === undefined ? null : { kind: 'pad', control: action.native.pad });

/** Changes to a few actions: each one set, in one binding set, to a signal or to nothing. */
function changesFor(game: Game, next: () => number, names: (s: Signal) => boolean): GameBinding[] {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  const rows: GameBinding[] = [];
  const used = new Set<string>();
  const count = 1 + Math.floor(next() * 6);
  for (let n = 0; n < count; n++) {
    const action = pick(game.actions);
    const set = next() < 0.5 ? 'keyboard' : 'controller';
    const pool = (set === 'keyboard' ? KEYBOARD : CONTROLLER).filter(names);
    const signal = next() < 0.2 ? null : pick(pool);
    // One change per action and set, and no signal twice in one mode: two actions on one key
    // would each displace the other's second key, which is a different property.
    const at = `${action.id}|${set}`;
    const on = signal === null ? null : `${action.mode}|${signalId(signal)}`;
    if (used.has(at) || (on !== null && used.has(on))) continue;
    used.add(at);
    if (on !== null) used.add(on);
    rows.push({ set, mode: action.mode, action: action.id, signal, native: null });
  }
  return rows;
}

const RUNS = 60;
// Each run reads and writes the whole file; instrumented (coverage, Stryker) that is slow.
const SLOW = 60_000;

describe.each(FORMATS)('$name: write, then harvest', (format) => {
  const before = format.harvest(format.file);

  it(
    `gives the changed bindings and keeps every other, over ${RUNS} random change lists`,
    () => {
      const next = random(0x5eed);
      const faults: string[] = [];
      let written = 0;
      for (let run = 0; run < RUNS; run++) {
        const rows = changesFor(before.game, next, format.names);
        let after: Harvest;
        try {
          after = format.harvest(format.write(format.file, rows));
        } catch (error) {
          // A change no slot has room for is refused, never half written: a fault only otherwise.
          if (!(
            error instanceof GameFileError && error.problems.every((p) => p.includes("doesn't fit"))
          ))
            faults.push(`run ${run}: ${String(error)}`);
          continue;
        }
        written++;
        const changed = new Map(rows.map((r) => [`${r.action}|${r.set}`, key(r.signal)]));
        for (const action of after.game.actions)
          for (const set of ['keyboard', 'controller'] as const) {
            const was = before.game.actions.find((a) => a.id === action.id);
            const wanted = changed.has(`${action.id}|${set}`)
              ? changed.get(`${action.id}|${set}`)
              : nativeOf(was, set);
            const got = nativeOf(action, set);
            if (got !== wanted)
              faults.push(`run ${run}: ${action.id} ${set} is ${got}, not ${wanted}`);
          }
      }
      // Most runs must write: a property over refusals would check nothing.
      expect([faults, written > RUNS * 0.8]).toEqual([[], true]);
    },
    SLOW,
  );

  it(
    `changes nothing outside the actions it is asked about, over ${RUNS} random change lists`,
    () => {
      const next = random(0xfeed);
      const faults: string[] = [];
      const was = format.units(format.file);
      for (let run = 0; run < RUNS; run++) {
        const rows = changesFor(before.game, next, format.names);
        let written: string;
        try {
          written = format.write(format.file, rows);
        } catch {
          continue;
        }
        const asked = new Set(rows.map((r) => r.action.replace(/\.neg$/, '')));
        const now = format.units(written);
        if (now.length !== was.length)
          faults.push(`run ${run}: ${now.length} units, not ${was.length}`);
        was.forEach((unit, i) => {
          if (now[i]?.text !== unit.text && !(unit.of !== null && asked.has(unit.of)))
            faults.push(`run ${run}: changed ${JSON.stringify(unit.text.slice(0, 80))}`);
        });
      }
      expect(faults).toEqual([]);
    },
    SLOW,
  );
});

describe('a plan from the resolver', () => {
  const cases = FORMATS.flatMap((format) => {
    const { game } = format.harvest(format.file);
    return [
      { name: `${format.name}, the game's own keys`, format, game, scheme: gameKeysPreset(game) },
      {
        name: `${format.name}, the Xbox controller`,
        format,
        game,
        scheme: xboxControllerPreset(game),
      },
    ];
  });

  it.each(cases)(
    "writes back the file it came from when the setup keeps the game's bindings: $name",
    ({ format, game, scheme }) => {
      const plan = resolve({ ...scheme, writeGameFile: false }, game, BUILT_IN_DEVICES);
      expect(format.write(format.file, plan.gameBindings)).toBe(format.file);
    },
  );

  it.each(FORMATS)(
    'puts each action where a plan with keys from the pool says: $name',
    (format) => {
      const { game } = format.harvest(format.file);
      const plan = resolve(
        { ...gameKeysPreset(game), writeGameFile: true },
        game,
        BUILT_IN_DEVICES,
      );
      const after = format.harvest(format.write(format.file, plan.gameBindings)).game;
      const faults = game.actions.flatMap((action) => {
        const rows = plan.gameBindings.filter(
          (r) => r.action === action.id && r.set === 'keyboard',
        );
        const wanted = rows.flatMap((r) => (r.signal === null ? [] : [signalId(r.signal)]));
        const got = key(after.actions.find((a) => a.id === action.id)?.native?.key);
        return (got === null ? wanted.length === 0 : wanted.includes(got))
          ? []
          : [`${action.id}: ${got}`];
      });
      // The plan moved something: this is a write that changed the file, not one that kept it.
      const moved = plan.gameBindings.some(
        (r) => r.signal !== null && key(r.signal) !== key(r.native),
      );
      expect([faults, moved]).toEqual([[], true]);
    },
  );
});
