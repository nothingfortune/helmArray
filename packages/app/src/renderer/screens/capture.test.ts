import { KEY_CODES, PAD_CONTROLS } from '@helmarray/core';
import type { PadControl } from '@helmarray/core';
import { describe, expect, it } from 'vitest';
import {
  CANT_PRESS,
  DOM_CODES,
  keySignalOf,
  mouseSignalOf,
  newPadPress,
  padControlOfAxis,
  padControlOfButton,
  padsHeld,
  whileWaitingForKey,
  whileWaitingForPad,
} from './capture';
import type { PadSnapshot } from './capture';

describe('a key pressed while the Game screen waits for one', () => {
  it.each([
    ['KeyA', 'A'],
    ['KeyZ', 'Z'],
    ['Digit0', '0'],
    ['Digit9', '9'],
    ['F1', 'F1'],
    ['F24', 'F24'],
    ['Numpad0', 'Num0'],
    ['NumpadAdd', 'NumAdd'],
    ['NumpadEnter', 'NumEnter'],
    ['NumpadDecimal', 'NumDecimal'],
    ['NumLock', 'NumLock'],
    ['Backquote', '`'],
    ['Minus', '-'],
    ['Equal', '='],
    ['BracketLeft', '['],
    ['BracketRight', ']'],
    ['Backslash', '\\'],
    ['Semicolon', ';'],
    ['Quote', "'"],
    ['Comma', ','],
    ['Period', '.'],
    ['Slash', '/'],
    ['ShiftLeft', 'LShift'],
    ['ShiftRight', 'RShift'],
    ['ControlLeft', 'LCtrl'],
    ['ControlRight', 'RCtrl'],
    ['AltLeft', 'LAlt'],
    ['AltRight', 'RAlt'],
    ['MetaLeft', 'LWin'],
    ['MetaRight', 'RWin'],
    ['Escape', 'Esc'],
    ['Tab', 'Tab'],
    ['CapsLock', 'Caps'],
    ['Enter', 'Enter'],
    ['Backspace', 'Backspace'],
    ['Space', 'Space'],
    ['ContextMenu', 'Menu'],
    ['Insert', 'Insert'],
    ['Delete', 'Del'],
    ['Home', 'Home'],
    ['End', 'End'],
    ['PageUp', 'PageUp'],
    ['PageDown', 'PageDown'],
    ['ArrowUp', 'Up'],
    ['ArrowDown', 'Down'],
    ['ArrowLeft', 'Left'],
    ['ArrowRight', 'Right'],
    ['PrintScreen', 'PrintScreen'],
    ['ScrollLock', 'ScrollLock'],
    ['Pause', 'Pause'],
  ])('reads %s, where the key is, as %s', (code, key) => {
    expect(keySignalOf({ code, repeat: false })).toEqual({ kind: 'key', code: key });
  });

  it('can reach every key helmArray has a name for', () => {
    const reached = new Set(Object.values(DOM_CODES));
    expect(KEY_CODES.filter((key) => !reached.has(key))).toEqual([]);
  });

  it('reads the key by where it is, not by what it types: KeyQ on an AZERTY board is still Q', () => {
    // The event's `key` would be "a" there; games bind the place, as the DOM's `code` names it.
    expect(keySignalOf({ code: 'KeyQ', repeat: false })).toEqual({ kind: 'key', code: 'Q' });
  });

  it('ignores a key held down and repeating', () => {
    expect(keySignalOf({ code: 'KeyW', repeat: true })).toBeNull();
  });

  it.each([
    '',
    'Fn',
    'IntlBackslash',
    'MediaPlayPause',
    'Unidentified',
    'constructor',
    '__proto__',
  ])('ignores %j, a key helmArray has no name for', (code) => {
    expect(keySignalOf({ code, repeat: false })).toBeNull();
  });
});

describe('a mouse button pressed on the waiting field', () => {
  it.each([
    [0, 'left'],
    [1, 'middle'],
    [2, 'right'],
    [3, 'back'],
    [4, 'forward'],
  ] as const)('reads button %i as the %s button', (button, name) => {
    expect(mouseSignalOf(button)).toEqual({ kind: 'mouse', button: name });
  });

  it.each([-1, 5, 1.5])('ignores button %d', (button) => {
    expect(mouseSignalOf(button)).toBeNull();
  });
});

describe('the keys a press can’t set', () => {
  it('are offered from a list instead: Tab moves on, Esc cancels, and Windows keeps the rest', () => {
    expect(CANT_PRESS).toEqual(['Tab', 'Esc', 'LWin', 'RWin', 'PrintScreen']);
  });
});

