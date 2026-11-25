// One signal per control-press, across modes (docs/plans/02-architecture.md, "One signal per
// control-press per scheme, whatever the mode": J4). A button sends one key, or one Xbox control,
// in every mode; a mode only changes which of the game's actions that signal means, and the game's
// bindings follow it per mode.
//
// The property, over seeded games of 1 to 6 modes and seeded runs of drags and clears into any
// mode, each step resolved with the ledger the last one dealt: for every control-press,
//   1. every mode's bindings agree on one signal;
//   2. it is what the unit is told to send on that press;
//   3. each mode's game binding for the action there is on that signal;
//   4. it never changes while the control-press keeps carrying an action;
//   5. a control-press carrying an action with no signal is never silent: a finding names it.
// Deterministic: the same seeds, the same run, every time.

import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES, CYBORG2_LEFT, CYBORG2_RIGHT } from './devices/index';
import type { Action, Game, ModeId, PadControl, Press, Scheme, Signal } from './model';
import { PRESSES } from './model';
import type { Plan } from './plan';
import { resolve } from './resolve';
import { bindingSetOf } from './setup';
import { clone } from './clone';
import { signalId } from './signal';

/** A seeded generator: the same seed, the same numbers. */
function seeded(seed: number) {
  let x = seed >>> 0 || 1;
  return (n: number): number => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return Math.floor(x / 65536) % n;
  };
}

const pick = <T>(next: (n: number) => number, list: readonly T[]): T =>
  list[next(list.length)] as T;

const BUTTONS = [
  ...CYBORG2_LEFT.positions.filter((p) => p.name !== 'stick').map((p) => `L.${p.name}`),
  ...CYBORG2_RIGHT.positions.filter((p) => p.name !== 'stick').map((p) => `R.${p.name}`),
];
/** The keyboard keys a run puts actions on, when the setup has the keyboard. */
const KEYS = ['key.Q', 'key.E', 'key.R', 'key.F', 'key.G', 'key.Z', 'key.X', 'key.C'];
/** The game's own keys and Xbox buttons, never a stick direction: no stick is in play here. */
const NATIVE_KEYS = ['Q', 'E', 'R', 'F', 'G', 'T', 'Y', 'U', 'Z', 'X', 'C', 'V', '1', '2', 'Space'];
const NATIVE_PADS: readonly PadControl[] = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'BACK',
  'START',
  'DPAD_UP',
  'DPAD_DOWN',
  'DPAD_LEFT',
  'DPAD_RIGHT',
];

interface World {
  game: Game;
  scheme: Scheme;
}

function worldFor(seed: number): World {
  const next = seeded(seed * 7919);
  const modeCount = 1 + next(6);
  const modes = Array.from({ length: modeCount }, (_, i) => ({ id: `m${i}`, name: `Mode ${i}` }));
  const actions: Action[] = modes.flatMap((mode) =>
    Array.from({ length: 2 + next(7) }, (_, i): Action => {
      const native: Action['native'] = {};
      if (next(3) > 0) native.key = { kind: 'key', code: pick(next, NATIVE_KEYS) } as Signal;
      if (next(3) > 0) native.pad = pick(next, NATIVE_PADS);
      return {
        id: `${mode.id}a${i}`,
        name: `Action ${i} of ${mode.name}`,
        mode: mode.id,
        role: 'ability',
        required: false,
        ...(Object.keys(native).length > 0 ? { native } : {}),
      };
    }),
  );
  const withFile = next(2) === 0;
  const game: Game = {
    id: 'modes',
    name: 'Modes',
    modes,
    actions,
    ...(withFile ? { file: { format: next(2) === 0 ? 'elite-binds' : 'unreal-ini' } } : {}),
  };
  const output = next(2) === 0 ? 'pad' : 'keys';
  // With pad output most buttons send an Xbox control, two may send the same one; some none yet.
  const padMap = Object.fromEntries(
    output === 'pad'
      ? BUTTONS.flatMap((button) => (next(4) > 0 ? [[button, pick(next, NATIVE_PADS)]] : []))
      : [],
  ) as Scheme['padMap'];
  const keyboard = next(3) === 0;
  const scheme: Scheme = {
    id: 'scheme',
    gameId: game.id,
    name: 'Seeded',
    devices: { azerons: 'both', keyboard, mouse: keyboard, controller: false },
    output,
    padMap,
    writeGameFile: next(2) === 0,
    map: {},
    behaviour: {},
    ledger: {},
    accepted: [],
  };
  return { game, scheme };
}

