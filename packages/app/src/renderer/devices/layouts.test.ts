import { describe, expect, it } from 'vitest';
import { KEYBOARD_MOUSE, XBOX_PAD } from '@helmarray/core';
import {
  KEYBOARD_HEIGHT,
  KEYBOARD_WIDTH,
  MOUSE_ROWS,
  PAD_LEFT_ROWS,
  PAD_RIGHT_ROWS,
  fitScale,
  fixedWhere,
  keyboardLayout,
} from './layouts';

describe('the keyboard, as the canvas lays it out', () => {
  const keys = keyboardLayout();

  it('draws every key of the keyboard device, once', () => {
    const device = KEYBOARD_MOUSE.controls.filter((c) => c.id.startsWith('key.')).map((c) => c.id);
    expect(keys.map((k) => k.id).sort()).toEqual([...device].sort());
  });

  it('fills each row to the board’s full width, 956 by 392', () => {
    const rowEnds = [...new Set(keys.map((k) => k.y))].map((y) =>
      Math.max(...keys.filter((k) => k.y === y).map((k) => k.x + k.w)),
    );
    expect([rowEnds, Math.max(...keys.map((k) => k.y + k.h))]).toEqual([
      [
        KEYBOARD_WIDTH,
        KEYBOARD_WIDTH,
        KEYBOARD_WIDTH,
        KEYBOARD_WIDTH,
        KEYBOARD_WIDTH,
        KEYBOARD_WIDTH,
      ],
      KEYBOARD_HEIGHT,
    ]);
  });

  it('leaves half a key after F4 and F8, as the canvas does', () => {
    const at = (code: string) => keys.find((k) => k.id === `key.${code}`)?.x;
    expect([at('F4'), at('F5'), at('F8'), at('F9')]).toEqual([256, 352, 544, 640]);
  });

  it('puts no key over another', () => {
    const overlaps = keys.flatMap((a, i) =>
      keys
        .slice(i + 1)
        .filter((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
        .map((b) => `${a.id}/${b.id}`),
    );
    expect(overlaps).toEqual([]);
  });

  it('writes the cap as the canvas does, and names a key in words', () => {
    const cap = (code: string) => keys.find((k) => k.id === `key.${code}`);
    expect([cap('LShift'), cap('Space')?.w, cap(';')?.name]).toEqual([
      { id: 'key.LShift', legend: 'Shift', name: 'Left Shift', x: 0, y: 268, w: 140, h: 60 },
      396,
      'Semicolon',
    ]);
  });
});

describe('the rows beside the mouse and the controller', () => {
  it('has a row for every mouse button the device has', () => {
    const device = KEYBOARD_MOUSE.controls
      .filter((c) => c.id.startsWith('mouse.'))
      .map((c) => c.id);
    expect(MOUSE_ROWS.map((r) => r.id).sort()).toEqual([...device].sort());
  });

  it('has a row for every button and stick of the controller, its sticks marked', () => {
    const rows = [...PAD_LEFT_ROWS, ...PAD_RIGHT_ROWS];
    expect([rows.map((r) => r.id).sort(), rows.filter((r) => r.stick).map((r) => r.id)]).toEqual([
      XBOX_PAD.controls.map((c) => c.id).sort(),
      ['pad.left_stick', 'pad.right_stick'],
    ]);
  });
});

describe('what a fixed control is called in the side panel', () => {
  it('names the device and the control', () => {
    expect([
      fixedWhere('key.LShift'),
      fixedWhere('key.J'),
      fixedWhere('mouse.back'),
      fixedWhere('pad.LT'),
      fixedWhere('pad.left_stick'),
      fixedWhere('L.index_1'),
    ]).toEqual([
      'Keyboard · Left Shift',
      'Keyboard · J',
      'Mouse · Side button 1',
      'Controller · LT',
      'Controller · L stick',
      undefined,
    ]);
  });
});

describe('the scale a drawing is shown at', () => {
  it('fits the width it has, never past full size, and is full size before it is measured', () => {
    expect([
      fitScale(478, 956),
      fitScale(2000, 956),
      fitScale(undefined, 956),
      fitScale(0, 956),
      fitScale(Number.NaN, 956),
    ]).toEqual([0.5, 1, 1, 1, 1]);
  });
});
