import { KEYBOARD_ROWS } from '../keys';
import type { Control, FixedDevice, MouseButton, PedalsDevice } from '../model';
import { PAD_CONTROLS } from '../model';

// The devices whose controls send what they are. Their buttons are pointed at actions through
// the game's own config, never remapped.

const MOUSE_BUTTONS: readonly MouseButton[] = ['left', 'right', 'middle', 'back', 'forward'];

export const KEYBOARD_MOUSE: FixedDevice = {
  id: 'keyboard-mouse',
  kind: 'kbm',
  name: 'Keyboard and mouse',
  controls: [
    ...KEYBOARD_ROWS.flat().map((code): Control => ({
      id: `key.${code}`,
      kind: 'button',
      programmable: false,
      sends: { kind: 'key', code },
    })),
    ...MOUSE_BUTTONS.map((button): Control => ({
      id: `mouse.${button}`,
      kind: 'button',
      programmable: false,
      sends: { kind: 'mouse', button },
    })),
  ],
};

// An Xbox controller: its buttons and triggers, and each stick as a whole. A stick's four
// directions are signals (`LS_UP` …) the Azerons can send, not separate controls on the pad.
const PAD_BUTTONS = PAD_CONTROLS.filter((c) => !/^[LR]S_/.test(c));

export const XBOX_PAD: FixedDevice = {
  id: 'xbox-pad',
  kind: 'pad',
  name: 'Xbox controller',
  controls: [
    ...PAD_BUTTONS.map((control): Control => ({
      id: `pad.${control}`,
      kind: control === 'LT' || control === 'RT' ? 'axis' : 'button',
      programmable: false,
      sends: { kind: 'pad', control },
    })),
    { id: 'pad.left_stick', kind: 'stick', programmable: false },
    { id: 'pad.right_stick', kind: 'stick', programmable: false },
  ],
};

// The owner's Logitech Pro Flight rudder pedals (reference/devices/logitech-pro-flight-pedals.yaml).
// Three axes, no buttons. They are only ever written into a game's file, never sent a report.
export const PRO_FLIGHT_PEDALS: PedalsDevice = {
  id: 'pro-flight-pedals',
  kind: 'pedals',
  name: 'Rudder pedals',
  axes: [
    { id: 'pedal.rudder', name: 'Rudder', rest: 'centre' },
    { id: 'pedal.left_toe', name: 'Left toe brake', rest: 'end' },
    { id: 'pedal.right_toe', name: 'Right toe brake', rest: 'end' },
  ],
  controls: [
    { id: 'pedal.rudder', kind: 'axis', programmable: false },
    { id: 'pedal.left_toe', kind: 'axis', programmable: false },
    { id: 'pedal.right_toe', kind: 'axis', programmable: false },
  ],
};
