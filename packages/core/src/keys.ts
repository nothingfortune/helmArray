// Every key a signal can name. The ids match the canvas's Keyboard board (`docs/design/canvas/
// Keyboard.dc.html`), which draws a 60% board with a function row; the rest are the keys the
// key pool and the game files can reach.

// prettier-ignore
const LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
] as const;
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
// prettier-ignore
const FUNCTION_KEYS = [
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21', 'F22', 'F23', 'F24',
] as const;
// prettier-ignore
const NUMPAD = [
  'Num0', 'Num1', 'Num2', 'Num3', 'Num4', 'Num5', 'Num6', 'Num7', 'Num8', 'Num9',
  'NumLock', 'NumDivide', 'NumMultiply', 'NumSubtract', 'NumAdd', 'NumEnter', 'NumDecimal',
] as const;
const PUNCTUATION = ['`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/'] as const;
const MODIFIERS = ['LShift', 'RShift', 'LCtrl', 'RCtrl', 'LAlt', 'RAlt', 'LWin', 'RWin'] as const;
const EDITING = ['Esc', 'Tab', 'Caps', 'Enter', 'Backspace', 'Space', 'Menu'] as const;
// prettier-ignore
const NAVIGATION = [
  'Insert', 'Home', 'PageUp', 'Del', 'End', 'PageDown', 'Up', 'Down', 'Left', 'Right',
  'PrintScreen', 'ScrollLock', 'Pause',
] as const;

export const KEY_CODES = [
  ...LETTERS,
  ...DIGITS,
  ...FUNCTION_KEYS,
  ...NUMPAD,
  ...PUNCTUATION,
  ...MODIFIERS,
  ...EDITING,
  ...NAVIGATION,
] as const;

export type KeyCode = (typeof KEY_CODES)[number];

const known: ReadonlySet<string> = new Set(KEY_CODES);

export function isKeyCode(value: string): value is KeyCode {
  return known.has(value);
}

/** The keys the canvas's Keyboard board draws, row by row: a 60% board with a function row. */
// prettier-ignore
export const KEYBOARD_ROWS: readonly (readonly KeyCode[])[] = [
  ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Del'],
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'],
  ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'],
  ['Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter'],
  ['LShift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'RShift'],
  ['LCtrl', 'LWin', 'LAlt', 'Space', 'RAlt', 'RWin', 'Menu', 'RCtrl'],
];
