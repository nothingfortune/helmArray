import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES, CYBORG2_LEFT, CYBORG2_RIGHT } from './devices/index';
import type { Game, Scheme } from './model';
import { PLACEHOLDER_PAD_MAP, xboxControllerPreset } from './presets/xbox';
import { ResolveError, resolve } from './resolve';

// A small made-up game with two modes and pad defaults, standing in for a harvested one.
const game: Game = {
  id: 'drill',
  name: 'Drill',
  modes: [
    { id: 'foot', name: 'On foot' },
    { id: 'rover', name: 'Rover' },
  ],
  actions: [
    {
      id: 'jump',
      name: 'Jump',
      mode: 'foot',
      role: 'movement',
      required: true,
      native: { pad: 'A' },
    },
    {
      id: 'reload',
      name: 'Reload',
      mode: 'foot',
      role: 'combat',
      required: false,
      native: { pad: 'X' },
    },
    {
      id: 'fire',
      name: 'Fire',
      mode: 'foot',
      role: 'combat',
      required: true,
      native: { pad: 'RT' },
    },
    {
      id: 'map',
      name: 'Map',
      mode: 'foot',
      role: 'menu',
      required: false,
      native: { pad: 'BACK' },
    },
    {
      id: 'boost',
      name: 'Boost',
      mode: 'rover',
      role: 'movement',
      required: false,
      native: { pad: 'A' },
    },
    {
      id: 'horn',
      name: 'Horn',
      mode: 'rover',
      role: 'ability',
      required: false,
      native: { pad: 'DPAD_UP' },
    },
    {
      id: 'emote',
      name: 'Emote',
      mode: 'foot',
      role: 'menu',
      required: false,
      native: { pad: 'DPAD_RIGHT' },
    },
    { id: 'unbound', name: 'Not on the pad', mode: 'foot', role: 'ability', required: false },
  ],
};

const pinOf = (plan: ReturnType<typeof resolve>, hand: 'left' | 'right', position: string) =>
  plan.units[hand].pins.find((p) => p.position === position);

describe('the Xbox controller preset', () => {
  const scheme = xboxControllerPreset(game);

  it('is pad output with the placeholder map', () => {
    expect(scheme.output).toBe('pad');
    expect(scheme.padMap).toEqual(PLACEHOLDER_PAD_MAP);
  });

  it('puts each action on the button that sends its pad control, in its own mode', () => {
    expect(scheme.map['foot']?.['L.index_3']).toEqual({ tap: 'jump' });
    expect(scheme.map['foot']?.['L.middle_1']).toEqual({ tap: 'reload' });
    expect(scheme.map['foot']?.['L.index_2']).toEqual({ tap: 'fire' });
    expect(scheme.map['rover']?.['L.index_3']).toEqual({ tap: 'boost' });
    expect(scheme.map['rover']?.['L.dpad_up']).toEqual({ tap: 'horn' });
  });

  it('leaves actions the game has no pad control for off the units', () => {
    const placed = Object.values(scheme.map).flatMap((m) => Object.values(m).map((p) => p.tap));
    expect(placed).not.toContain('unbound');
  });

  it('takes a map of its own', () => {
    const own = xboxControllerPreset(game, { 'R.index_1': 'A' });
    expect(own.map['foot']).toEqual({ 'R.index_1': { tap: 'jump' } });
  });
});

