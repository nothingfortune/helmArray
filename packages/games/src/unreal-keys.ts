// helmArray's signals in Unreal's key names, both ways, for Everspace 2's Input.ini.
//
// Sources. Names marked (file) are in reference/game-files/everspace2-Input.before.ini, as the
// game wrote it. The rest are Unreal Engine 4's own key names (`EKeys` in InputCoreTypes), which
// is what the file holds: every name the file has is one of them, and the stick halves follow the
// file's own `Gamepad_RightStick_Up` / `_Down`. A key Unreal 4 has no name for is null here, and
// writing it is an error: F13-F24, the Windows and menu keys, Print Screen and the numpad's Enter
// (Unreal reads it as Enter), and a sideways scroll.

import type {
  KeyCode,
  Mod,
  MouseButton,
  PadControl,
  ScrollDirection,
  Signal,
} from '@helmarray/core';

export const UNREAL_KEYS: Readonly<Record<KeyCode, string | null>> = {
  A: 'A', // (file)
  B: 'B',
  C: 'C',
  D: 'D',
  E: 'E',
  F: 'F',
  G: 'G',
  H: 'H',
  I: 'I',
  J: 'J',
  K: 'K',
  L: 'L',
  M: 'M',
  N: 'N',
  O: 'O',
  P: 'P',
  Q: 'Q',
  R: 'R',
  S: 'S',
  T: 'T',
  U: 'U',
  V: 'V',
  W: 'W',
  X: 'X',
  Y: 'Y',
  Z: 'Z',
  '0': 'Zero',
  '1': 'One', // (file)
  '2': 'Two',
  '3': 'Three',
  '4': 'Four',
  '5': 'Five',
  '6': 'Six',
  '7': 'Seven',
  '8': 'Eight',
  '9': 'Nine',
  F1: 'F1', // (file)
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12',
  F13: null,
  F14: null,
  F15: null,
  F16: null,
  F17: null,
  F18: null,
  F19: null,
  F20: null,
  F21: null,
  F22: null,
  F23: null,
  F24: null,
  Num0: 'NumPadZero',
  Num1: 'NumPadOne',
  Num2: 'NumPadTwo',
  Num3: 'NumPadThree',
  Num4: 'NumPadFour',
  Num5: 'NumPadFive',
  Num6: 'NumPadSix',
  Num7: 'NumPadSeven',
  Num8: 'NumPadEight',
  Num9: 'NumPadNine',
  NumLock: 'NumLock',
  NumDivide: 'Divide',
  NumMultiply: 'Multiply',
  NumSubtract: 'Subtract',
  NumAdd: 'Add', // (file)
  NumEnter: null,
  NumDecimal: 'Decimal',
  '`': 'Tilde',
  '-': 'Hyphen',
  '=': 'Equals',
  '[': 'LeftBracket',
  ']': 'RightBracket',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Apostrophe',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  LShift: 'LeftShift', // (file)
  RShift: 'RightShift',
  LCtrl: 'LeftControl', // (file)
  RCtrl: 'RightControl',
  LAlt: 'LeftAlt', // (file)
  RAlt: 'RightAlt',
  LWin: null,
  RWin: null,
  Esc: 'Escape', // (file)
  Tab: 'Tab', // (file)
  Caps: 'CapsLock',
  Enter: 'Enter', // (file)
  Backspace: 'BackSpace',
  Space: 'SpaceBar', // (file)
  Menu: null,
  Insert: 'Insert',
  Home: 'Home',
  PageUp: 'PageUp', // (file)
  Del: 'Delete',
  End: 'End',
  PageDown: 'PageDown', // (file)
  Up: 'Up', // (file)
  Down: 'Down', // (file)
  Left: 'Left', // (file)
  Right: 'Right', // (file)
  PrintScreen: null,
  ScrollLock: 'ScrollLock',
  Pause: 'Pause',
};

export const UNREAL_PAD: Readonly<Record<PadControl, string>> = {
  A: 'Gamepad_FaceButton_Bottom', // (file)
  B: 'Gamepad_FaceButton_Right', // (file)
  X: 'Gamepad_FaceButton_Left', // (file)
  Y: 'Gamepad_FaceButton_Top', // (file)
  LB: 'Gamepad_LeftShoulder', // (file)
  RB: 'Gamepad_RightShoulder', // (file)
  LT: 'Gamepad_LeftTrigger', // (file)
  RT: 'Gamepad_RightTrigger', // (file)
  BACK: 'Gamepad_Special_Left', // (file): the in-game menu
  START: 'Gamepad_Special_Right', // (file): pause
  LS: 'Gamepad_LeftThumbstick', // (file)
  RS: 'Gamepad_RightThumbstick', // (file)
  DPAD_UP: 'Gamepad_DPad_Up', // (file)
  DPAD_DOWN: 'Gamepad_DPad_Down', // (file)
  DPAD_LEFT: 'Gamepad_DPad_Left', // (file)
  DPAD_RIGHT: 'Gamepad_DPad_Right', // (file)
  LS_UP: 'Gamepad_LeftStick_Up',
  LS_DOWN: 'Gamepad_LeftStick_Down',
  LS_LEFT: 'Gamepad_LeftStick_Left',
  LS_RIGHT: 'Gamepad_LeftStick_Right',
  RS_UP: 'Gamepad_RightStick_Up', // (file)
  RS_DOWN: 'Gamepad_RightStick_Down', // (file)
  RS_LEFT: 'Gamepad_RightStick_Left',
  RS_RIGHT: 'Gamepad_RightStick_Right',
};

