// A plan's UnitProfile as the records to write into a slot. Everything a record holds comes
// from the plan and the unit's device data (its pins, stick angle and X fact); nothing here
// knows which hand is which beyond what the device says.

import type {
  AzeronDevice,
  KeyCode,
  Mod,
  MouseButton,
  PadControl,
  PinPlan,
  Press,
  ScrollDirection,
  Signal,
  StickDirection as CoreStickDirection,
  StickDirections,
  UnitProfile,
} from '@helmarray/core';
import type {
  Block,
  ButtonRecord,
  StickRecord,
  StickTuning,
  UnitRecord,
  WheelTap,
} from './records';
import { ProtocolError } from './report';

/**
 * The app's input id for each pin. The same on both units and on firmware 111 and 112: every
 * slot read or written in reference/ holds exactly these (test/unit-records.test.ts).
 */
export const INPUT_ID_BY_PIN: ReadonlyMap<number, number> = new Map([
  [2, 1], [3, 2], [4, 3], [5, 4], [8, 5], [9, 6], [10, 7], [11, 8], [14, 9], [15, 10],
  [16, 11], [17, 12], [13, 13], [23, 14], [24, 15], [25, 16], [26, 17], [22, 18], [27, 19],
  [19, 20], [37, 22], [32, 23], [31, 24], [34, 28], [35, 29], [36, 30], [33, 31], [6, 36],
  [1, 37], [7, 38], [20, 41],
]); // prettier-ignore

/** The unit's code for each key: `0xF000 | HID usage`, a modifier `0xE000 | bit`. */
export const UNIT_KEY_CODES: Readonly<Record<KeyCode, number>> = {
  A: 0xf004, B: 0xf005, C: 0xf006, D: 0xf007, E: 0xf008, F: 0xf009, G: 0xf00a, H: 0xf00b,
  I: 0xf00c, J: 0xf00d, K: 0xf00e, L: 0xf00f, M: 0xf010, N: 0xf011, O: 0xf012, P: 0xf013,
  Q: 0xf014, R: 0xf015, S: 0xf016, T: 0xf017, U: 0xf018, V: 0xf019, W: 0xf01a, X: 0xf01b,
  Y: 0xf01c, Z: 0xf01d,
  '1': 0xf01e, '2': 0xf01f, '3': 0xf020, '4': 0xf021, '5': 0xf022, '6': 0xf023, '7': 0xf024,
  '8': 0xf025, '9': 0xf026, '0': 0xf027,
  Enter: 0xf028, Esc: 0xf029, Backspace: 0xf02a, Tab: 0xf02b, Space: 0xf02c,
  '-': 0xf02d, '=': 0xf02e, '[': 0xf02f, ']': 0xf030, '\\': 0xf031, ';': 0xf033, "'": 0xf034,
  '`': 0xf035, ',': 0xf036, '.': 0xf037, '/': 0xf038, Caps: 0xf039,
  F1: 0xf03a, F2: 0xf03b, F3: 0xf03c, F4: 0xf03d, F5: 0xf03e, F6: 0xf03f, F7: 0xf040,
  F8: 0xf041, F9: 0xf042, F10: 0xf043, F11: 0xf044, F12: 0xf045,
  PrintScreen: 0xf046, ScrollLock: 0xf047, Pause: 0xf048, Insert: 0xf049, Home: 0xf04a,
  PageUp: 0xf04b, Del: 0xf04c, End: 0xf04d, PageDown: 0xf04e,
  Right: 0xf04f, Left: 0xf050, Down: 0xf051, Up: 0xf052,
  NumLock: 0xf053, NumDivide: 0xf054, NumMultiply: 0xf055, NumSubtract: 0xf056, NumAdd: 0xf057,
  NumEnter: 0xf058, Num1: 0xf059, Num2: 0xf05a, Num3: 0xf05b, Num4: 0xf05c, Num5: 0xf05d,
  Num6: 0xf05e, Num7: 0xf05f, Num8: 0xf060, Num9: 0xf061, Num0: 0xf062, NumDecimal: 0xf063,
  Menu: 0xf065,
  F13: 0xf068, F14: 0xf069, F15: 0xf06a, F16: 0xf06b, F17: 0xf06c, F18: 0xf06d, F19: 0xf06e,
  F20: 0xf06f, F21: 0xf070, F22: 0xf071, F23: 0xf072, F24: 0xf073,
  LCtrl: 0xe001, LShift: 0xe002, LAlt: 0xe004, LWin: 0xe008,
  RCtrl: 0xe010, RShift: 0xe020, RAlt: 0xe040, RWin: 0xe080,
}; // prettier-ignore

const MOD_CODES: Readonly<Record<Mod, number>> = { ctrl: 0xe001, shift: 0xe002, alt: 0xe004 };

/**
 * Mouse buttons by number: left 1 and right 3 confirmed in play, middle 2 in the app, back 4
 * and forward 5 written by the app and pressed in a browser (2026-11-19).
 */
const MOUSE_NUMBERS: Readonly<Record<MouseButton, number>> = {
  left: 1,
  middle: 2,
  right: 3,
  back: 4,
  forward: 5,
};

