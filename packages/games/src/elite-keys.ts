// helmArray's signals in Elite Dangerous's key names, both ways, for its .binds files.
//
// Sources. Names marked (file) are in reference/game-files/elite-Custom.4.1.binds or
// elite-KeyboardMouseOnly.binds, as the game wrote them. Names marked (legacy) are in the legacy
// repo's key table (src/lib/elite.ts at 9925939), which wrote the owner's Custom.4.1.binds that the
// game then read; F2-F11 follow the file's Key_F1 and Key_F12. What each mouse name is comes from
// what the preset binds it to: Mouse_4 is the previous fire group and Mouse_5 the next (back and
// forward), Pos_Mouse_ZAxis the previous weapon and Neg_ the next (wheel up and down). Mouse_1-3
// are left, right, middle (legacy CLAUDE.md). A button slot takes a trigger as
// `Pos_GamePad_RTrigger` (file); plain `GamePad_RTrigger` is an axis's.
//
// A name no file or note shows is null, and writing it is an error: F13-F24, Caps Lock, Num Lock,
// the numpad's Enter, Print Screen, Scroll Lock, Pause, the Windows and menu keys, a sideways
// scroll, the controller's START and the eight stick directions (a button slot's name for those is
// in no file seen yet).

import type {
  KeyCode,
  Mod,
  MouseButton,
  PadControl,
  ScrollDirection,
  Signal,
} from '@helmarray/core';

export const ELITE_KEYS: Readonly<Record<KeyCode, string | null>> = {
  A: 'Key_A', // (file)
  B: 'Key_B',
  C: 'Key_C',
  D: 'Key_D',
  E: 'Key_E',
  F: 'Key_F',
  G: 'Key_G',
  H: 'Key_H',
  I: 'Key_I',
  J: 'Key_J',
  K: 'Key_K',
  L: 'Key_L',
  M: 'Key_M',
  N: 'Key_N',
  O: 'Key_O',
  P: 'Key_P',
  Q: 'Key_Q',
  R: 'Key_R',
  S: 'Key_S',
  T: 'Key_T',
  U: 'Key_U',
  V: 'Key_V',
  W: 'Key_W',
  X: 'Key_X',
  Y: 'Key_Y',
  Z: 'Key_Z',
  '0': 'Key_0', // (file)
  '1': 'Key_1',
  '2': 'Key_2',
  '3': 'Key_3',
  '4': 'Key_4',
  '5': 'Key_5',
  '6': 'Key_6',
  '7': 'Key_7',
  '8': 'Key_8',
  '9': 'Key_9',
  F1: 'Key_F1', // (file)
  F2: 'Key_F2',
  F3: 'Key_F3',
  F4: 'Key_F4',
  F5: 'Key_F5',
  F6: 'Key_F6',
  F7: 'Key_F7',
  F8: 'Key_F8',
  F9: 'Key_F9',
  F10: 'Key_F10',
  F11: 'Key_F11',
  F12: 'Key_F12', // (file)
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
  Num0: 'Key_Numpad_0', // (file)
  Num1: 'Key_Numpad_1',
  Num2: 'Key_Numpad_2',
  Num3: 'Key_Numpad_3',
  Num4: 'Key_Numpad_4',
  Num5: 'Key_Numpad_5',
  Num6: 'Key_Numpad_6',
  Num7: 'Key_Numpad_7',
  Num8: 'Key_Numpad_8',
  Num9: 'Key_Numpad_9',
  NumLock: null,
  NumDivide: 'Key_Numpad_Divide', // (legacy)
  NumMultiply: 'Key_Numpad_Multiply', // (legacy)
  NumSubtract: 'Key_Numpad_Subtract', // (legacy)
  NumAdd: 'Key_Numpad_Add', // (legacy)
  NumEnter: null,
  NumDecimal: 'Key_Numpad_Decimal', // (legacy)
  '`': 'Key_Grave', // (legacy)
  '-': 'Key_Minus', // (file)
  '=': 'Key_Equals', // (file)
  '[': 'Key_LeftBracket', // (file)
  ']': 'Key_RightBracket', // (file)
  '\\': 'Key_backslash', // (file: the shipped preset's spelling)
  ';': 'Key_SemiColon', // (file)
  "'": 'Key_Apostrophe', // (file)
  ',': 'Key_Comma', // (file)
  '.': 'Key_Period', // (legacy)
  '/': 'Key_Slash', // (file)
  LShift: 'Key_LeftShift', // (file)
  RShift: 'Key_RightShift', // (file)
  LCtrl: 'Key_LeftControl', // (file)
  RCtrl: 'Key_RightControl', // (legacy)
  LAlt: 'Key_LeftAlt', // (file)
  RAlt: 'Key_RightAlt', // (legacy)
  LWin: null,
  RWin: null,
  Esc: 'Key_Escape', // (legacy)
  Tab: 'Key_Tab', // (file)
  Caps: null,
  Enter: 'Key_Enter', // (file)
  Backspace: 'Key_Backspace', // (file)
  Space: 'Key_Space', // (file)
  Menu: null,
  Insert: 'Key_Insert', // (file)
  Home: 'Key_Home', // (file)
  PageUp: 'Key_PageUp', // (file)
  Del: 'Key_Delete', // (file)
  End: 'Key_End', // (file)
  PageDown: 'Key_PageDown', // (file)
  Up: 'Key_UpArrow', // (file)
  Down: 'Key_DownArrow', // (file)
  Left: 'Key_LeftArrow', // (file)
  Right: 'Key_RightArrow', // (file)
  PrintScreen: null,
  ScrollLock: null,
  Pause: null,
};

