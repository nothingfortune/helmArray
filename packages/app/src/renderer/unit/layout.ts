import type { ControlId, Hand } from '@helmarray/core';

// The geometry of the Azeron unit board (docs/design/canvas/Unit.dc.html). Pure numbers: no
// React, no DOM. Geometry is fixed per position and never depends on what is assigned, so an
// empty slot holds its place and nothing shifts.

export const UNIT_WIDTH = 640;
export const UNIT_HEIGHT = 380;
/** Every finger key is this wide, so the five-key columns read as one grid. */
export const FINGER_KEY_WIDTH = 72;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type KeyShape = 'key' | 'stick' | 'press';

export interface KeyPlace extends Rect {
  /** The control id, prefixed by its hand: `L.index_1`. */
  id: ControlId;
  /** The position name the canvas and the reference maps share: `index_1`. */
  pos: string;
  shape: KeyShape;
  /** The words for the position, used while it is empty and in its accessible name. */
  name: string;
  /** Short keys (the d-pad's): the text is centred vertically and the dot sits top right. */
  flat: boolean;
}

export interface ZonePlace extends Rect {
  name: string;
}

export type StickDirection = 'up' | 'down' | 'left' | 'right';

export interface ChipPlace extends Rect {
  direction: StickDirection;
}

export interface UnitLayout {
  hand: Hand;
  keys: KeyPlace[];
  zones: ZonePlace[];
  /** The four direction chips around the stick. They are labels, not controls. */
  chips: ChipPlace[];
  /** Where the hand's name sits: the outer top corner, as drawn. */
  handTag: { side: 'left' | 'right'; x: number; y: number };
}

/** `L` or `R`, the prefix of a hand's control ids. */
export const handPrefix = (hand: Hand): 'L' | 'R' => (hand === 'left' ? 'L' : 'R');

const SPECIAL_NAMES: Record<string, string> = {
  pinky_side: 'Pinky side',
  index_side: 'Index side',
  thumb_aux_upper: 'Thumb upper',
  thumb_aux_lower: 'Thumb lower',
  stick: 'Stick',
  stick_press: 'Stick press',
  dpad_up: 'D-pad ↑',
  dpad_down: 'D-pad ↓',
  dpad_left: 'D-pad ←',
  dpad_right: 'D-pad →',
  dpad_press: 'D-pad press',
};

/** `index_1` -> "Index 1", `dpad_up` -> "D-pad ↑". */
export function positionName(pos: string): string {
  const special = SPECIAL_NAMES[pos];
  if (special !== undefined) return special;
  const [column = '', n = ''] = pos.split('_');
  return `${column.charAt(0).toUpperCase()}${column.slice(1)} ${n}`.trim();
}

/** The position name of a control id: `L.index_1` -> `index_1`. */
export const positionOf = (id: ControlId): string => id.slice(id.indexOf('.') + 1);

// The left hand as drawn. [x, y, w, h].
type Box = readonly [x: number, y: number, w: number, h: number];

const FINGER_COLUMNS = [
  ['pinky', 66, 74],
  ['ring', 144, 34],
  ['middle', 222, 18],
  ['index', 300, 26],
] as const;

function leftKeyBoxes(): [string, Box][] {
  const boxes: [string, Box][] = [];
  for (const [column, x, y0] of FINGER_COLUMNS) {
    for (let row = 1; row <= 5; row++) {
      boxes.push([`${column}_${row}`, [x, y0 + (row - 1) * 54, FINGER_KEY_WIDTH, 48]]);
    }
  }
  boxes.push(
    ['pinky_side', [4, 196, 60, 64]],
    ['index_side', [376, 38, 60, 64]],
    // Thumb keys, stick and d-pad each sit in their own zone, with more space between zones
    // than inside them, so the clusters read apart before any label is read.
    ['thumb_aux_upper', [296, 322, 56, 44]],
    ['thumb_aux_lower', [356, 322, 56, 44]],
    ['dpad_up', [503, 230, 60, 34]],
    ['dpad_left', [441, 268, 60, 34]],
    ['dpad_press', [503, 268, 60, 34]],
    ['dpad_right', [565, 268, 60, 34]],
    ['dpad_down', [503, 306, 60, 34]],
  );
  return boxes;
}

