import { describe, expect, it } from 'vitest';
import type { Block, ButtonRecord, StickRecord } from './records';
import {
  BUTTON_RECORD_LENGTH,
  STICK_RECORD_LENGTH,
  WHEEL_RECORD_LENGTH,
  encodeRecord,
} from './records';
import { ProtocolError, toHex } from './report';

const none: Block = {
  type: 'none',
  keys: [],
  mods: [],
  hold: false,
  holdTime: 0,
  turbo: false,
  turboInterval: 0,
};
const button = (over: Partial<ButtonRecord> = {}): ButtonRecord => ({
  kind: 'button',
  id: 1,
  pinOne: 2,
  pinTwo: 255,
  tap: { ...none, type: 'key', keys: [0xf014] },
  long: none,
  double: none,
  longDelay: 500,
  doubleDelay: 150,
  ...over,
});

describe('a button record', () => {
  it('is 68 bytes: slot, id, pins, then tap, long and double', () => {
    const bytes = encodeRecord(3, button());
    expect(bytes).toHaveLength(BUTTON_RECORD_LENGTH);
    expect(toHex(bytes.slice(0, 7))).toBe('030102ff01f014');
    expect(toHex(bytes.slice(24, 25))).toBe('0b');
    expect(toHex(bytes.slice(40, 42))).toBe('01f4'); // the long press's delay, 500
    expect(toHex(bytes.slice(46, 47))).toBe('0b');
    expect(toHex(bytes.slice(62, 64))).toBe('0096'); // the double tap's, 150
  });

  it('is 55 bytes when its tap scrolls, the directions signed', () => {
    const bytes = encodeRecord(
      1,
      button({ tap: { type: 'wheel', x: -1, y: 0, interval: 112, yInterval: 150 } }),
    );
    expect(bytes).toHaveLength(WHEEL_RECORD_LENGTH);
    expect(toHex(bytes.slice(4, 11))).toBe('23ff0000700096');
  });

  it('refuses a value that does not fit, rather than wrap it', () => {
    expect(() =>
      encodeRecord(1, button({ tap: { ...none, turbo: true, turboInterval: 256 } })),
    ).toThrow(ProtocolError);
    expect(() => encodeRecord(1, button({ tap: { ...none, keys: [1, 2, 3, 4, 5] } }))).toThrow(
      ProtocolError,
    );
    expect(() => encodeRecord(1, button({ longDelay: 70000 }))).toThrow(ProtocolError);
    expect(() =>
      encodeRecord(
        1,
        button({ tap: { type: 'wheel', x: 2, y: 0, interval: 150, yInterval: 150 } }),
      ),
    ).not.toThrow();
    expect(() =>
      encodeRecord(
        1,
        button({ tap: { type: 'wheel', x: 200, y: 0, interval: 150, yInterval: 150 } }),
      ),
    ).toThrow(ProtocolError);
  });
});

describe('a stick record', () => {
  const stick: StickRecord = {
    kind: 'stick',
    id: 24,
    pinOne: 31,
    pinTwo: 30,
    mode: 'keys',
    tuning: {
      upperLimit: 91,
      lowerLimit: 11,
      angle: -1,
      sensitivity: 7,
      verticalCone: 45,
      horizontalCone: 45,
      isEightDirectionalTrigger: false,
      mouseSensitivity: 5,
      analogThrottle: 0,
      isAnalogSmoothing: false,
      triggerMagnitude: 4,
      isCombinedAnalog: false,
      combinedAnalogMagnitude: 6,
      isHoldTrigger: false,
      holdMagnitude: 9,
      holdType: 1,
      holdKeys: [0xe002],
      rotateStickButtonId: 0,
      isAngleLock: false,
      lockZoneAngle: 70,
      lockZoneSize: 30,
      isRightAnalog: false,
      invertXAxis: true,
      invertYAxis: false,
    },
    directions: { 'left.up': [0xf01a] },
  };

  it('is 134 bytes, the angle signed and the directions after the tuning', () => {
    const bytes = encodeRecord(4, stick);
    expect(bytes).toHaveLength(STICK_RECORD_LENGTH);
    expect(toHex(bytes.slice(0, 5))).toBe('04181f1e04');
    expect(toHex(bytes.slice(9, 11))).toBe('ffff');
    expect(toHex(bytes.slice(35, 38))).toBe('000100'); // right stick, invert X, invert Y
    expect(toHex(bytes.slice(38, 40))).toBe('f01a');
  });

  it('carries its mode in the type byte', () => {
    expect(encodeRecord(4, { ...stick, mode: 'pad' })[4]).toBe(0x15);
    expect(encodeRecord(4, { ...stick, mode: 'mouse' })[4]).toBe(0x28);
  });
});