export const ELITE_PAD: Readonly<Record<PadControl, string | null>> = {
  A: 'GamePad_FaceDown', // (file)
  B: 'GamePad_FaceRight', // (file)
  X: 'GamePad_FaceLeft', // (file)
  Y: 'GamePad_FaceUp', // (file)
  LB: 'GamePad_LBumper', // (file)
  RB: 'GamePad_RBumper', // (file)
  LT: 'Pos_GamePad_LTrigger', // (file)
  RT: 'Pos_GamePad_RTrigger', // (file)
  BACK: 'GamePad_Back', // (file)
  START: null,
  LS: 'GamePad_LThumb', // (file)
  RS: 'GamePad_RThumb', // (file)
  DPAD_UP: 'GamePad_DPadUp', // (file)
  DPAD_DOWN: 'GamePad_DPadDown', // (file)
  DPAD_LEFT: 'GamePad_DPadLeft', // (file)
  DPAD_RIGHT: 'GamePad_DPadRight', // (file)
  LS_UP: null,
  LS_DOWN: null,
  LS_LEFT: null,
  LS_RIGHT: null,
  RS_UP: null,
  RS_DOWN: null,
  RS_LEFT: null,
  RS_RIGHT: null,
};

export const ELITE_MOUSE: Readonly<Record<MouseButton, string>> = {
  left: 'Mouse_1', // (file)
  right: 'Mouse_2', // (file)
  middle: 'Mouse_3', // (file)
  back: 'Mouse_4', // (file)
  forward: 'Mouse_5', // (file)
};

export const ELITE_SCROLL: Readonly<Record<ScrollDirection, string | null>> = {
  up: 'Pos_Mouse_ZAxis', // (file)
  down: 'Neg_Mouse_ZAxis', // (file)
  left: null,
  right: null,
};

export const KEYBOARD = 'Keyboard';
export const MOUSE = 'Mouse';
export const NO_DEVICE = '{NoDevice}';