describe('a controller button, from the Gamepad API’s standard layout', () => {
  it.each([
    [0, 'A'],
    [1, 'B'],
    [2, 'X'],
    [3, 'Y'],
    [4, 'LB'],
    [5, 'RB'],
    [6, 'LT'],
    [7, 'RT'],
    [8, 'BACK'],
    [9, 'START'],
    [10, 'LS'],
    [11, 'RS'],
    [12, 'DPAD_UP'],
    [13, 'DPAD_DOWN'],
    [14, 'DPAD_LEFT'],
    [15, 'DPAD_RIGHT'],
  ] as const)('reads button %i as %s', (index, control) => {
    expect(padControlOfButton(index)).toBe(control);
  });

  it('ignores the guide button and anything past it', () => {
    expect([padControlOfButton(16), padControlOfButton(17), padControlOfButton(-1)]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it.each([
    [0, -0.9, 'LS_LEFT'],
    [0, 0.9, 'LS_RIGHT'],
    [1, -0.9, 'LS_UP'],
    [1, 0.9, 'LS_DOWN'],
    [2, -0.9, 'RS_LEFT'],
    [2, 0.9, 'RS_RIGHT'],
    [3, -0.9, 'RS_UP'],
    [3, 0.9, 'RS_DOWN'],
  ] as const)('reads axis %i at %d as %s', (index, value, control) => {
    expect(padControlOfAxis(index, value)).toBe(control);
  });

  it('reads a stick pushed past halfway, and not before', () => {
    expect([
      padControlOfAxis(0, 0.49),
      padControlOfAxis(0, 0.5),
      padControlOfAxis(1, -0.5),
    ]).toEqual([null, 'LS_RIGHT', 'LS_UP']);
  });

  it('ignores an axis past the two sticks', () => {
    expect(padControlOfAxis(4, 1)).toBeNull();
  });

  it('reaches every Xbox control the model has', () => {
    const reached = new Set<PadControl>();
    for (let i = 0; i < 20; i++) {
      const button = padControlOfButton(i);
      if (button !== null) reached.add(button);
    }
    for (let i = 0; i < 4; i++) {
      for (const value of [-1, 1]) {
        const axis = padControlOfAxis(i, value);
        if (axis !== null) reached.add(axis);
      }
    }
    expect(PAD_CONTROLS.filter((c) => !reached.has(c))).toEqual([]);
  });
});

const pad = (
  pressed: number[] = [],
  axes: number[] = [0, 0, 0, 0],
  mapping = 'standard',
): PadSnapshot => ({
  mapping,
  buttons: Array.from({ length: 17 }, (_, i) => ({
    pressed: pressed.includes(i),
    value: pressed.includes(i) ? 1 : 0,
  })),
  axes,
});

describe('padsHeld', () => {
  it('lists what each pad holds, buttons then stick directions', () => {
    expect(padsHeld([pad([0, 7], [0, -1, 0, 0]), null])).toEqual([['A', 'RT', 'LS_UP'], []]);
  });

  it('reads a trigger pulled half way as held, though the pad does not call it pressed', () => {
    const trigger = pad();
    trigger.buttons = trigger.buttons.map((b, i) => (i === 6 ? { pressed: false, value: 0.6 } : b));
    expect(padsHeld([trigger])).toEqual([['LT']]);
  });

  it('reads nothing from a pad without the standard layout: its numbers mean other buttons', () => {
    expect(padsHeld([pad([0], [1, 0, 0, 0], '')])).toEqual([[]]);
  });
});

describe('newPadPress', () => {
  it('is the first control pressed since the wait began', () => {
    expect(newPadPress([[]], padsHeld([pad([3])]))).toBe('Y');
  });

  it('is not a control already held when the wait began', () => {
    expect(newPadPress([['A']], padsHeld([pad([0])]))).toBeNull();
  });

  it('is a second control pressed while the first is still held', () => {
    expect(newPadPress([['A']], padsHeld([pad([0, 1])]))).toBe('B');
  });

  it('is a stick pushed since the wait began', () => {
    expect(newPadPress([[]], padsHeld([pad([], [0, 0, 0, 0.8])]))).toBe('RS_DOWN');
  });

  it('is read from any pad, the first one first', () => {
    expect(newPadPress([[], []], padsHeld([null, pad([2])]))).toBe('X');
  });

  it('counts a pad plugged in since the wait began as holding nothing then', () => {
    expect(newPadPress([[]], padsHeld([pad(), pad([4])]))).toBe('LB');
  });

  it('is nothing while nothing new is pressed', () => {
    expect(newPadPress([[]], padsHeld([pad()]))).toBeNull();
  });
});

describe('what a key does while the Game screen waits', () => {
  const key = (code: string, repeat = false) => ({ code, repeat });

  it('sets a key helmArray names', () => {
    expect(whileWaitingForKey(key('KeyR'))).toEqual({
      kind: 'set',
      signal: { kind: 'key', code: 'R' },
    });
  });

  it('cancels on Esc', () => {
    expect(whileWaitingForKey(key('Escape'))).toEqual({ kind: 'cancel' });
  });

  it('lets Tab move the focus on, so the list of keys a press can’t set is reachable', () => {
    expect(whileWaitingForKey(key('Tab'))).toEqual({ kind: 'pass' });
  });

  it('swallows a key it has no name for, and a repeat, and keeps waiting', () => {
    expect([whileWaitingForKey(key('Fn')), whileWaitingForKey(key('KeyR', true))]).toEqual([
      { kind: 'ignore' },
      { kind: 'ignore' },
    ]);
  });

  it('for a controller button: cancels on Esc and lets every other key through', () => {
    expect([
      whileWaitingForPad(key('Escape')),
      whileWaitingForPad(key('Tab')),
      whileWaitingForPad(key('KeyR')),
    ]).toEqual(['cancel', 'pass', 'pass']);
  });
});