/** One drag (an action of a mode onto a control-press in that mode), or one clear. */
function step(world: World, next: (n: number) => number): Scheme {
  const { game, scheme } = world;
  const mode = pick(next, game.modes).id;
  const controls = scheme.devices.keyboard ? [...BUTTONS, ...KEYS] : BUTTONS;
  const control = pick(next, controls);
  const press: Press = control.startsWith('key.') ? 'tap' : pick(next, PRESSES);
  const map = clone(scheme.map);
  const byControl = map[mode] ?? {};
  const kept = Object.entries(byControl[control] ?? {}).filter(([p]) => p !== press);
  const inMode = game.actions.filter((a) => a.mode === mode);
  // One in five a clear; else a drag of one of the mode's actions.
  const presses = Object.fromEntries(
    next(5) === 0 ? kept : [...kept, [press, pick(next, inMode).id]],
  ) as Partial<Record<Press, string>>;
  return {
    ...scheme,
    map: Object.fromEntries([
      ...Object.entries(map).filter(([m]) => m !== mode),
      [
        mode,
        Object.fromEntries([
          ...Object.entries(byControl).filter(([c]) => c !== control),
          [control, presses],
        ]),
      ],
    ]) as Scheme['map'],
  };
}

const slotOf = (control: string, press: Press) => `${control}|${press}`;

/** Every way the plan breaks the property, one line each. `held`: the signals seen so far. */
function faultsOf(world: World, plan: Plan, held: Map<string, string>): string[] {
  const { game, scheme } = world;
  const out: string[] = [];
  const pins = new Map(
    [...(plan.units.left?.pins ?? []), ...(plan.units.right?.pins ?? [])].map((p) => [
      p.control,
      p,
    ]),
  );

  // 1. One signal per control-press, whatever the mode.
  const bySlot = new Map<string, Set<string>>();
  for (const b of plan.bindings) {
    const slot = slotOf(b.control, b.press);
    bySlot.set(slot, (bySlot.get(slot) ?? new Set()).add(signalId(b.signal)));
  }
  for (const [slot, signals] of bySlot) {
    if (signals.size !== 1) out.push(`${slot} sends ${[...signals].join(' and ')} across modes`);
  }

  for (const [slot, signals] of bySlot) {
    const [control = '', press = 'tap'] = slot.split('|') as [string, Press];
    const signal = [...signals][0] ?? '';
    // 2. The unit is told to send that very signal on that press.
    if (!control.startsWith('key.')) {
      const sent = pins.get(control)?.presses[press];
      if (sent === undefined || signalId(sent) !== signal)
        out.push(
          `${slot}: bound to ${signal}, the unit sends ${sent ? signalId(sent) : 'nothing'}`,
        );
    }
    // 4. Stable: once dealt, the same while it carries an action.
    const before = held.get(slot);
    if (before !== undefined && before !== signal)
      out.push(`${slot} moved from ${before} to ${signal}`);
    held.set(slot, signal);
  }

  // 3. Each mode's game binding for an action placed there is on the control-press's signal.
  for (const b of plan.bindings) {
    const set = bindingSetOf(b.signal);
    const rows = plan.gameBindings.filter(
      (g) => g.set === set && g.mode === b.mode && g.action === b.action,
    );
    if (!rows.some((g) => g.signal !== null && signalId(g.signal) === signalId(b.signal)))
      out.push(
        `${b.mode} ${b.action} on ${slotOf(b.control, b.press)} (${signalId(b.signal)}): the game binds it to ${
          rows.map((g) => (g.signal === null ? 'nothing' : signalId(g.signal))).join(', ') ||
          'no row'
        }`,
      );
  }

  // 5. Carrying an action and sending nothing is never silent.
  for (const mode of game.modes) {
    for (const [control, presses] of Object.entries(scheme.map[mode.id] ?? {})) {
      for (const press of PRESSES) {
        if (presses[press] === undefined || bySlot.has(slotOf(control, press))) continue;
        if (!plan.findings.some((f) => f.control === control))
          out.push(`${mode.id} ${slotOf(control, press)} carries an action, sends nothing, unsaid`);
      }
    }
  }
  return out;
}