/**
 * Xbox buttons by their XInput bit, as the app's export and wire carry them (A 0x1000 seen).
 * The triggers are their own type, 1 left and 2 right. The stick directions as buttons were
 * never seen sent, so they are not here.
 */
const PAD_BITS: Partial<Record<PadControl, number>> = {
  DPAD_UP: 0x0001,
  DPAD_DOWN: 0x0002,
  DPAD_LEFT: 0x0004,
  DPAD_RIGHT: 0x0008,
  START: 0x0010,
  BACK: 0x0020,
  LS: 0x0040,
  RS: 0x0080,
  LB: 0x0100,
  RB: 0x0200,
  A: 0x1000,
  B: 0x2000,
  X: 0x4000,
  Y: 0x8000,
};
const TRIGGERS: Partial<Record<PadControl, number>> = { LT: 1, RT: 2 };

/** The app's own defaults, as every captured slot that left them alone holds them. */
const DEFAULT_LONG_DELAY = 500;
const DEFAULT_DOUBLE_DELAY = 150;
const STILL_INTERVAL = 150;
/** The stick's travel, which the deadzones are a share of. */
const STICK_TRAVEL = 512;

const EMPTY: Block = {
  type: 'none',
  keys: [],
  mods: [],
  hold: false,
  holdTime: 0,
  turbo: false,
  turboInterval: 0,
};

function scroll(dir: ScrollDirection, speed: number, where: string): WheelTap {
  if (!Number.isInteger(speed) || speed < 0 || speed > 100) {
    throw new ProtocolError(`${where}: a scroll speed is 0 to 100, not ${speed}.`);
  }
  // The app's own sum, sent whole: (100 - speed) × 1.5 on the moving axis, 150 on the other.
  const moving = Math.trunc((100 - speed) * 1.5);
  const vertical = dir === 'up' || dir === 'down';
  return {
    type: 'wheel',
    x: dir === 'right' ? 1 : dir === 'left' ? -1 : 0,
    y: dir === 'up' ? 1 : dir === 'down' ? -1 : 0,
    interval: vertical ? STILL_INTERVAL : moving,
    yInterval: vertical ? moving : STILL_INTERVAL,
  };
}

function blockFor(signal: Signal, pin: PinPlan, where: string): Block {
  const base: Block = {
    ...EMPTY,
    hold: pin.latch,
    turbo: pin.turbo !== false,
    turboInterval: pin.turbo === false ? 0 : pin.turbo.interval,
  };
  switch (signal.kind) {
    case 'key':
      return {
        ...base,
        type: 'key',
        keys: [UNIT_KEY_CODES[signal.code]],
        mods: (signal.mods ?? []).map((m) => MOD_CODES[m]),
      };
    case 'mouse': {
      return { ...base, type: 'mouse', keys: [MOUSE_NUMBERS[signal.button]] };
    }
    case 'pad': {
      const bit = PAD_BITS[signal.control];
      if (bit !== undefined) return { ...base, type: 'pad', keys: [bit] };
      const trigger = TRIGGERS[signal.control];
      if (trigger !== undefined) return { ...base, type: 'trigger', keys: [trigger] };
      throw new ProtocolError(
        `${where}: Xbox ${signal.control} on a button was never captured, so it can't be sent.`,
      );
    }
    case 'scroll':
      throw new ProtocolError(`${where}: a unit scrolls only on a tap.`);
    case 'macro':
      throw new ProtocolError(`${where}: macros are typed by the app, not stored on a unit.`);
  }
}

function pressBlock(pin: PinPlan, press: Press, where: string): Block | WheelTap {
  const signal = pin.presses[press];
  if (!signal) return EMPTY;
  if (signal.kind === 'scroll' && press === 'tap') {
    // A stored scroll has no room for hold or turbo: refused rather than dropped unsaid.
    if (pin.latch || pin.turbo !== false) {
      throw new ProtocolError(`${where}: a scroll can't latch or repeat on the unit.`);
    }
    return scroll(signal.dir, signal.speed, where);
  }
  return blockFor(signal, pin, `${where} ${press}`);
}

function buttonRecord(pin: PinPlan, id: number): ButtonRecord {
  const where = pin.control;
  const long = pressBlock(pin, 'long', where);
  const double = pressBlock(pin, 'double', where);
  if (long.type === 'wheel' || double.type === 'wheel') {
    // Stryker disable next-line StringLiteral: unreachable message; pressBlock hands back a scroll only for a tap, the guard only narrows the type
    throw new ProtocolError(`${where}: a unit scrolls only on a tap.`);
  }
  return {
    kind: 'button',
    id,
    pinOne: pin.pin,
    pinTwo: pin.pinTwo ?? 255,
    tap: pressBlock(pin, 'tap', where),
    long,
    double,
    longDelay: DEFAULT_LONG_DELAY,
    doubleDelay: DEFAULT_DOUBLE_DELAY,
  };
}