/** The key a modifier is written as; either side's key reads as it. */
const MOD_KEYS: Readonly<Record<Mod, string>> = {
  ctrl: 'Key_LeftControl',
  shift: 'Key_LeftShift',
  alt: 'Key_LeftAlt',
};
const MOD_OF: ReadonlyMap<string, Mod> = new Map([
  ['Key_LeftControl', 'ctrl'],
  ['Key_RightControl', 'ctrl'],
  ['Key_LeftShift', 'shift'],
  ['Key_RightShift', 'shift'],
  ['Key_LeftAlt', 'alt'],
  ['Key_RightAlt', 'alt'],
]);

const reverse = <K extends string>(table: Readonly<Record<K, string | null>>): Map<string, K> =>
  new Map(
    (Object.entries(table) as [K, string | null][]).flatMap(([ours, theirs]) =>
      theirs === null ? [] : [[theirs, ours]],
    ),
  );
const KEY_OF = reverse(ELITE_KEYS);
const PAD_OF = reverse(ELITE_PAD);
const MOUSE_OF = reverse(ELITE_MOUSE);
const SCROLL_OF = reverse(ELITE_SCROLL);

/** A device and a key, as a slot or a `Modifier` has them. */
export interface EliteInput {
  device: string;
  key: string;
}

/** A slot's binding: its device and key, and the keys held with it. */
export interface EliteKey extends EliteInput {
  modifiers: EliteInput[];
}

/** Whether a key is a controller's, whatever the device id (the file's is `28DE11FF`). */
export const isPadKey = (key: string): boolean => /^(Pos_|Neg_)?GamePad_/.test(key);

/**
 * The slot for a signal, or why it can't be one. A controller binding goes on `padDevice`, the
 * device the file's controller already is.
 */
export function eliteKeyOf(signal: Signal, padDevice: string): EliteKey | string {
  const unnamed = (what: string): string => `Elite has no name for ${what}.`;
  switch (signal.kind) {
    case 'key': {
      const key = ELITE_KEYS[signal.code];
      const mods = [...new Set(signal.mods ?? [])];
      return key === null
        ? unnamed(signal.code)
        : {
            device: KEYBOARD,
            key,
            modifiers: mods.map((mod) => ({ device: KEYBOARD, key: MOD_KEYS[mod] })),
          };
    }
    case 'mouse':
      return { device: MOUSE, key: ELITE_MOUSE[signal.button], modifiers: [] };
    case 'scroll': {
      const key = ELITE_SCROLL[signal.dir];
      return key === null ? unnamed(`scroll ${signal.dir}`) : { device: MOUSE, key, modifiers: [] };
    }
    case 'pad': {
      const key = ELITE_PAD[signal.control];
      return key === null
        ? unnamed(`the controller's ${signal.control}`)
        : { device: padDevice, key, modifiers: [] };
    }
    case 'macro':
      return 'A macro is typed by the app, never bound in the game.';
  }
}

/**
 * The signal a slot holds, or null for one helmArray can't name: another device (a joystick, the
 * pedals), a key it has no name for, a chord (a modifier that isn't Ctrl, Shift or Alt, or any on a
 * mouse or controller binding).
 */
export function signalOfElite(slot: EliteKey): Signal | null {
  if (isPadKey(slot.key)) {
    const control = PAD_OF.get(slot.key);
    return control === undefined || slot.modifiers.length > 0 ? null : { kind: 'pad', control };
  }
  if (slot.device === MOUSE && slot.modifiers.length === 0) {
    const button = MOUSE_OF.get(slot.key);
    if (button !== undefined) return { kind: 'mouse', button };
    const dir = SCROLL_OF.get(slot.key);
    return dir === undefined ? null : { kind: 'scroll', dir, speed: 1 };
  }
  const code = slot.device === KEYBOARD ? KEY_OF.get(slot.key) : undefined;
  const mods = slot.modifiers.map((m) => (m.device === KEYBOARD ? MOD_OF.get(m.key) : undefined));
  if (code === undefined || mods.some((m) => m === undefined)) return null;
  const set = [...new Set(mods as Mod[])];
  return set.length === 0 ? { kind: 'key', code } : { kind: 'key', code, mods: set };
}
