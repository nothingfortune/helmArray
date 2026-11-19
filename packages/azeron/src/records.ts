// What OBM_COPY carries: one input record into a slot (reference/guides/unit-protocol.md, "An
// input record, as written" and "Firmware 112"). Records are in the unit's own terms: its key
// codes and type bytes. Every layout here reproduces the Azeron app's own records byte for
// byte (test/unit-records.test.ts). All 16-bit values go big-endian.

import { ProtocolError } from './report';

/** What a press sends, by the unit's type byte. */
export const BLOCK_TYPES = {
  key: 1,
  disabled: 6,
  none: 11,
  mouse: 15,
  pad: 0x16,
  trigger: 0x17,
} as const;
export type BlockType = keyof typeof BLOCK_TYPES;

/**
 * One press of a button. `keys` are the unit's codes: a key's `0xF000 | HID usage`, a mouse
 * button's number, an Xbox button's XInput bit, or a trigger's 1 (left) / 2 (right). `mods` are
 * modifier codes (`0xE000 | bit`). Missing entries are 0.
 */
export interface Block {
  type: BlockType;
  keys: readonly number[];
  mods: readonly number[];
  /** Hold to latch: the key stays down until pressed again. */
  hold: boolean;
  holdTime: number;
  turbo: boolean;
  turboInterval: number;
}

/**
 * A tap that scrolls. Directions are 1 or -1 on the axis that moves (x right, y up), 0 on the
 * other; each interval is the time between steps, the app's `(100 - speed) × 1.5`, 150 still.
 */
export interface WheelTap {
  type: 'wheel';
  x: number;
  y: number;
  interval: number;
  yInterval: number;
}

export interface ButtonRecord {
  kind: 'button';
  id: number;
  pinOne: number;
  /** 255 for a button on one pin. */
  pinTwo: number;
  tap: Block | WheelTap;
  long: Block;
  double: Block;
  /** How long a press must be to be long, in ms (the app's default is 500). */
  longDelay: number;
  /** How long to wait for a second tap, in ms (the app's default is 150). */
  doubleDelay: number;
}

export const STICK_TYPES = { keys: 4, pad: 0x15, mouse: 0x28 } as const;
export type StickType = keyof typeof STICK_TYPES;

/** The stick's tuning, in the order the app sends it. Names are the app's export fields. */
export interface StickTuning {
  upperLimit: number;
  lowerLimit: number;
  /** Degrees, signed: -1 is none. */
  angle: number;
  sensitivity: number;
  verticalCone: number;
  horizontalCone: number;
  isEightDirectionalTrigger: boolean;
  mouseSensitivity: number;
  analogThrottle: number;
  isAnalogSmoothing: boolean;
  triggerMagnitude: number;
  isCombinedAnalog: boolean;
  combinedAnalogMagnitude: number;
  isHoldTrigger: boolean;
  holdMagnitude: number;
  holdType: number;
  /** As sent: Shift is 0xE002; the app sent its "17" as 0x0011. */
  holdKeys: readonly number[];
  rotateStickButtonId: number;
  isAngleLock: boolean;
  lockZoneAngle: number;
  lockZoneSize: number;
  isRightAnalog: boolean;
  invertXAxis: boolean;
  invertYAxis: boolean;
}

/** The stick's 16 directions, in the order sent, each a key and two modifiers. */
export const STICK_DIRECTIONS = [
  'left.up',
  'left.right',
  'left.down',
  'left.left',
  'right.up',
  'right.right',
  'right.down',
  'right.left',
  'left.up_right',
  'left.up_left',
  'left.down_left',
  'left.down_right',
  'right.up_right',
  'right.up_left',
  'right.down_left',
  'right.down_right',
] as const;
export type StickDirection = (typeof STICK_DIRECTIONS)[number];

export interface StickRecord {
  kind: 'stick';
  id: number;
  pinOne: number;
  pinTwo: number;
  mode: StickType;
  tuning: StickTuning;
  /** Key codes per direction: [key, modifier, modifier]. Missing directions send nothing. */
  directions: Partial<Record<StickDirection, readonly number[]>>;
}

export type UnitRecord = ButtonRecord | StickRecord;

export const BUTTON_RECORD_LENGTH = 68;
export const WHEEL_RECORD_LENGTH = 55;
export const STICK_RECORD_LENGTH = 134;

class Writer {
  private readonly bytes: number[] = [];
  constructor(private readonly where: string) {}
  u8(value: number, what: string) {
    this.check(value, 0, 0xff, what);
    this.bytes.push(value);
  }
  i8(value: number, what: string) {
    this.check(value, -0x80, 0x7f, what);
    this.bytes.push(value & 0xff);
  }
  u16(value: number, what: string) {
    this.check(value, 0, 0xffff, what);
    this.bytes.push(value >> 8, value & 0xff);
  }
  i16(value: number, what: string) {
    this.check(value, -0x8000, 0x7fff, what);
    this.u16(value & 0xffff, what);
  }
  flag(value: boolean) {
    this.bytes.push(value ? 1 : 0);
  }
  list(values: readonly number[], count: number, what: string) {
    if (values.length > count) {
      throw new ProtocolError(
        `${this.where}: ${what} has ${values.length} entries; it holds ${count}.`,
      );
    }
    for (let i = 0; i < count; i++) this.u16(values[i] ?? 0, what);
  }
  done(length: number): Uint8Array {
    if (this.bytes.length !== length) {
      throw new ProtocolError(`${this.where} came to ${this.bytes.length} bytes, not ${length}.`);
    }
    return Uint8Array.from(this.bytes);
  }
  private check(value: number, min: number, max: number, what: string) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new ProtocolError(`${this.where}: ${what} is ${value}, which doesn't fit.`);
    }
  }
}