function percentOfTravel(value: number, what: string, where: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 99) {
    throw new ProtocolError(`${where}: the ${what} is 0 to 99 percent, not ${value}.`);
  }
  return Math.round((value * STICK_TRAVEL) / 100);
}

function stickRecord(profile: UnitProfile, device: AzeronDevice): StickRecord {
  const position = device.positions.find((p) => p.name === 'stick');
  const id = position && INPUT_ID_BY_PIN.get(position.pin);
  if (!position || position.pinTwo === undefined || id === undefined) {
    throw new ProtocolError(`${device.name} has no stick on the pins the app writes.`);
  }
  const s = profile.stick;
  const where = `${profile.hand === 'left' ? 'L' : 'R'}.stick`;
  const mode = s.mode === 'keys' ? 'keys' : s.mode === 'mouse' ? 'mouse' : 'pad';
  if (s.sensitivity !== undefined && mode !== 'mouse') {
    throw new ProtocolError(`${where}: sensitivity is for a stick that moves the mouse.`);
  }
  const lowerLimit = percentOfTravel(s.deadzone ?? 0, 'deadzone', where);
  const upperLimit = percentOfTravel(100 - (s.outerEdge ?? 100), 'outer edge', where);
  if (lowerLimit + upperLimit >= STICK_TRAVEL) {
    throw new ProtocolError(`${where}: the deadzone and outer edge leave the stick no travel.`);
  }
  const tuning: StickTuning = {
    upperLimit,
    lowerLimit,
    angle: s.angle,
    sensitivity: 3,
    verticalCone: 45,
    horizontalCone: 45,
    isEightDirectionalTrigger: false,
    mouseSensitivity: s.sensitivity ?? 5,
    analogThrottle: 0,
    isAnalogSmoothing: false,
    triggerMagnitude: 4,
    isCombinedAnalog: false,
    combinedAnalogMagnitude: 6,
    isHoldTrigger: false,
    holdMagnitude: 9,
    holdType: 1,
    holdKeys: [UNIT_KEY_CODES.LShift],
    rotateStickButtonId: 0,
    isAngleLock: false,
    lockZoneAngle: 70,
    lockZoneSize: 30,
    // As an Xbox stick, this picks which one: set, the right stick, on either unit (written and
    // shown so by the app, 2026-11-19). In key or mouse mode the app sets it on a right unit.
    isRightAnalog: mode === 'pad' ? s.mode === 'pad-right' : profile.hand === 'right',
    invertXAxis: s.invertX,
    invertYAxis: s.invertY ?? false,
  };
  return {
    kind: 'stick',
    id,
    pinOne: position.pin,
    pinTwo: position.pinTwo,
    mode,
    tuning,
    directions:
      mode === 'keys' ? directionKeys(s.directions ?? {}, tuning.isRightAnalog, where) : {},
  };
}

/** core's four directions; `azeron` may import only core's types, so they're listed here. */
const CORE_STICK_DIRECTIONS: readonly CoreStickDirection[] = ['up', 'down', 'left', 'right'];

/**
 * A key-mode stick's direction keys, in the block the unit reads: `isRightAnalog` set reads the
 * right block, clear the left (legacy CLAUDE.md, export format rules: writing the other block
 * compiles and does nothing on the hardware). Each direction is [key, modifier, modifier].
 */
function directionKeys(
  directions: StickDirections,
  rightBlock: boolean,
  where: string,
): StickRecord['directions'] {
  const block = rightBlock ? 'right' : 'left';
  const out: StickRecord['directions'] = {};
  for (const direction of CORE_STICK_DIRECTIONS) {
    const signal = directions[direction];
    if (signal === undefined) continue;
    if (signal.kind !== 'key') {
      throw new ProtocolError(
        `${where} ${direction}: a stick direction sends a key, nothing else.`,
      );
    }
    const mods = (signal.mods ?? []).map((m) => MOD_CODES[m]);
    if (mods.length > 2) {
      throw new ProtocolError(
        `${where} ${direction}: a stick direction holds two modifiers at most.`,
      );
    }
    out[`${block}.${direction}`] = [UNIT_KEY_CODES[signal.code], ...mods];
  }
  return out;
}

/**
 * Every record a slot gets for a unit's profile, by input id. Pins the press test found wired
 * to nothing and the profile switch on pin 0 are left alone, as the app leaves them.
 */
export function unitRecords(profile: UnitProfile, device: AzeronDevice): UnitRecord[] {
  if (profile.deviceId !== device.id || profile.hand !== device.hand) {
    throw new ProtocolError(`This profile is for ${profile.deviceId}, not ${device.id}.`);
  }
  const records: UnitRecord[] = [stickRecord(profile, device)];
  for (const pin of profile.pins) {
    if (pin.pin === 0 || device.unknownPins.includes(pin.pin)) continue;
    const id = INPUT_ID_BY_PIN.get(pin.pin);
    if (id === undefined)
      throw new ProtocolError(`${pin.control}: pin ${pin.pin} has no input id.`);
    records.push(buttonRecord(pin, id));
  }
  return records.sort((a, b) => a.id - b.id);
}