describe('one signal per control-press, across modes (J4)', () => {
  it(
    'holds over 100 seeded games, 40 drags and clears each, the ledger carried along',
    { timeout: 30_000 },
    () => {
      const faults: string[] = [];
      const shapes = new Set<string>();
      for (let seed = 1; seed <= 100; seed++) {
        let world = worldFor(seed);
        const next = seeded(seed);
        const held = new Map<string, string>();
        for (let i = 1; i <= 40; i++) {
          world = { ...world, scheme: step(world, next) };
          const plan = resolve(world.scheme, world.game, BUILT_IN_DEVICES);
          // The ledger is the scheme's: what was dealt is kept, as an apply keeps it.
          world = { ...world, scheme: { ...world.scheme, ledger: plan.ledger } };
          // A control-press emptied in every mode may be dealt afresh once it carries again.
          for (const slot of [...held.keys()]) {
            if (!plan.bindings.some((b) => slotOf(b.control, b.press) === slot)) held.delete(slot);
          }
          for (const fault of faultsOf(world, plan, held))
            faults.push(`seed ${seed}, step ${i}: ${fault}`);
          // What the run covered: a control-press with actions in two or more modes, per output.
          const modesOn = new Map<string, Set<ModeId>>();
          for (const b of plan.bindings) {
            const slot = slotOf(b.control, b.press);
            modesOn.set(slot, (modesOn.get(slot) ?? new Set()).add(b.mode));
          }
          if ([...modesOn.values()].some((m) => m.size >= 2))
            shapes.add(`${world.scheme.output} ${world.scheme.writeGameFile ? 'file' : 'no file'}`);
        }
      }
      expect({ faults: faults.slice(0, 20), shapes: [...shapes].sort() }).toEqual({
        faults: [],
        // Every kind of setup had a button doing different jobs in different modes.
        shapes: ['keys file', 'keys no file', 'pad file', 'pad no file'],
      });
    },
  );

  it('one button, a job in each of three modes: one key, and each mode binds its own action to it', () => {
    const game: Game = {
      id: 'three',
      name: 'Three',
      modes: [
        { id: 'ship', name: 'Ship' },
        { id: 'srv', name: 'SRV' },
        { id: 'foot', name: 'On foot' },
      ],
      actions: [
        {
          id: 'boost',
          name: 'Boost',
          mode: 'ship',
          required: false,
          native: { key: { kind: 'key', code: 'Tab' } },
        },
        {
          id: 'handbrake',
          name: 'Handbrake',
          mode: 'srv',
          required: false,
          native: { key: { kind: 'key', code: 'X' } },
        },
        {
          id: 'jump',
          name: 'Jump',
          mode: 'foot',
          required: false,
          native: { key: { kind: 'key', code: 'Space' } },
        },
      ],
      file: { format: 'elite-binds' },
    };
    const scheme: Scheme = {
      id: 's',
      gameId: 'three',
      name: 'S',
      devices: { azerons: 'both', keyboard: false, mouse: false, controller: false },
      output: 'keys',
      padMap: {},
      writeGameFile: true,
      map: {
        ship: { 'L.index_1': { tap: 'boost' } },
        srv: { 'L.index_1': { tap: 'handbrake' } },
        foot: { 'L.index_1': { tap: 'jump' } },
      },
      behaviour: {},
      ledger: {},
      accepted: [],
    };
    const plan = resolve(scheme, game, BUILT_IN_DEVICES);
    const sent = plan.units.left?.pins.find((p) => p.control === 'L.index_1')?.presses.tap;
    const bound = (action: string) =>
      plan.gameBindings.find((g) => g.action === action && g.set === 'keyboard')?.signal;
    expect({
      sends: sent,
      boost: bound('boost'),
      handbrake: bound('handbrake'),
      jump: bound('jump'),
    }).toEqual({
      // The first key of the pool the file can name: one key, never one per mode.
      sends: { kind: 'key', code: 'Insert' },
      boost: { kind: 'key', code: 'Insert' },
      handbrake: { kind: 'key', code: 'Insert' },
      jump: { kind: 'key', code: 'Insert' },
    });
  });
});