describe('resolve, pad output', () => {
  const plan = resolve(xboxControllerPreset(game), game, BUILT_IN_DEVICES);

  it('specifies every position on both units, in the device order, stick apart', () => {
    for (const [hand, unit] of [
      ['left', CYBORG2_LEFT],
      ['right', CYBORG2_RIGHT],
    ] as const) {
      expect(plan.units[hand].pins.map((p) => p.position)).toEqual(
        unit.positions.filter((p) => p.name !== 'stick').map((p) => p.name),
      );
    }
  });

  it('sends each mapped button its pad control on a tap, and nothing else', () => {
    expect(pinOf(plan, 'left', 'index_3')?.presses).toEqual({ tap: { kind: 'pad', control: 'A' } });
    expect(pinOf(plan, 'left', 'ring_1')?.presses).toEqual({});
    expect(pinOf(plan, 'right', 'stick_press')?.presses).toEqual({
      tap: { kind: 'pad', control: 'RS' },
    });
  });

  it("wires each position to its own unit's pin: the right d-pad is turned", () => {
    expect(pinOf(plan, 'left', 'dpad_up')?.pin).toBe(34);
    expect(pinOf(plan, 'right', 'dpad_up')?.pin).toBe(36);
  });

  it("makes the left stick the Xbox left stick and the right stick the right, with each unit's facts", () => {
    expect(plan.units.left.stick).toEqual({ mode: 'pad-left', angle: -1, invertX: false });
    expect(plan.units.right.stick).toEqual({ mode: 'pad-right', angle: 176, invertX: false });
  });

  it('lists what each mapped action receives, mode by mode', () => {
    expect(plan.bindings.map((b) => `${b.mode} ${b.control} ${b.action}`)).toEqual([
      'foot L.middle_1 reload',
      'foot L.index_2 fire',
      'foot L.index_3 jump',
      'foot L.thumb_aux_upper map',
      'foot L.dpad_right emote',
      'rover L.index_3 boost',
      'rover L.dpad_up horn',
    ]);
  });

  it('matches the golden plan byte for byte', async () => {
    await expect(`${JSON.stringify(plan, null, 2)}\n`).toMatchFileSnapshot(
      './__golden__/drill-xbox.plan.json',
    );
  });
});

describe('resolve is deterministic', () => {
  it("gives the same plan however the scheme's keys were inserted", () => {
    const a = xboxControllerPreset(game);
    const reversed = (o: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(o).reverse());
    const b: Scheme = {
      ...a,
      padMap: reversed(a.padMap) as Scheme['padMap'],
      map: Object.fromEntries(
        Object.entries(a.map)
          .reverse()
          .map(([mode, byControl]) => [mode, reversed(byControl)]),
      ) as Scheme['map'],
      behaviour: reversed(a.behaviour) as Scheme['behaviour'],
    };
    expect(JSON.stringify(resolve(b, game, BUILT_IN_DEVICES))).toBe(
      JSON.stringify(resolve(a, game, BUILT_IN_DEVICES)),
    );
  });

  it('gives the same plan twice', () => {
    const scheme = xboxControllerPreset(game);
    expect(resolve(scheme, game, BUILT_IN_DEVICES)).toEqual(
      resolve(scheme, game, BUILT_IN_DEVICES),
    );
  });
});

describe('resolve, behaviour', () => {
  it('carries turbo and latch, and a stick the scheme sets itself', () => {
    const scheme = xboxControllerPreset(game);
    scheme.behaviour['L.index_2'] = { turbo: true };
    scheme.behaviour['R.thumb_aux_upper'] = { latch: true };
    scheme.behaviour['R.stick'] = { stick: { mode: 'mouse', sensitivity: 7, invertX: true } };
    const plan = resolve(scheme, game, BUILT_IN_DEVICES);
    expect(pinOf(plan, 'left', 'index_2')).toMatchObject({ turbo: true, latch: false });
    expect(pinOf(plan, 'right', 'thumb_aux_upper')).toMatchObject({ turbo: false, latch: true });
    expect(plan.units.right.stick).toEqual({
      mode: 'mouse',
      sensitivity: 7,
      invertX: true,
      angle: 176,
    });
  });
});

describe('resolve refuses', () => {
  it('a scheme for another game', () => {
    const scheme = { ...xboxControllerPreset(game), gameId: 'other' };
    expect(() => resolve(scheme, game, BUILT_IN_DEVICES)).toThrow(ResolveError);
  });

  it('devices without both Azerons', () => {
    expect(() => resolve(xboxControllerPreset(game), game, [CYBORG2_LEFT])).toThrow(
      'No right Azeron among the devices',
    );
  });
});