function block(w: Writer, b: Block, delay: number | undefined, what: string) {
  w.u8(BLOCK_TYPES[b.type], `${what} type`);
  w.list(b.keys, 4, `${what} keys`);
  w.list(b.mods, 3, `${what} modifiers`);
  w.flag(b.hold);
  if (delay !== undefined) w.u16(delay, `${what} delay`);
  w.u16(b.holdTime, `${what} hold time`);
  w.flag(b.turbo);
  w.u8(b.turboInterval, `${what} turbo interval`);
}

function encodeButton(slot: number, r: ButtonRecord): Uint8Array {
  const w = new Writer(`input ${r.id}`);
  w.u8(slot, 'slot');
  w.u8(r.id, 'id');
  w.u8(r.pinOne, 'pin');
  w.u8(r.pinTwo, 'second pin');
  if (r.tap.type === 'wheel') {
    w.u8(0x23, 'tap type');
    w.i8(r.tap.x, 'scroll x');
    w.i8(r.tap.y, 'scroll y');
    w.u16(r.tap.interval, 'scroll interval');
    w.u16(r.tap.yInterval, 'scroll y interval');
  } else {
    block(w, r.tap, undefined, 'tap');
  }
  block(w, r.long, r.longDelay, 'long press');
  block(w, r.double, r.doubleDelay, 'double tap');
  return w.done(r.tap.type === 'wheel' ? WHEEL_RECORD_LENGTH : BUTTON_RECORD_LENGTH);
}

function encodeStick(slot: number, r: StickRecord): Uint8Array {
  const w = new Writer(`stick ${r.id}`);
  const t = r.tuning;
  w.u8(slot, 'slot');
  w.u8(r.id, 'id');
  w.u8(r.pinOne, 'pin');
  w.u8(r.pinTwo, 'second pin');
  w.u8(STICK_TYPES[r.mode], 'type');
  w.u16(t.upperLimit, 'upper limit');
  w.u16(t.lowerLimit, 'lower limit');
  w.i16(t.angle, 'angle');
  w.u16(t.sensitivity, 'sensitivity');
  w.u8(t.verticalCone, 'vertical cone');
  w.u8(t.horizontalCone, 'horizontal cone');
  w.flag(t.isEightDirectionalTrigger);
  w.u8(t.mouseSensitivity, 'mouse sensitivity');
  w.u8(t.analogThrottle, 'analog throttle');
  w.flag(t.isAnalogSmoothing);
  w.u8(t.triggerMagnitude, 'trigger magnitude');
  w.flag(t.isCombinedAnalog);
  w.u8(t.combinedAnalogMagnitude, 'combined magnitude');
  w.flag(t.isHoldTrigger);
  w.u8(t.holdMagnitude, 'hold magnitude');
  w.u8(t.holdType, 'hold type');
  w.list(t.holdKeys, 3, 'hold keys');
  w.u8(t.rotateStickButtonId, 'rotate button');
  w.flag(t.isAngleLock);
  w.u8(t.lockZoneAngle, 'lock zone angle');
  w.u8(t.lockZoneSize, 'lock zone size');
  w.flag(t.isRightAnalog);
  w.flag(t.invertXAxis);
  w.flag(t.invertYAxis);
  for (const direction of STICK_DIRECTIONS) w.list(r.directions[direction] ?? [], 3, direction);
  return w.done(STICK_RECORD_LENGTH);
}

/** The OBM_COPY payload for one record into a slot. */
export function encodeRecord(slot: number, record: UnitRecord): Uint8Array {
  return record.kind === 'stick' ? encodeStick(slot, record) : encodeButton(slot, record);
}

/** The longest name a unit was seen to keep. */
export const MAX_PROFILE_NAME = 19;

/** PROFILE_NAME's payload: `[slot][length][name]`, printable ASCII, 1 to 19 characters. */
export function profileNamePayload(slot: number, name: string): Uint8Array {
  if (!Number.isInteger(slot) || slot < 0 || slot > 0xff) {
    throw new ProtocolError(`Slot ${slot} is not one a unit has.`);
  }
  const bytes = Array.from(name, (ch) => ch.charCodeAt(0));
  if (bytes.length === 0 || bytes.length > MAX_PROFILE_NAME) {
    throw new ProtocolError(`A unit keeps a name of 1 to ${MAX_PROFILE_NAME} characters.`);
  }
  if (bytes.some((b) => b < 0x20 || b > 0x7e)) {
    throw new ProtocolError(`A unit keeps only plain letters, digits and punctuation in a name.`);
  }
  return Uint8Array.from([slot, bytes.length, ...bytes]);
}