const LEFT_ZONES: readonly (readonly [string, ...Box])[] = [
  ['Thumb', 286, 296, 136, 76],
  ['Stick', 440, 14, 186, 170],
  ['D-pad', 440, 198, 186, 168],
];

const STICK_SIZE = 60;
const STICK_LEFT = 503;
const STICK_TOP = 74;
const PRESS_W = STICK_SIZE - 8;
const PRESS_H = 24;
const CHIP_H = 26;

/** The d-pad's directions keep their meaning when the unit is mirrored: left stays on the
 * left of the cluster, as the stick's chips do. */
const SWAPPED_WHEN_MIRRORED: Record<string, string> = {
  dpad_left: 'dpad_right',
  dpad_right: 'dpad_left',
};

const mirrorX = (x: number, w: number): number => UNIT_WIDTH - x - w;

/** Every position of a Cyborg II hand, with its zones, the stick's chips and the hand tag. */
export function unitLayout(hand: Hand): UnitLayout {
  const right = hand === 'right';
  const prefix = handPrefix(hand);
  const fx = (x: number, w: number): number => (right ? mirrorX(x, w) : x);

  const left = new Map(leftKeyBoxes());
  const keys: KeyPlace[] = [];
  for (const [pos] of left) {
    // For a mirrored hand a direction key takes the place its opposite has on the left unit.
    const source = (right && SWAPPED_WHEN_MIRRORED[pos]) || pos;
    const box = left.get(source);
    // The map was built from these same names, so a miss is a typo in this file.
    if (box === undefined) throw new Error(`no box for ${source}`);
    const [x, y, w, h] = box;
    keys.push({
      id: `${prefix}.${pos}`,
      pos,
      x: fx(x, w),
      y,
      w,
      h,
      shape: 'key',
      name: positionName(pos),
      flat: h < 40,
    });
  }

  const stickX = fx(STICK_LEFT, STICK_SIZE);
  const cx = stickX + STICK_SIZE / 2;
  const cy = STICK_TOP + STICK_SIZE / 2;
  keys.push(
    {
      id: `${prefix}.stick`,
      pos: 'stick',
      x: stickX,
      y: STICK_TOP,
      w: STICK_SIZE,
      h: STICK_SIZE,
      shape: 'stick',
      name: positionName('stick'),
      flat: false,
    },
    {
      // The press sits in the middle of the stick, drawn as its centre label.
      id: `${prefix}.stick_press`,
      pos: 'stick_press',
      x: cx - PRESS_W / 2,
      y: cy - PRESS_H / 2,
      w: PRESS_W,
      h: PRESS_H,
      shape: 'press',
      name: positionName('stick_press'),
      flat: true,
    },
  );

  const chips: ChipPlace[] = [
    { direction: 'up', x: cx - 30, y: STICK_TOP - 30, w: 60, h: CHIP_H },
    { direction: 'down', x: cx - 30, y: STICK_TOP + STICK_SIZE + 4, w: 60, h: CHIP_H },
    { direction: 'left', x: cx - STICK_SIZE / 2 - 56, y: cy - CHIP_H / 2, w: 52, h: CHIP_H },
    { direction: 'right', x: cx + STICK_SIZE / 2 + 4, y: cy - CHIP_H / 2, w: 52, h: CHIP_H },
  ];

  const zones = LEFT_ZONES.map(([name, x, y, w, h]) => ({ name, x: fx(x, w), y, w, h }));

  return {
    hand,
    keys,
    zones,
    chips,
    handTag: { side: right ? 'right' : 'left', x: 18, y: 14 },
  };
}

/**
 * The scale to draw the board at: an explicit `scale` wins; otherwise fit the container's
 * width; with neither, full size. Never zero or negative.
 */
export function unitScale(scale: number | undefined, containerWidth: number | undefined): number {
  const wanted = scale ?? (containerWidth === undefined ? 1 : containerWidth / UNIT_WIDTH);
  return Number.isFinite(wanted) && wanted > 0 ? wanted : 1;
}

/** The drag type the action list sets and a key accepts. */
export const ACTION_DRAG_TYPE = 'application/x-helm-action';

/** Whether a drag carries an action (`dataTransfer.types`). */
export const dragCarriesAction = (types: readonly string[] | undefined): boolean =>
  types !== undefined && Array.from(types).includes(ACTION_DRAG_TYPE);
