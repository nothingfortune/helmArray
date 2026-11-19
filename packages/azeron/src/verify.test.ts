import { describe, expect, it } from 'vitest';
import { storedFromWritten } from './fake';
import type { ButtonRecord, StickRecord, StickTuning } from './records';
import { encodeRecord } from './records';
import type { StoredButton, StoredRecord, StoredStick } from './stored';
import { decodeStoredRecord } from './stored';
import { verify } from './verify';

const tuning: StickTuning = {
  upperLimit: 0,
  lowerLimit: 51,
  angle: 176,
  sensitivity: 3,
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
  isRightAnalog: true,
  invertXAxis: true,
  invertYAxis: false,
};
const stick: StickRecord = {
  kind: 'stick',
  id: 24,
  pinOne: 31,
  pinTwo: 30,
  mode: 'keys',
  tuning,
  directions: { 'left.up': [0xf01a] },
};
const none = { keys: [], mods: [], hold: false, holdTime: 0, turbo: false, turboInterval: 0 };
const scroll: ButtonRecord = {
  kind: 'button',
  id: 3,
  pinOne: 4,
  pinTwo: 255,
  tap: { type: 'wheel', x: 0, y: 1, interval: 150, yInterval: 120 },
  long: { type: 'none', ...none },
  double: { type: 'none', ...none },
  longDelay: 500,
  doubleDelay: 150,
};

/** What a unit holds for a record, as the fake stores it (checked against real units). */
const held = <T extends StoredRecord>(record: StickRecord | ButtonRecord) =>
  decodeStoredRecord(storedFromWritten(encodeRecord(1, record))) as T;
const what = (written: StickRecord | ButtonRecord, stored: StoredRecord) =>
  verify([written], [stored]).differences.map((d) => d.what);

describe('the stick', () => {
  it('passes when every field came back', () => {
    expect(verify([stick], [held(stick)]).differences).toEqual([]);
  });

  it.each<[string, (s: StoredStick) => void]>([
    ['stick angle', (s) => (s.angle = 0)],
    ['stick lower limit', (s) => (s.lowerLimit = 0)],
    ['stick invert X', (s) => (s.invertXAxis = false)],
    ['stick right stick', (s) => (s.isRightAnalog = false)],
    ['stick mouse sensitivity', (s) => (s.mouseSensitivity = 2)],
    ['stick cones', (s) => (s.cones = [49, 45])],
    ['stick direction left.up', (s) => (s.directions['left.up'] = [0xf004, 0, 0])],
    ['stick mode', (s) => (s.typeByte = 0x15)],
  ])('names a %s that differs', (field, change) => {
    const stored = held<StoredStick>(stick);
    change(stored);
    expect(what(stick, stored)).toEqual([field]);
  });

  it('counts combined, hold trigger and angle lock, and reports any unknown switch set', () => {
    const stored = held<StoredStick>(stick);
    stored.switches |= 0x01;
    expect(what(stick, stored)).toEqual(['stick combined, hold trigger and angle lock']);
    const unknown = held<StoredStick>(stick);
    unknown.switches |= 0x20;
    expect(what(stick, unknown)).toEqual(['stick unknown switches']);
  });
});

describe('a scroll', () => {
  it('passes when it came back, and names a direction or speed that differs', () => {
    expect(verify([scroll], [held(scroll)]).differences).toEqual([]);
    const stored = held<StoredButton>(scroll);
    stored.tap.wheel = { x: 0, y: -1, interval: 150, yInterval: 120 };
    expect(what(scroll, stored)).toEqual(['tap scroll']);
  });
});

describe('any input', () => {
  it('names pins that differ, and a stick where a button was written', () => {
    const moved = held<StoredButton>(scroll);
    moved.pinOne = 5;
    expect(what(scroll, moved)).toEqual(['pins']);
    expect(what(scroll, { ...held<StoredStick>(stick), id: 3, pinOne: 4, pinTwo: 255 })).toEqual([
      'kind',
    ]);
  });

  it('reports one held in a layout it can’t read, with its bytes, and never passes it', () => {
    const raw = Uint8Array.from([2, 3, 4, 255, 16, 11, 11]);
    const verdict = verify(
      [scroll],
      [{ kind: 'undecoded', id: 3, pinOne: 4, pinTwo: 255, typeBytes: [16, 11, 11], raw }],
    );
    expect(verdict.unchecked).toEqual([{ id: 3, raw }]);
    expect(verdict.differences.map((d) => d.what)).toEqual(['kind']);
  });
});
