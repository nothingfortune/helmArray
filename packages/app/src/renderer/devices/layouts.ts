// Where the fixed devices' controls are drawn, and what each is called: the keyboard as the canvas's
// Keyboard board lays it out (docs/design/canvas/Keyboard.dc.html, 956 x 392), the mouse and the
// Xbox controller as the Play view draws them (PlayKeys.dc.html and PlayPad.dc.html). Pure: the
// components only place these.

import type { ControlId } from '@helmarray/core';
import { KEYBOARD_ROWS } from '@helmarray/core';

// ---- The keyboard ----

export const KEYBOARD_WIDTH = 956;
export const KEYBOARD_HEIGHT = 392;
/** One key unit, the gap between keys and a key's height, as the canvas has them. */
const U = 64;
const GAP = 4;
const KEY_HEIGHT = 60;
const ROW_Y = [0, 76, 140, 204, 268, 332] as const;

/** What a key is called on its cap, where that isn't its code. */
const LEGENDS: Readonly<Record<string, string>> = {
  LShift: 'Shift',
  RShift: 'Shift',
  LCtrl: 'Ctrl',
  RCtrl: 'Ctrl',
  LAlt: 'Alt',
  RAlt: 'Alt',
  LWin: 'Win',
  RWin: 'Win',
};

/** Keys wider than one unit, in units. */
const WIDTHS: Readonly<Record<string, number>> = {
  Backspace: 2,
  Tab: 1.5,
  '\\': 1.5,
  Caps: 1.75,
  Enter: 2.25,
  LShift: 2.25,
  RShift: 2.75,
  LCtrl: 1.25,
  LWin: 1.25,
  LAlt: 1.25,
  Space: 6.25,
  RAlt: 1.25,
  RWin: 1.25,
  Menu: 1.25,
  RCtrl: 1.25,
};

/** The function row's keys after which the canvas leaves half a unit: F4 and F8. */
const GAP_AFTER = new Set(['F4', 'F8']);

/** What a key's cap says, and what it is called to a screen reader. */
export interface KeyCap {
  id: ControlId;
  /** On the cap, in mono: `Shift`, `F5`, `J`. */
  legend: string;
  /** For a screen reader: `Left Shift`, `F5`, `J`. */
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const SPOKEN: Readonly<Record<string, string>> = {
  LShift: 'Left Shift',
  RShift: 'Right Shift',
  LCtrl: 'Left Ctrl',
  RCtrl: 'Right Ctrl',
  LAlt: 'Left Alt',
  RAlt: 'Right Alt',
  LWin: 'Left Win',
  RWin: 'Right Win',
  Esc: 'Escape',
  Del: 'Delete',
  Caps: 'Caps Lock',
  '`': 'Backtick',
  '-': 'Minus',
  '=': 'Equals',
  '[': 'Left bracket',
  ']': 'Right bracket',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
};

/** Every key the canvas draws, row by row, with its place. */
export function keyboardLayout(): KeyCap[] {
  const keys: KeyCap[] = [];
  KEYBOARD_ROWS.forEach((row, r) => {
    let x = 0;
    for (const code of row) {
      const w = (WIDTHS[code] ?? 1) * U;
      keys.push({
        id: `key.${code}`,
        legend: LEGENDS[code] ?? code,
        name: SPOKEN[code] ?? code,
        x,
        y: ROW_Y[r] ?? 0,
        w: w - GAP,
        h: KEY_HEIGHT,
      });
      x += w + (GAP_AFTER.has(code) ? U / 2 : 0);
    }
  });
  return keys;
}

// ---- Rows beside a drawing: the mouse and the controller ----

/** One control as a row beside the drawing: its short name, and the part of the drawing it lights. */
export interface DeviceRow {
  id: ControlId;
  /** In mono, as the canvas captions it: `LT`, `D-pad ↑`, `Side 1`. */
  code: string;
  /** For a screen reader: `Left trigger`, `D-pad up`, `Side button 1`. */
  name: string;
  /** The part of the drawing that is this control. */
  part: string;
  /** A stick: selectable, never an action's place. */
  stick?: true;
}

/** The mouse's five buttons, as PlayKeys lists them. */
export const MOUSE_ROWS: readonly DeviceRow[] = [
  { id: 'mouse.left', code: 'Left', name: 'Left button', part: 'left' },
  { id: 'mouse.right', code: 'Right', name: 'Right button', part: 'right' },
  { id: 'mouse.middle', code: 'Wheel', name: 'Wheel button', part: 'wheel' },
  { id: 'mouse.back', code: 'Side 1', name: 'Side button 1', part: 'side1' },
  { id: 'mouse.forward', code: 'Side 2', name: 'Side button 2', part: 'side2' },
];

/** The controller's left column, as PlayPad lists it. */
export const PAD_LEFT_ROWS: readonly DeviceRow[] = [
  { id: 'pad.LT', code: 'LT', name: 'Left trigger', part: 'lt' },
  { id: 'pad.LB', code: 'LB', name: 'Left bumper', part: 'lb' },
  { id: 'pad.left_stick', code: 'L stick', name: 'Left stick', part: 'ls', stick: true },
  { id: 'pad.LS', code: 'L click', name: 'Left stick click', part: 'ls' },
  { id: 'pad.DPAD_UP', code: 'D-pad ↑', name: 'D-pad up', part: 'dpad' },
  { id: 'pad.DPAD_DOWN', code: 'D-pad ↓', name: 'D-pad down', part: 'dpad' },
  { id: 'pad.DPAD_LEFT', code: 'D-pad ←', name: 'D-pad left', part: 'dpad' },
  { id: 'pad.DPAD_RIGHT', code: 'D-pad →', name: 'D-pad right', part: 'dpad' },
  { id: 'pad.BACK', code: 'View', name: 'View button', part: 'view' },
];

/** The controller's right column. */
export const PAD_RIGHT_ROWS: readonly DeviceRow[] = [
  { id: 'pad.RT', code: 'RT', name: 'Right trigger', part: 'rt' },
  { id: 'pad.RB', code: 'RB', name: 'Right bumper', part: 'rb' },
  { id: 'pad.Y', code: 'Y', name: 'Y', part: 'y' },
  { id: 'pad.B', code: 'B', name: 'B', part: 'b' },
  { id: 'pad.A', code: 'A', name: 'A', part: 'a' },
  { id: 'pad.X', code: 'X', name: 'X', part: 'x' },
  { id: 'pad.right_stick', code: 'R stick', name: 'Right stick', part: 'rs', stick: true },
  { id: 'pad.RS', code: 'R click', name: 'Right stick click', part: 'rs' },
  { id: 'pad.START', code: 'Menu', name: 'Menu button', part: 'menu' },
];

/** What a fixed control is called in the side panel: `Keyboard · Left Shift`, `Controller · LT`. */
export function fixedWhere(control: ControlId): string | undefined {
  if (control.startsWith('key.')) {
    const key = keyboardLayout().find((k) => k.id === control);
    return `Keyboard · ${key?.name ?? control.slice(4)}`;
  }
  const row = [...MOUSE_ROWS, ...PAD_LEFT_ROWS, ...PAD_RIGHT_ROWS].find((r) => r.id === control);
  if (row === undefined) return undefined;
  return control.startsWith('mouse.') ? `Mouse · ${row.name}` : `Controller · ${row.code}`;
}

/** The scale a drawing of `natural` px wide is shown at in `width` px: never above full size. */
export function fitScale(width: number | undefined, natural: number): number {
  if (width === undefined || !Number.isFinite(width) || width <= 0) return 1;
  return Math.min(1, width / natural);
}
