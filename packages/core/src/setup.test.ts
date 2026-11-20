import { describe, expect, it } from 'vitest';
import type { Scheme, SetupDevices } from './model';
import { AZERONS_ONLY } from './model';
import { bindingSetOf, controlSet, inSetup, padSignalOf, setsUsed, setupOf } from './setup';

const devices = (over: Partial<SetupDevices>): SetupDevices => ({ ...AZERONS_ONLY, ...over });

const scheme = (over: Partial<Scheme>): Scheme => ({
  id: 's',
  gameId: 'g',
  name: 'S',
  devices: AZERONS_ONLY,
  output: 'pad',
  padMap: { 'L.index_1': 'RB', 'R.index_1': 'A' },
  writeGameFile: false,
  map: {},
  behaviour: {},
  ledger: {},
  accepted: [],
  ...over,
});

describe('setupOf', () => {
  it('uses both units, left first, for both Azerons', () => {
    expect(setupOf(devices({ azerons: 'both' })).hands).toEqual(['left', 'right']);
  });

  it('uses the left unit only, and the mouse with it, for the left Azeron', () => {
    const setup = setupOf(devices({ azerons: 'left', mouse: false }));
    expect([setup.hands, setup.mouse]).toEqual([['left'], true]);
  });

  it('uses no unit for none, and the mouse only when asked', () => {
    const setup = setupOf(devices({ azerons: 'none', keyboard: true }));
    expect([setup.hands, setup.keyboard, setup.mouse, setup.controller]).toEqual([
      [],
      true,
      false,
      false,
    ]);
  });
});

describe('inSetup', () => {
  const left = setupOf(devices({ azerons: 'left', controller: true }));

  it.each([
    ['L.index_1', true],
    ['R.index_1', false],
    ['mouse.left', true],
    ['key.W', false],
    ['pad.A', true],
    ['pedal.rudder', true],
    ['thing.else', false],
  ])('%s is %s for the left Azeron, the mouse and a controller', (control, expected) => {
    expect(inSetup(left, control)).toBe(expected);
  });

  it('has the keyboard only when the setup does', () => {
    expect(inSetup(setupOf(devices({ keyboard: true })), 'key.W')).toBe(true);
  });
});

describe('padSignalOf', () => {
  it('is the pad control an Azeron button sends with pad output', () => {
    expect(padSignalOf(scheme({}), 'L.index_1')).toBe('RB');
  });

  it('is nothing for an Azeron button with key output', () => {
    expect(padSignalOf(scheme({ output: 'keys' }), 'L.index_1')).toBeUndefined();
  });

  it('is nothing for the right unit when the setup uses the left one only', () => {
    expect(
      padSignalOf(scheme({ devices: devices({ azerons: 'left' }) }), 'R.index_1'),
    ).toBeUndefined();
  });

  it('is the controller’s own button when the setup has a controller', () => {
    expect(padSignalOf(scheme({ devices: devices({ controller: true }) }), 'pad.X')).toBe('X');
  });

  it('is nothing for a controller button when the setup has no controller', () => {
    expect(padSignalOf(scheme({}), 'pad.X')).toBeUndefined();
  });

  it('is nothing for the controller’s sticks, which are not one pad control', () => {
    expect(
      padSignalOf(scheme({ devices: devices({ controller: true }) }), 'pad.left_stick'),
    ).toBeUndefined();
  });
});

describe('the binding sets', () => {
  it('put a pad control in the controller set, and keys, mouse buttons and scroll in the keyboard set', () => {
    expect(
      [
        { kind: 'pad', control: 'A' } as const,
        { kind: 'key', code: 'W' } as const,
        { kind: 'mouse', button: 'left' } as const,
        { kind: 'scroll', dir: 'up', speed: 1 } as const,
      ].map(bindingSetOf),
    ).toEqual(['controller', 'keyboard', 'keyboard', 'keyboard']);
  });

  it.each([
    ['Azerons as a controller', scheme({}), ['controller']],
    ['Azerons sending keys', scheme({ output: 'keys' }), ['keyboard']],
    [
      'no Azerons, a keyboard and a mouse',
      scheme({ devices: devices({ azerons: 'none', keyboard: true, mouse: true }) }),
      ['keyboard'],
    ],
    [
      'no Azerons, a controller',
      scheme({ output: 'keys', devices: devices({ azerons: 'none', controller: true }) }),
      ['controller'],
    ],
    [
      'the left Azeron as a controller (and so the mouse)',
      scheme({ devices: devices({ azerons: 'left' }) }),
      ['keyboard', 'controller'],
    ],
    ['nothing at all', scheme({ devices: devices({ azerons: 'none' }) }), []],
  ])('a setup of %s uses %j', (_, s, expected) => {
    expect(setsUsed(s)).toEqual(expected);
  });
});

describe('controlSet', () => {
  it.each([
    ['L.index_1', 'pad', 'controller'],
    ['R.index_1', 'keys', 'keyboard'],
    ['key.W', 'pad', 'keyboard'],
    ['mouse.left', 'pad', 'keyboard'],
    ['pad.A', 'keys', 'controller'],
    ['L.stick', 'pad', undefined],
    ['pedal.rudder', 'pad', undefined],
  ] as const)('binds %s through the %s output’s set: %s', (control, output, expected) => {
    expect(controlSet(scheme({ output }), control)).toBe(expected);
  });
});
