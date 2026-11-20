import { describe, expect, it } from 'vitest';
import type { PinPlan, Signal, UnitProfile } from '@helmarray/core';
import { CYBORG2_LEFT, CYBORG2_RIGHT } from '@helmarray/core';
import { unitRecords } from './profile';
import type { ButtonRecord, StickRecord } from './records';
import { ProtocolError } from './report';

const pin = (presses: PinPlan['presses'], over: Partial<PinPlan> = {}): PinPlan => ({
  control: 'L.index_1',
  position: 'index_1',
  pin: CYBORG2_LEFT.positions.find((p) => p.name === 'index_1')?.pin ?? -1,
  presses,
  turbo: false,
  latch: false,
  ...over,
});
const profile = (pins: PinPlan[], stick: Partial<UnitProfile['stick']> = {}): UnitProfile => ({
  deviceId: CYBORG2_LEFT.id,
  hand: 'left',
  pins,
  stick: { mode: 'keys', angle: -1, invertX: false, ...stick },
});
const index1 = (p: UnitProfile) =>
  unitRecords(p, CYBORG2_LEFT).find(
    (r): r is ButtonRecord => r.kind === 'button' && r.pinOne === p.pins[0]?.pin,
  );
const stickOf = (p: UnitProfile, device = CYBORG2_LEFT) =>
  unitRecords(p, device).find((r): r is StickRecord => r.kind === 'stick');
const key = (code: string, mods?: ('ctrl' | 'shift' | 'alt')[]): Signal =>
  ({ kind: 'key', code, ...(mods ? { mods } : {}) }) as Signal;

describe('a button', () => {
  it('sends a key with its modifiers, and nothing on the presses it has none for', () => {
    const r = index1(profile([pin({ tap: key('Insert', ['ctrl', 'shift']) })]));
    expect(r?.tap).toMatchObject({ type: 'key', keys: [0xf049], mods: [0xe001, 0xe002] });
    expect(r?.long.type).toBe('none');
    expect(r?.double.type).toBe('none');
    expect([r?.longDelay, r?.doubleDelay]).toEqual([500, 150]);
  });

  it('carries latch and turbo on every press it has', () => {
    const r = index1(
      profile([
        pin({ tap: key('F13'), long: key('F14') }, { latch: true, turbo: { interval: 40 } }),
      ]),
    );
    expect(r?.tap).toMatchObject({ hold: true, turbo: true, turboInterval: 40 });
    expect(r?.long).toMatchObject({ hold: true, turbo: true, turboInterval: 40 });
  });

  it('sends Xbox buttons by their XInput bit and the triggers as their own type', () => {
    const r = index1(
      profile([
        pin({
          tap: { kind: 'pad', control: 'A' },
          long: { kind: 'pad', control: 'RT' },
          double: { kind: 'pad', control: 'DPAD_LEFT' },
        }),
      ]),
    );
    expect(r?.tap).toMatchObject({ type: 'pad', keys: [0x1000] });
    expect(r?.long).toMatchObject({ type: 'trigger', keys: [2] });
    expect(r?.double).toMatchObject({ type: 'pad', keys: [0x0004] });
  });

  it('refuses a scroll that latches or repeats, which the unit has no room for', () => {
    const up = { tap: { kind: 'scroll', dir: 'up', speed: 33 } } as const;
    expect(() => index1(profile([pin(up, { latch: true })]))).toThrow('latch or repeat');
    expect(() => index1(profile([pin(up, { turbo: { interval: 20 } })]))).toThrow(ProtocolError);
  });

  it('sends mouse back and forward as buttons 4 and 5', () => {
    const r = index1(
      profile([
        pin({ tap: { kind: 'mouse', button: 'back' }, long: { kind: 'mouse', button: 'forward' } }),
      ]),
    );
    expect(r?.tap).toMatchObject({ type: 'mouse', keys: [4] });
    expect(r?.long).toMatchObject({ type: 'mouse', keys: [5] });
  });

  it('scrolls on a tap at the app’s own rate: speed 33 up is 100 between steps', () => {
    const up = index1(profile([pin({ tap: { kind: 'scroll', dir: 'up', speed: 33 } })]));
    expect(up?.tap).toEqual({ type: 'wheel', x: 0, y: 1, interval: 150, yInterval: 100 });
    const left = index1(profile([pin({ tap: { kind: 'scroll', dir: 'left', speed: 25 } })]));
    expect(left?.tap).toEqual({ type: 'wheel', x: -1, y: 0, interval: 112, yInterval: 150 });
  });

  it.each<[string, PinPlan['presses']]>([
    ['scroll on a long press', { long: { kind: 'scroll', dir: 'up', speed: 33 } }],
    ['a stick direction as a button', { tap: { kind: 'pad', control: 'LS_UP' } }],
    ['a macro', { tap: { kind: 'macro', trigger: 'F13' } }],
    ['a scroll speed over 100', { tap: { kind: 'scroll', dir: 'up', speed: 101 } }],
  ])('refuses %s', (_, presses) => {
    expect(() => index1(profile([pin(presses)]))).toThrow(ProtocolError);
  });
});

