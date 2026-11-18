import { describe, expect, it } from 'vitest';
import { KEY_CODES, isKeyCode } from '../keys';
import type { AzeronDevice } from '../model';
import { PAD_CONTROLS } from '../model';
import {
  BUILT_IN_DEVICES,
  CYBORG2_LEFT,
  CYBORG2_RIGHT,
  KEYBOARD_MOUSE,
  PRO_FLIGHT_PEDALS,
  XBOX_PAD,
} from './index';

const pin = (unit: AzeronDevice, name: string) => unit.positions.find((p) => p.name === name)?.pin;

describe('built-in devices', () => {
  it('lists each device once, Azerons first', () => {
    expect(BUILT_IN_DEVICES.map((d) => d.id)).toEqual([
      'cyborg2-left',
      'cyborg2-right',
      'keyboard-mouse',
      'xbox-pad',
      'pro-flight-pedals',
    ]);
  });

  it('gives every control a unique id across all devices', () => {
    const ids = BUILT_IN_DEVICES.flatMap((d) => d.controls.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([
    ['cyborg2-left', 'L.'],
    ['cyborg2-right', 'R.'],
    ['xbox-pad', 'pad.'],
    ['pro-flight-pedals', 'pedal.'],
  ])('prefixes every control of %s with %s', (id, prefix) => {
    const device = BUILT_IN_DEVICES.find((d) => d.id === id);
    expect(device?.controls.every((c) => c.id.startsWith(prefix))).toBe(true);
  });

  it('only the Azerons are programmable', () => {
    for (const device of BUILT_IN_DEVICES) {
      for (const control of device.controls) {
        expect(control.programmable).toBe(device.kind === 'azeron');
      }
    }
  });
});

describe.each([CYBORG2_LEFT, CYBORG2_RIGHT])('$name', (unit) => {
  it('has the 31 positions of a Cyborg II, each a control', () => {
    expect(unit.positions).toHaveLength(31);
    expect(unit.controls.map((c) => c.id)).toEqual(
      unit.positions.map((p) => `${unit.hand === 'left' ? 'L' : 'R'}.${p.name}`),
    );
  });

  it('wires no pin twice, and none of the pins the press test found dead', () => {
    const pins = unit.positions.flatMap((p) =>
      p.pinTwo === undefined ? [p.pin] : [p.pin, p.pinTwo],
    );
    expect(new Set(pins).size).toBe(pins.length);
    for (const dead of unit.unknownPins) expect(pins).not.toContain(dead);
    for (const p of pins) expect(p).toBeGreaterThanOrEqual(1);
    for (const p of pins) expect(p).toBeLessThanOrEqual(37);
  });

  it('has one stick, on two pins', () => {
    const sticks = unit.controls.filter((c) => c.kind === 'stick');
    expect(sticks.map((c) => c.id)).toEqual([`${unit.hand === 'left' ? 'L' : 'R'}.stick`]);
    expect(unit.positions.find((p) => p.name === 'stick')).toMatchObject({ pin: 31, pinTwo: 30 });
  });

  it('has five keys in each finger column', () => {
    for (const column of ['pinky', 'ring', 'middle', 'index']) {
      expect(unit.positions.filter((p) => p.column === column).map((p) => p.row)).toEqual([
        1, 2, 3, 4, 5,
      ]);
    }
  });
});

describe('the right unit', () => {
  it('has the same positions as the left, by name', () => {
    expect(CYBORG2_RIGHT.positions.map((p) => p.name).sort()).toEqual(
      CYBORG2_LEFT.positions.map((p) => p.name).sort(),
    );
  });

  it('turns the d-pad half a turn: up and down swap pins, and so do left and right', () => {
    expect(pin(CYBORG2_RIGHT, 'dpad_up')).toBe(pin(CYBORG2_LEFT, 'dpad_down'));
    expect(pin(CYBORG2_RIGHT, 'dpad_down')).toBe(pin(CYBORG2_LEFT, 'dpad_up'));
    expect(pin(CYBORG2_RIGHT, 'dpad_left')).toBe(pin(CYBORG2_LEFT, 'dpad_right'));
    expect(pin(CYBORG2_RIGHT, 'dpad_right')).toBe(pin(CYBORG2_LEFT, 'dpad_left'));
    expect(pin(CYBORG2_RIGHT, 'dpad_press')).toBe(pin(CYBORG2_LEFT, 'dpad_press'));
  });

  it('wires everything off the d-pad as the left does', () => {
    for (const p of CYBORG2_LEFT.positions.filter((x) => x.cluster !== 'dpad')) {
      expect(pin(CYBORG2_RIGHT, p.name)).toBe(p.pin);
    }
  });

  it('carries the half-turn stick as data: angle 176, X not inverted', () => {
    expect(CYBORG2_RIGHT.stick).toEqual({ angle: 176, invertX: false });
    expect(CYBORG2_LEFT.stick).toEqual({ angle: -1, invertX: false });
  });
});

describe('fixed devices', () => {
  it('each key sends itself', () => {
    for (const control of KEYBOARD_MOUSE.controls.filter((c) => c.id.startsWith('key.'))) {
      expect(control.sends).toEqual({ kind: 'key', code: control.id.slice(4) });
    }
  });

  it('draws the canvas keyboard: 75 keys and five mouse buttons', () => {
    expect(KEYBOARD_MOUSE.controls.filter((c) => c.id.startsWith('key.'))).toHaveLength(75);
    expect(KEYBOARD_MOUSE.controls.filter((c) => c.id.startsWith('mouse.'))).toHaveLength(5);
  });

  it('the pad has its buttons, triggers as axes and two sticks', () => {
    const kinds = Object.fromEntries(XBOX_PAD.controls.map((c) => [c.id, c.kind]));
    expect(kinds['pad.A']).toBe('button');
    expect(kinds['pad.LT']).toBe('axis');
    expect(kinds['pad.left_stick']).toBe('stick');
    expect(XBOX_PAD.controls.some((c) => c.id === 'pad.LS_UP')).toBe(false);
  });

  it('the pedals rest as measured: the rudder centred, each toe at an end', () => {
    expect(PRO_FLIGHT_PEDALS.axes.map((a) => [a.id, a.rest])).toEqual([
      ['pedal.rudder', 'centre'],
      ['pedal.left_toe', 'end'],
      ['pedal.right_toe', 'end'],
    ]);
  });
});

describe('key codes', () => {
  it('are unique', () => {
    expect(new Set(KEY_CODES).size).toBe(KEY_CODES.length);
  });

  it('reach F24, the numpad and the navigation keys the key pool needs', () => {
    for (const code of ['F13', 'F24', 'NumAdd', 'Insert', 'PageDown'])
      expect(isKeyCode(code)).toBe(true);
    expect(isKeyCode('F25')).toBe(false);
    expect(isKeyCode('w')).toBe(false);
  });

  it('has every pad control once', () => {
    expect(new Set(PAD_CONTROLS).size).toBe(PAD_CONTROLS.length);
  });
});