export const UNREAL_MOUSE: Readonly<Record<MouseButton, string>> = {
  left: 'LeftMouseButton', // (file)
  right: 'RightMouseButton', // (file)
  middle: 'MiddleMouseButton', // (file)
  back: 'ThumbMouseButton',
  forward: 'ThumbMouseButton2',
};

export const UNREAL_SCROLL: Readonly<Record<ScrollDirection, string | null>> = {
  up: 'MouseScrollUp',
  down: 'MouseScrollDown',
  left: null,
  right: null,
};

/** The key a modifier is written as in a row's `Key1Mod` / `Key2Mod`. */
const MOD_KEYS: Readonly<Record<Mod, string>> = {
  ctrl: 'LeftControl',
  shift: 'LeftShift',
  alt: 'LeftAlt',
};
/** Either side's key reads as the modifier. */
const MOD_OF: ReadonlyMap<string, Mod> = new Map([
  ['LeftControl', 'ctrl'],
  ['RightControl', 'ctrl'],
  ['LeftShift', 'shift'],
  ['RightShift', 'shift'],
  ['LeftAlt', 'alt'],
  ['RightAlt', 'alt'],
]);

const reverse = <K extends string>(table: Readonly<Record<K, string | null>>): Map<string, K> =>
  new Map(
    (Object.entries(table) as [K, string | null][]).flatMap(([ours, theirs]) =>
      theirs === null ? [] : [[theirs, ours]],
    ),
  );
const KEY_OF = reverse(UNREAL_KEYS);
const PAD_OF = reverse(UNREAL_PAD);
const MOUSE_OF = reverse(UNREAL_MOUSE);
const SCROLL_OF = reverse(UNREAL_SCROLL);

/** One binding as a row's slot holds it: the key, and the modifier (`None` for none). */
export interface UnrealKey {
  key: string;
  mod: string;
}

/**
 * The slot for a signal, or why it can't be one. A row has one modifier: a key with two can't be
 * written, and nor can a mouse button or scroll with any.
 */
export function unrealKeyOf(signal: Signal): UnrealKey | string {
  switch (signal.kind) {
    case 'key': {
      const key = UNREAL_KEYS[signal.code];
      const mods = [...new Set(signal.mods ?? [])];
      if (key === null) return `Unreal has no name for ${signal.code}.`;
      if (mods.length > 1) return 'A row holds one modifier, not two.';
      const [mod] = mods;
      return { key, mod: mod === undefined ? 'None' : MOD_KEYS[mod] };
    }
    case 'mouse':
      return { key: UNREAL_MOUSE[signal.button], mod: 'None' };
    case 'scroll': {
      const key = UNREAL_SCROLL[signal.dir];
      return key === null ? `Unreal has no name for scroll ${signal.dir}.` : { key, mod: 'None' };
    }
    case 'pad':
      return { key: UNREAL_PAD[signal.control], mod: 'None' };
    case 'macro':
      return 'A macro is typed by the app, never bound in the game.';
  }
}

/**
 * The signal a slot holds, `empty` for `None`, or null for one helmArray can't name: an axis
 * (`MouseX`, `Gamepad_LeftY`), a joystick's button, or a controller chord (`Key1Mod` holding a
 * controller button).
 */
export function signalOfUnreal(slot: UnrealKey): Signal | 'empty' | null {
  if (slot.key === 'None') return 'empty';
  const mod = slot.mod === 'None' ? undefined : MOD_OF.get(slot.mod);
  if (slot.mod !== 'None' && mod === undefined) return null;
  const code = KEY_OF.get(slot.key);
  if (code !== undefined)
    return mod === undefined ? { kind: 'key', code } : { kind: 'key', code, mods: [mod] };
  if (mod !== undefined) return null;
  const control = PAD_OF.get(slot.key);
  if (control !== undefined) return { kind: 'pad', control };
  const button = MOUSE_OF.get(slot.key);
  if (button !== undefined) return { kind: 'mouse', button };
  const dir = SCROLL_OF.get(slot.key);
  return dir === undefined ? null : { kind: 'scroll', dir, speed: 1 };
}
