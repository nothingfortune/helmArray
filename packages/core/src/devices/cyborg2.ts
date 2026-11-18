import type { AzeronDevice, AzeronPosition, Control, Hand } from '../model';

// The two Azeron Cyborg II units, from the press-tested pin maps in
// reference/devices/cyborg2-{left,right}.yaml. test/devices-reference.test.ts checks every pin
// here against those files. Each hand is its own table: the right unit's rotated thumb cluster
// is data, not a special case.

type Row = [
  name: string,
  pin: number,
  column: AzeronPosition['column'],
  extra?: Partial<AzeronPosition>,
];

const fingers = (column: 'pinky' | 'ring' | 'middle' | 'index', pins: readonly number[]): Row[] =>
  pins.map((pin, i) => [`${column}_${i + 1}`, pin, column, { row: i + 1 }]);

// Identical on both hands.
const SHARED: readonly Row[] = [
  ...fingers('pinky', [5, 4, 3, 2, 1]),
  ...fingers('ring', [11, 10, 9, 8, 7]),
  ...fingers('middle', [17, 16, 15, 14, 13]),
  ...fingers('index', [26, 25, 24, 23, 22]),
  ['pinky_side', 6, 'side', { row: 3, side: 'outer' }],
  ['index_side', 27, 'side', { row: 3, side: 'inner' }],
  ['thumb_aux_upper', 20, 'thumb', { row: 1, cluster: 'aux' }],
  ['thumb_aux_lower', 19, 'thumb', { row: 2, cluster: 'aux' }],
  ['stick_press', 32, 'thumb', { row: 3, cluster: 'stick' }],
  ['stick', 31, 'thumb', { row: 0, pinTwo: 30 }],
];

// The d-pad turns with the unit: the right unit is mounted half a turn round, so its up and
// down pins swap, and so do left and right.
const DPAD_LEFT: readonly Row[] = [
  ['dpad_up', 34, 'thumb', { cluster: 'dpad' }],
  ['dpad_left', 35, 'thumb', { cluster: 'dpad' }],
  ['dpad_press', 37, 'thumb', { cluster: 'dpad' }],
  ['dpad_right', 33, 'thumb', { cluster: 'dpad' }],
  ['dpad_down', 36, 'thumb', { cluster: 'dpad' }],
];
const DPAD_RIGHT: readonly Row[] = [
  ['dpad_up', 36, 'thumb', { cluster: 'dpad' }],
  ['dpad_left', 33, 'thumb', { cluster: 'dpad' }],
  ['dpad_press', 37, 'thumb', { cluster: 'dpad' }],
  ['dpad_right', 35, 'thumb', { cluster: 'dpad' }],
  ['dpad_down', 34, 'thumb', { cluster: 'dpad' }],
];

function positions(rows: readonly Row[]): AzeronPosition[] {
  return rows.map(([name, pin, column, extra]) => ({ name, pin, column, ...extra }));
}

function unit(hand: Hand, rows: readonly Row[], stick: AzeronDevice['stick']): AzeronDevice {
  const prefix = hand === 'left' ? 'L' : 'R';
  const all = positions(rows);
  const controls: Control[] = all.map((p) => ({
    id: `${prefix}.${p.name}`,
    kind: p.name === 'stick' ? 'stick' : 'button',
    programmable: true,
  }));
  return {
    id: `cyborg2-${hand}`,
    kind: 'azeron',
    name: hand === 'left' ? 'Left Azeron' : 'Right Azeron',
    hand,
    positions: all,
    controls,
    // The press test found these wired to nothing on both units.
    unknownPins: [0, 28, 29],
    stick,
  };
}

export const CYBORG2_LEFT: AzeronDevice = unit('left', [...SHARED, ...DPAD_LEFT], {
  angle: -1,
  invertX: false,
});

// The stick is built for a left unit; this one is mounted half a turn round. The Azeron app
// writes angle 176 for it, which undoes the rotation, and X is written not inverted in every
// mode (reference/legacy/CLAUDE.md: "The right unit's X is one hard-coded device fact").
// Measured by the press test in keyboard mode; not yet flown.
export const CYBORG2_RIGHT: AzeronDevice = unit('right', [...SHARED, ...DPAD_RIGHT], {
  angle: 176,
  invertX: false,
});
