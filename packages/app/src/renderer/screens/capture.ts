// Press-to-set on the Game screen: a default is set by pressing it while the window has focus.
// Pure: the screen hands in what ordinary DOM events and the Gamepad API (`navigator.getGamepads`)
// say, and this says what it means in the model's words. Nothing here, or in the screen, listens
// outside the window: no hook, no injector.
//
// Keys are read by `KeyboardEvent.code`, where the key is, not by `key`, what it types: a game
// binds the place (W is forward on any layout), and the model's key codes name places.

import type { KeyCode, PadControl, Signal } from '@helmarray/core';
import { MOUSE_BUTTONS, own } from '@helmarray/core';

const letters = Object.fromEntries(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => [`Key${l}`, l]),
);
const digits = Object.fromEntries('0123456789'.split('').map((d) => [`Digit${d}`, d]));
const functionKeys = Object.fromEntries(
  Array.from({ length: 24 }, (_, i) => [`F${i + 1}`, `F${i + 1}`]),
);
const numpadDigits = Object.fromEntries(
  '0123456789'.split('').map((d) => [`Numpad${d}`, `Num${d}`]),
);

/** Every DOM `code` helmArray has a name for, and that name. */
export const DOM_CODES: Readonly<Record<string, KeyCode>> = {
  ...letters,
  ...digits,
  ...functionKeys,
  ...numpadDigits,
  NumLock: 'NumLock',
  NumpadDivide: 'NumDivide',
  NumpadMultiply: 'NumMultiply',
  NumpadSubtract: 'NumSubtract',
  NumpadAdd: 'NumAdd',
  NumpadEnter: 'NumEnter',
  NumpadDecimal: 'NumDecimal',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  ShiftLeft: 'LShift',
  ShiftRight: 'RShift',
  ControlLeft: 'LCtrl',
  ControlRight: 'RCtrl',
  AltLeft: 'LAlt',
  AltRight: 'RAlt',
  MetaLeft: 'LWin',
  MetaRight: 'RWin',
  Escape: 'Esc',
  Tab: 'Tab',
  CapsLock: 'Caps',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Space: 'Space',
  ContextMenu: 'Menu',
  Insert: 'Insert',
  Delete: 'Del',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PrintScreen: 'PrintScreen',
  ScrollLock: 'ScrollLock',
  Pause: 'Pause',
} as Record<string, KeyCode>;

/**
 * Keys a press can't set, offered from a list while waiting instead: Tab moves the focus on and
 * Esc cancels (so a keyboard can always leave the wait), the Windows keys open the Start menu,
 * and Windows keeps Print Screen to itself.
 */
export const CANT_PRESS: readonly KeyCode[] = ['Tab', 'Esc', 'LWin', 'RWin', 'PrintScreen'];

/** The key a key press names, as a signal; null for a repeat or a key helmArray has no name for. */
export function keySignalOf(e: { code: string; repeat: boolean }): Signal | null {
  if (e.repeat) return null;
  const code = own(DOM_CODES, e.code);
  return code === undefined ? null : { kind: 'key', code };
}

/** A mouse button by the DOM's `MouseEvent.button` number, as a signal; null for another. */
export function mouseSignalOf(button: number): Signal | null {
  const name = Number.isInteger(button) ? MOUSE_BUTTONS[button] : undefined;
  return name === undefined ? null : { kind: 'mouse', button: name };
}

export type KeyOutcome =
  | { kind: 'set'; signal: Signal }
  | { kind: 'cancel' }
  /** Left to the page: Tab moves the focus on. */
  | { kind: 'pass' }
  /** Swallowed, and the wait goes on. */
  | { kind: 'ignore' };

/** What a key pressed while waiting for a default key does. */
export function whileWaitingForKey(e: { code: string; repeat: boolean }): KeyOutcome {
  if (e.code === 'Escape') return { kind: 'cancel' };
  if (e.code === 'Tab') return { kind: 'pass' };
  const signal = keySignalOf(e);
  return signal === null ? { kind: 'ignore' } : { kind: 'set', signal };
}

/** What a key pressed while waiting for a controller button does: Esc cancels, the rest pass. */
export function whileWaitingForPad(e: { code: string }): 'cancel' | 'pass' {
  return e.code === 'Escape' ? 'cancel' : 'pass';
}

/** The Gamepad API's standard layout: button index to Xbox control. 16 is the guide button. */
const STANDARD_BUTTONS: readonly PadControl[] = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'BACK',
  'START',
  'LS',
  'RS',
  'DPAD_UP',
  'DPAD_DOWN',
  'DPAD_LEFT',
  'DPAD_RIGHT',
];

/** The standard layout's axes: left stick x and y, right stick x and y; negative is left or up. */
const STANDARD_AXES: readonly (readonly [PadControl, PadControl])[] = [
  ['LS_LEFT', 'LS_RIGHT'],
  ['LS_UP', 'LS_DOWN'],
  ['RS_LEFT', 'RS_RIGHT'],
  ['RS_UP', 'RS_DOWN'],
];

/** How far a stick or a trigger must go to count as pressed. */
const PUSHED = 0.5;

export function padControlOfButton(index: number): PadControl | null {
  return STANDARD_BUTTONS[index] ?? null;
}

export function padControlOfAxis(index: number, value: number): PadControl | null {
  const pair = STANDARD_AXES[index];
  if (pair === undefined || Math.abs(value) < PUSHED) return null;
  return value < 0 ? pair[0] : pair[1];
}

/** What the Gamepad API says of one pad: the part of a `Gamepad` this reads. */
export interface PadSnapshot {
  mapping: string;
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
}

/**
 * What each pad holds now, as Xbox controls: buttons in order, then stick directions. A pad
 * without the standard layout gives nothing: its numbers would name other buttons.
 */
export function padsHeld(pads: readonly (PadSnapshot | null)[]): PadControl[][] {
  return pads.map((pad) => {
    if (pad === null || pad.mapping !== 'standard') return [];
    const held: PadControl[] = [];
    pad.buttons.forEach((button, i) => {
      const control = padControlOfButton(i);
      if (control !== null && (button.pressed || button.value >= PUSHED)) held.push(control);
    });
    pad.axes.forEach((value, i) => {
      const control = padControlOfAxis(i, value);
      if (control !== null) held.push(control);
    });
    return held;
  });
}

/**
 * The first control pressed since the wait began: held now, and not held then by the same pad. A
 * control held all along never counts, so a button still down from before can't set itself.
 */
export function newPadPress(
  before: readonly (readonly PadControl[])[],
  now: readonly (readonly PadControl[])[],
): PadControl | null {
  for (const [i, held] of now.entries()) {
    const was = before[i] ?? [];
    const fresh = held.find((control) => !was.includes(control));
    if (fresh !== undefined) return fresh;
  }
  return null;
}

/** The part of a `Gamepad` this reads. */
interface GamepadLike {
  mapping: string;
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
}

/** What `navigator.getGamepads()` gives, as snapshots: copied, so a later read can't change them. */
export function snapshotsOf(pads: Iterable<GamepadLike | null>): (PadSnapshot | null)[] {
  return [...pads].map((pad) =>
    pad === null
      ? null
      : {
          mapping: pad.mapping,
          buttons: pad.buttons.map((b) => ({ pressed: b.pressed, value: b.value })),
          axes: [...pad.axes],
        },
  );
}
