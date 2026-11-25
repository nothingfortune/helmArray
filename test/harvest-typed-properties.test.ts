// Properties of a game typed in by hand on the Game screen (one mode, `default`) whose file is then
// read into it (core's mergeHarvest), with everything that names its actions followed to the ids
// the read gave them (core's moveInScheme, moveInPlan, moveInBaselines, as the store does it). Over
// the games' own files (reference/game-files, read only) and random games typed in: names the file
// has (in any case, with any spaces), names it hasn't, and every field typed or left empty; random
// setups placing them, plans applied with them, and what the game holds. For each:
// - nothing typed is lost: every action typed in is still there, under its id or the file's, with
//   every field that was typed as it was typed;
// - nothing anywhere names an action the game doesn't have, or places one in a mode it isn't in;
// - the result is a game that can be saved;
// - reading the same file once more changes nothing.

import { readFileSync } from 'node:fs';
import type {
  Action,
  ActionId,
  ActionUse,
  Baselines,
  ControlId,
  Game,
  GameBinding,
  PadControl,
  Plan,
  Press,
  Role,
  Scheme,
  Signal,
} from '@helmarray/core';
import {
  KEY_CODES,
  PAD_CONTROLS,
  ROLES,
  blankKeysScheme,
  gameProblem,
  mergeHarvest,
  moveInBaselines,
  moveInPlan,
  moveInScheme,
} from '@helmarray/core';
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
const CONTROLS: readonly ControlId[] = [
  'L.index_1',
  'L.middle_1',
  'R.index_1',
  'R.ring_2',
  'key.Q',
];
const PRESSES: readonly Press[] = ['tap', 'long', 'double'];

/** A name as someone types it: another case, and spaces here and there. */
function retype(name: string, next: () => number): string {
  let out = '';
  for (const ch of name) {
    const r = next();
    out += r < 0.3 ? ch.toUpperCase() : r < 0.6 ? ch.toLowerCase() : ch;
    if (next() < 0.1) out += ' ';
  }
  return next() < 0.5 ? ` ${out}` : out;
}

/** Up to ten actions typed in under `default`, half under a name the file has. */
function typedGame(file: Game, next: () => number): Game {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  const n = 1 + Math.floor(next() * 10);
  const actions: Action[] = [];
  for (let i = 0; i < n; i++) {
    const name = next() < 0.5 ? retype(pick(file.actions).name, next) : `Mine ${i}`;
    const key: Signal | undefined =
      next() < 0.5 ? { kind: 'key', code: pick(KEY_CODES) } : undefined;
    const pad: PadControl | undefined = next() < 0.3 ? pick(PAD_CONTROLS) : undefined;
    const role: Role | undefined = next() < 0.4 ? pick(ROLES) : undefined;
    actions.push({
      id: `typed_${i}`,
      name: name.trim() === '' ? `Mine ${i}` : name,
      mode: 'default',
      required: next() < 0.3,
      ...(role === undefined ? {} : { role }),
      ...(key === undefined && pad === undefined
        ? {}
        : {
            native: {
              ...(key === undefined ? {} : { key }),
              ...(pad === undefined ? {} : { pad }),
            },
          }),
    });
  }
  return {
    id: 'g',
    name: 'G',
    steamAppId: 1,
    modes: [{ id: 'default', name: 'Default' }],
    actions,
  };
}

/** Up to three setups placing the typed actions, each keeping a finding about one. */
function setups(game: Game, next: () => number): Scheme[] {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  const out: Scheme[] = [];
  const n = 1 + Math.floor(next() * 3);
  for (let s = 0; s < n; s++) {
    const map: Scheme['map'] = { default: {} };
    for (const control of CONTROLS) {
      if (next() < 0.4) continue;
      const presses: Partial<Record<Press, ActionId>> = {};
      for (const press of PRESSES) if (next() < 0.5) presses[press] = pick(game.actions).id;
      (map['default'] as Scheme['map'][string])[control] = presses;
    }
    out.push({
      ...blankKeysScheme(game),
      id: `s${s}`,
      map,
      accepted: [{ rule: 'missing-required', action: pick(game.actions).id, reason: 'mine' }],
      keyLabels: { default: { [pick(CONTROLS)]: 'LBL' } },
    });
  }
  return out;
}

const rows = (game: Game, next: () => number): GameBinding[] =>
  game.actions
    .filter(() => next() < 0.6)
    .map((a) => ({
      set: next() < 0.5 ? 'keyboard' : 'controller',
      mode: a.mode,
      action: a.id,
      signal: null,
      native: null,
    }));

function applied(scheme: Scheme, game: Game, next: () => number): Plan {
  const bindings = Object.entries(scheme.map['default'] ?? {}).flatMap(([control, presses]) =>
    Object.entries(presses).map(([press, action]) => ({
      mode: 'default',
      control,
      press: press as Press,
      action: action as ActionId,
      signal: { kind: 'key', code: 'F13' } as Signal,
    })),
  );
  return {
    units: {},
    bindings,
    gameBindings: rows(game, next),
    bindSheet: rows(game, next),
    ledger: {},
    findings: game.actions
      .filter(() => next() < 0.2)
      .map((a) => ({ rule: 'r', severity: 'warning', action: a.id, mode: a.mode, message: 'm' })),
  };
}

