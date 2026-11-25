// Every signal helmArray has, named in each format's words and read back; and the ones a format
// can't name, which are errors, never dropped.

import type { KeyCode, Signal } from '@helmarray/core';
import { KEY_CODES, MOUSE_BUTTONS, PAD_CONTROLS } from '@helmarray/core';
import { describe, expect, it } from 'vitest';
import NAMES from './__fixtures__/key-names.json';
import {
  ELITE_KEYS,
  ELITE_MOUSE,
  ELITE_PAD,
  ELITE_SCROLL,
  eliteKeyOf,
  signalOfElite,
} from './elite-keys';
import {
  UNREAL_KEYS,
  UNREAL_MOUSE,
  UNREAL_PAD,
  UNREAL_SCROLL,
  signalOfUnreal,
  unrealKeyOf,
} from './unreal-keys';

const DIRS = ['up', 'down', 'left', 'right'] as const;
const every: Signal[] = [
  ...KEY_CODES.map((code): Signal => ({ kind: 'key', code })),
  ...MOUSE_BUTTONS.map((button): Signal => ({ kind: 'mouse', button })),
  ...DIRS.map((dir): Signal => ({ kind: 'scroll', dir, speed: 1 })),
  ...PAD_CONTROLS.map((control): Signal => ({ kind: 'pad', control })),
];
const words = (s: Signal): string =>
  s.kind === 'key'
    ? s.code
    : s.kind === 'pad'
      ? s.control
      : `${s.kind} ${'button' in s ? s.button : 'dir' in s ? s.dir : ''}`;

// The names themselves, against a reviewed copy: a round trip can't see a name misspelt, because
// the reading table is made from the writing one. Each name's source is in the table's file.
describe('the name tables', () => {
  it('are the reviewed names for Unreal', () => {
    expect({
      keys: UNREAL_KEYS,
      pad: UNREAL_PAD,
      mouse: UNREAL_MOUSE,
      scroll: UNREAL_SCROLL,
    }).toEqual(NAMES.unreal);
  });

  it('are the reviewed names for Elite', () => {
    expect({ keys: ELITE_KEYS, pad: ELITE_PAD, mouse: ELITE_MOUSE, scroll: ELITE_SCROLL }).toEqual(
      NAMES.elite,
    );
  });
});

describe('Unreal names', () => {
  it('reads back every signal it can name as that signal', () => {
    const wrong = every.flatMap((signal) => {
      const named = unrealKeyOf(signal);
      return typeof named === 'string' ||
        JSON.stringify(signalOfUnreal(named)) === JSON.stringify(signal)
        ? []
        : [words(signal)];
    });
    expect(wrong).toEqual([]);
  });

  it('names every key with a modifier, and reads it back', () => {
    const wrong = (['ctrl', 'shift', 'alt'] as const).flatMap((mod) => {
      const signal: Signal = { kind: 'key', code: 'A', mods: [mod] };
      const named = unrealKeyOf(signal);
      return typeof named !== 'string' &&
        JSON.stringify(signalOfUnreal(named)) === JSON.stringify(signal)
        ? []
        : [mod];
    });
    expect(wrong).toEqual([]);
  });

  it('cannot name these, and says so', () => {
    expect(every.filter((s) => typeof unrealKeyOf(s) === 'string').map(words)).toEqual([
      'F13',
      'F14',
      'F15',
      'F16',
      'F17',
      'F18',
      'F19',
      'F20',
      'F21',
      'F22',
      'F23',
      'F24',
      'NumEnter',
      'LWin',
      'RWin',
      'Menu',
      'PrintScreen',
      'scroll left',
      'scroll right',
    ]);
  });

  it('cannot name a key with two modifiers, nor a macro', () => {
    expect([
      unrealKeyOf({ kind: 'key', code: 'A', mods: ['ctrl', 'shift'] }),
      unrealKeyOf({ kind: 'macro', trigger: 'A' }),
    ]).toEqual([
      'A row holds one modifier, not two.',
      'A macro is typed by the app, never bound in the game.',
    ]);
  });

  it('reads a modifier on either side as the modifier', () => {
    expect(signalOfUnreal({ key: 'A', mod: 'RightControl' })).toEqual({
      kind: 'key',
      code: 'A',
      mods: ['ctrl'],
    });
  });

  it('reads None as empty, and an axis, a chord or an unknown name as nothing it can name', () => {
    expect(
      [
        { key: 'None', mod: 'None' },
        { key: 'Gamepad_LeftY', mod: 'None' },
        { key: 'Gamepad_RightX', mod: 'Gamepad_RightThumbstick' },
        { key: 'LeftMouseButton', mod: 'LeftShift' },
        { key: 'Gamepad_FaceButton_Bottom', mod: 'LeftShift' },
        { key: 'NoSuchKey', mod: 'None' },
      ].map(signalOfUnreal),
    ).toEqual(['empty', null, null, null, null, null]);
  });

  it('writes the same key once for a modifier given twice', () => {
    expect(unrealKeyOf({ kind: 'key', code: 'A', mods: ['alt', 'alt'] })).toEqual({
      key: 'A',
      mod: 'LeftAlt',
    });
  });
});