describe('the stick', () => {
  it('carries the unit’s angle and X fact, and the plan’s deadzones', () => {
    const s = stickOf(
      profile([], { angle: -1, invertX: true, invertY: true, deadzone: 10, outerEdge: 90 }),
    );
    expect(s).toMatchObject({ id: 24, pinOne: 31, pinTwo: 30, mode: 'keys' });
    expect(s?.tuning).toMatchObject({
      angle: -1,
      invertXAxis: true,
      invertYAxis: true,
      lowerLimit: 51,
      upperLimit: 51,
      isRightAnalog: false,
    });
  });

  it('is marked right on the right unit, as the app marks every right-unit write', () => {
    const right: UnitProfile = {
      deviceId: CYBORG2_RIGHT.id,
      hand: 'right',
      pins: [],
      stick: { mode: 'keys', angle: 176, invertX: false },
    };
    expect(stickOf(right, CYBORG2_RIGHT)?.tuning.isRightAnalog).toBe(true);
  });

  it('writes a key stick’s directions into the block the unit reads: left, or right by isRightAnalog', () => {
    // Key codes as the unit stores them: W 0xF01A, S 0xF016, A 0xF004, D 0xF007; Shift 0xE002.
    const wasd = {
      up: { kind: 'key', code: 'W' },
      down: { kind: 'key', code: 'S' },
      left: { kind: 'key', code: 'A', mods: ['shift'] },
      right: { kind: 'key', code: 'D' },
    } as const;
    expect(stickOf(profile([], { directions: wasd }))?.directions).toEqual({
      'left.up': [0xf01a],
      'left.down': [0xf016],
      'left.left': [0xf004, 0xe002],
      'left.right': [0xf007],
    });
    const right: UnitProfile = {
      deviceId: CYBORG2_RIGHT.id,
      hand: 'right',
      pins: [],
      stick: { mode: 'keys', angle: 176, invertX: false, directions: { up: wasd.up } },
    };
    expect(stickOf(right, CYBORG2_RIGHT)?.directions).toEqual({ 'right.up': [0xf01a] });
  });

  it('writes no directions for a stick that isn’t on keys, and refuses one that isn’t a key', () => {
    const up = { up: { kind: 'key', code: 'W' } } as const;
    expect(stickOf(profile([], { mode: 'pad-left', directions: up }))?.directions).toEqual({});
    expect(() =>
      stickOf(profile([], { directions: { up: { kind: 'mouse', button: 'left' } } })),
    ).toThrow(ProtocolError);
  });

  it('as an Xbox stick, is the right stick or the left by isRightAnalog, on either unit', () => {
    expect(stickOf(profile([], { mode: 'pad-right' }))?.tuning.isRightAnalog).toBe(true);
    expect(stickOf(profile([], { mode: 'pad-left' }))?.tuning.isRightAnalog).toBe(false);
    const right = (mode: 'pad-left' | 'pad-right'): UnitProfile => ({
      deviceId: CYBORG2_RIGHT.id,
      hand: 'right',
      pins: [],
      stick: { mode, angle: 176, invertX: false },
    });
    expect(stickOf(right('pad-right'), CYBORG2_RIGHT)?.tuning.isRightAnalog).toBe(true);
    expect(stickOf(right('pad-left'), CYBORG2_RIGHT)?.tuning.isRightAnalog).toBe(false);
  });

  it('refuses deadzones that leave no travel, and sensitivity on a stick that isn’t a mouse', () => {
    expect(() => stickOf(profile([], { deadzone: 60, outerEdge: 40 }))).toThrow(ProtocolError);
    expect(() => stickOf(profile([], { deadzone: 100 }))).toThrow(ProtocolError);
    expect(() => stickOf(profile([], { sensitivity: 3 }))).toThrow(ProtocolError);
  });
});

it('refuses a profile meant for the other unit', () => {
  expect(() => unitRecords(profile([]), CYBORG2_RIGHT)).toThrow(ProtocolError);
});