const usesOf = (schemes: readonly Scheme[]): ActionUse[] =>
  schemes.flatMap((s) =>
    Object.entries(s.map).flatMap(([mode, controls]) =>
      Object.values(controls).flatMap((presses) =>
        Object.values(presses).flatMap((action) =>
          action === undefined ? [] : [{ mode, action }],
        ),
      ),
    ),
  );

/** One typed game, its setups, plans and what it holds, read and followed. */
function run(file: Game, seed: number) {
  const next = random(seed);
  const mine = typedGame(file, next);
  const schemes = setups(mine, next);
  const plans = schemes.map((s) => applied(s, mine, next));
  const baselines: Baselines = { games: [{ gameId: mine.id, held: rows(mine, next) }] };
  const merged = mergeHarvest(mine, file, null, usesOf(schemes));
  return {
    mine,
    merged,
    schemes: schemes.map((s) => moveInScheme(s, merged.moves)),
    plans: plans.map((p) => moveInPlan(p, merged.moves)),
    baselines: moveInBaselines(baselines, mine.id, merged.moves),
  };
}

describe.each(FILES)('a game typed in by hand, then $name read into it', ({ harvest }) => {
  const file = harvest();

  it('loses nothing typed: each action is still there, every field typed as it was', () => {
    const faults: string[] = [];
    for (let seed = 1; seed <= RUNS; seed++) {
      const { mine, merged } = run(file, seed);
      const idOf = new Map(merged.moves.map((m) => [m.action, m.to]));
      for (const a of mine.actions) {
        const now = merged.game.actions.find((x) => x.id === (idOf.get(a.id) ?? a.id));
        if (now === undefined) {
          faults.push(`seed ${seed}: ${a.id} is gone`);
          continue;
        }
        const typed: [string, unknown, unknown][] = [
          ['name', a.name, now.name],
          ['required', a.required, now.required],
          ['role', a.role, a.role === undefined ? undefined : now.role],
          ['key', a.native?.key, a.native?.key === undefined ? undefined : now.native?.key],
          ['pad', a.native?.pad, a.native?.pad === undefined ? undefined : now.native?.pad],
        ];
        for (const [field, was, is] of typed)
          if (JSON.stringify(was) !== JSON.stringify(is))
            faults.push(`seed ${seed}: ${a.id}'s ${field} changed`);
      }
    }
    expect(faults).toEqual([]);
  });

  it('leaves nothing naming an action the game lacks, or placing one outside its mode', () => {
    const faults: string[] = [];
    for (let seed = 1; seed <= RUNS; seed++) {
      const { merged, schemes, plans, baselines } = run(file, seed);
      const modeOf = new Map(merged.game.actions.map((a) => [a.id, a.mode]));
      const check = (where: string, action: string | undefined, mode?: string) => {
        if (action === undefined) return;
        if (!modeOf.has(action)) faults.push(`seed ${seed}: ${where} names ${action}`);
        else if (mode !== undefined && modeOf.get(action) !== mode)
          faults.push(`seed ${seed}: ${where} has ${action} in ${mode}`);
      };
      for (const s of schemes) {
        for (const [mode, controls] of Object.entries(s.map))
          for (const presses of Object.values(controls))
            for (const action of Object.values(presses)) check(`${s.id}'s map`, action, mode);
        for (const a of s.accepted) check(`${s.id}'s kept findings`, a.action);
      }
      for (const [i, p] of plans.entries()) {
        for (const b of [...p.bindings, ...p.gameBindings, ...p.bindSheet])
          check(`plan ${i}`, b.action, b.mode);
        for (const f of p.findings) check(`plan ${i}'s findings`, f.action, f.mode);
      }
      for (const g of baselines.games) for (const r of g.held) check('held', r.action, r.mode);
    }
    expect(faults).toEqual([]);
  });

  it('is a game that can be saved, and a second read changes nothing', () => {
    const faults: string[] = [];
    for (let seed = 1; seed <= RUNS; seed++) {
      const { merged } = run(file, seed);
      const problem = gameProblem(merged.game);
      if (problem !== null) faults.push(`seed ${seed}: ${problem}`);
      const again = mergeHarvest(merged.game, file);
      if (again.moves.length > 0) faults.push(`seed ${seed}: moves again`);
      if (JSON.stringify(again.game) !== JSON.stringify(merged.game))
        faults.push(`seed ${seed}: the second read changed the game`);
    }
    expect(faults).toEqual([]);
  });

  it('takes the file’s id for some typed names: the runs reach the rule', () => {
    let moved = 0;
    for (let seed = 1; seed <= RUNS; seed++) moved += run(file, seed).merged.moves.length;
    expect(moved).toBeGreaterThan(RUNS / 2);
  });
});