describe('Elite names', () => {
  it('reads back every signal it can name as that signal', () => {
    const wrong = every.flatMap((signal) => {
      const named = eliteKeyOf(signal, '28DE11FF');
      return typeof named === 'string' ||
        JSON.stringify(signalOfElite(named)) === JSON.stringify(signal)
        ? []
        : [words(signal)];
    });
    expect(wrong).toEqual([]);
  });

  it('cannot name these, and says so', () => {
    expect(every.filter((s) => typeof eliteKeyOf(s, 'GamePad') === 'string').map(words)).toEqual([
      'F13',
      'F14',
      'F15',
      'F16',
      'F17',
      'F18',
      'F19',
      'F20',
      'F21',
      'F22',
      'F23',
      'F24',
      'NumLock',
      'NumEnter',
      'LWin',
      'RWin',
      'Caps',
      'Menu',
      'PrintScreen',
      'ScrollLock',
      'Pause',
      'scroll left',
      'scroll right',
      'START',
      'LS_UP',
      'LS_DOWN',
      'LS_LEFT',
      'LS_RIGHT',
      'RS_UP',
      'RS_DOWN',
      'RS_LEFT',
      'RS_RIGHT',
    ]);
  });

  it('says what it cannot name in words', () => {
    expect([
      eliteKeyOf({ kind: 'key', code: 'F13' as KeyCode }, 'GamePad'),
      eliteKeyOf({ kind: 'scroll', dir: 'left', speed: 1 }, 'GamePad'),
      eliteKeyOf({ kind: 'pad', control: 'START' }, 'GamePad'),
      eliteKeyOf({ kind: 'macro', trigger: 'A' }, 'GamePad'),
    ]).toEqual([
      'Elite has no name for F13.',
      'Elite has no name for scroll left.',
      "Elite has no name for the controller's START.",
      'A macro is typed by the app, never bound in the game.',
    ]);
  });

  it('writes every modifier as a Modifier on the keyboard, and reads them back', () => {
    const signal: Signal = { kind: 'key', code: 'W', mods: ['ctrl', 'shift', 'alt'] };
    const named = eliteKeyOf(signal, 'GamePad');
    expect([named, typeof named === 'string' ? null : signalOfElite(named)]).toEqual([
      {
        device: 'Keyboard',
        key: 'Key_W',
        modifiers: [
          { device: 'Keyboard', key: 'Key_LeftControl' },
          { device: 'Keyboard', key: 'Key_LeftShift' },
          { device: 'Keyboard', key: 'Key_LeftAlt' },
        ],
      },
      signal,
    ]);
  });

  it('puts a controller binding on the device it is given', () => {
    expect(eliteKeyOf({ kind: 'pad', control: 'A' }, '28DE11FF')).toEqual({
      device: '28DE11FF',
      key: 'GamePad_FaceDown',
      modifiers: [],
    });
  });

  it('reads a modifier on either side as the modifier', () => {
    expect(
      signalOfElite({
        device: 'Keyboard',
        key: 'Key_W',
        modifiers: [{ device: 'Keyboard', key: 'Key_RightShift' }],
      }),
    ).toEqual({ kind: 'key', code: 'W', mods: ['shift'] });
  });

  it('reads a chord, a joystick, an unknown key and a key on the wrong device as nothing it can name', () => {
    const k = (device: string, key: string, ...mods: [string, string][]) => ({
      device,
      key,
      modifiers: mods.map(([d, m]) => ({ device: d, key: m })),
    });
    expect(
      [
        k('Keyboard', 'Key_LeftShift', ['Keyboard', 'Key_RightBracket']),
        k('28DE11FF', 'GamePad_DPadLeft', ['28DE11FF', 'GamePad_FaceDown']),
        k('Mouse', 'Mouse_1', ['Keyboard', 'Key_LeftShift']),
        k('T16000M', 'Joy_1'),
        k('Keyboard', 'Key_Nothing'),
        k('Mouse', 'Key_A'),
        k('Keyboard', 'Mouse_1'),
        k('Keyboard', 'Key_A', ['T16000M', 'Joy_1']),
        k('28DE11FF', 'GamePad_LStickX'),
      ].map(signalOfElite),
    ).toEqual([null, null, null, null, null, null, null, null, null]);
  });
});
