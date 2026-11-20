// The edges of unitRecords: each limit exactly at its boundary, and what a person is told when
// a profile is refused. Found by mutation testing: these are the changes no other test noticed.
import { describe, expect, it } from 'vitest';
import type { AzeronDevice, PinPlan, Signal, UnitProfile } from '@helmarray/core';
import { CYBORG2_LEFT, CYBORG2_RIGHT } from '@helmarray/core';
import { unitRecords } from './profile';
import type { ButtonRecord, StickRecord } from './records';

const pin = (presses: PinPlan['presses'], over: Partial<PinPlan> = {}): PinPlan => ({
  control: 'L.index_1',
  position: 'index_1',
  pin: CYBORG2_LEFT.positions.find((p) => p.name === 'index_1')?.pin ?? -1,
  presses,
  turbo: false,
  latch: false,
  ...over,
});
const profile = (
  pins: PinPlan[],
  stick: Partial<UnitProfile['stick']> = {},
  over: Partial<UnitProfile> = {},
): UnitProfile => ({
  deviceId: CYBORG2_LEFT.id,
  hand: 'left',
  pins,
  stick: { mode: 'keys', angle: -1, invertX: false, ...stick },
  ...over,
});
const records = (p: UnitProfile, device: AzeronDevice = CYBORG2_LEFT) => unitRecords(p, device);
const button = (p: UnitProfile) =>
  records(p).find((r): r is ButtonRecord => r.kind === 'button' && r.pinOne === p.pins[0]?.pin);
const stick = (p: UnitProfile, device: AzeronDevice = CYBORG2_LEFT) =>
  records(p, device).find((r): r is StickRecord => r.kind === 'stick');
const key = (code: string, mods?: ('ctrl' | 'shift' | 'alt')[]): Signal =>
  ({ kind: 'key', code, ...(mods ? { mods } : {}) }) as Signal;
const scroll = (dir: 'up' | 'down' | 'left' | 'right', speed: number): Signal => ({
  kind: 'scroll',
  dir,
  speed,
});

describe('a scroll', () => {
  it.each([
    ['right', 1, 0],
    ['left', -1, 0],
    ['up', 0, 1],
    ['down', 0, -1],
  ] as const)('%s at speed 34 moves x %i, y %i', (dir, x, y) => {
    const tap = button(profile([pin({ tap: scroll(dir, 34) })]))?.tap;
    const vertical = dir === 'up' || dir === 'down';
    expect(tap).toEqual({
      type: 'wheel',
      x,
      y,
      interval: vertical ? 150 : 99,
      yInterval: vertical ? 99 : 150,
    });
  });

  it.each([
    [0, 150],
    [100, 0],
  ])('is allowed at speed %i, with the moving interval %i', (speed, interval) => {
    const tap = button(profile([pin({ tap: scroll('left', speed) })]))?.tap;
    expect(tap).toMatchObject({ type: 'wheel', interval });
  });

  it.each([-1, 101, 33.5])('is refused at speed %s, in plain words', (speed) => {
    expect(() => records(profile([pin({ tap: scroll('left', speed) })]))).toThrow(
      `L.index_1: a scroll speed is 0 to 100, not ${speed}.`,
    );
  });

  it('is refused on a long press or a double tap, which a unit cannot scroll on', () => {
    expect(() => records(profile([pin({ long: scroll('up', 50) })]))).toThrow(
      'L.index_1 long: a unit scrolls only on a tap.',
    );
    expect(() => records(profile([pin({ double: scroll('up', 50) })]))).toThrow(
      'L.index_1 double: a unit scrolls only on a tap.',
    );
  });
});

describe('what a unit cannot send', () => {
  it('is told in words: a macro, and an Xbox stick direction on a button', () => {
    expect(() => records(profile([pin({ tap: { kind: 'macro', trigger: 'F13' } })]))).toThrow(
      'L.index_1 tap: macros are typed by the app, not stored on a unit.',
    );
    expect(() => records(profile([pin({ long: { kind: 'pad', control: 'LS_UP' } })]))).toThrow(
      "L.index_1 long: Xbox LS_UP on a button was never captured, so it can't be sent.",
    );
  });

  it('is a pin with no input id, named with its control', () => {
    expect(() => records(profile([pin({ tap: key('A') }, { pin: 99 })]))).toThrow(
      'L.index_1: pin 99 has no input id.',
    );
  });

  it('is a device with no stick on the pins the app writes', () => {
    const noStick: AzeronDevice = {
      ...CYBORG2_LEFT,
      positions: CYBORG2_LEFT.positions.filter((p) => p.name !== 'stick'),
    };
    expect(() => records(profile([]), noStick)).toThrow(
      `${CYBORG2_LEFT.name} has no stick on the pins the app writes.`,
    );
  });
});

describe('a profile for the wrong unit', () => {
  it('is refused for another device id, naming both', () => {
    expect(() => records(profile([], {}, { deviceId: CYBORG2_RIGHT.id }))).toThrow(
      `This profile is for ${CYBORG2_RIGHT.id}, not ${CYBORG2_LEFT.id}.`,
    );
  });

  it('is refused for the same device id on the other hand', () => {
    expect(() => records(profile([], {}, { hand: 'right' }))).toThrow(
      `This profile is for ${CYBORG2_LEFT.id}, not ${CYBORG2_LEFT.id}.`,
    );
  });
});

describe('the stick', () => {
  it.each([
    [{ deadzone: 99, outerEdge: 100 }, [507, 0]],
    [{ deadzone: 0, outerEdge: 1 }, [0, 507]],
  ])('turns %j into the limits %j, at their extremes', (behaviour, limits) => {
    const r = stick(profile([], behaviour));
    expect([r?.tuning.lowerLimit, r?.tuning.upperLimit]).toEqual(limits);
  });

  it.each([-1, 100, 2.5])('refuses a deadzone of %s, in plain words', (deadzone) => {
    expect(() => stick(profile([], { deadzone }))).toThrow(
      `L.stick: the deadzone is 0 to 99 percent, not ${deadzone}.`,
    );
  });

  it.each([
    [0, 100],
    [101, -1],
  ])('refuses an outer edge of %s, which leaves %s percent', (outerEdge, percent) => {
    expect(() => stick(profile([], { outerEdge }))).toThrow(
      `L.stick: the outer edge is 0 to 99 percent, not ${percent}.`,
    );
  });

  it('names the right hand R in what it refuses', () => {
    const right = { deviceId: CYBORG2_RIGHT.id, hand: 'right' } as const;
    expect(() => stick(profile([], { deadzone: 100 }, right), CYBORG2_RIGHT)).toThrow(
      'R.stick: the deadzone is 0 to 99 percent, not 100.',
    );
  });

  it('refuses a deadzone and outer edge that leave no travel, at exactly all of it', () => {
    expect(() => stick(profile([], { deadzone: 50, outerEdge: 50 }))).toThrow(
      'L.stick: the deadzone and outer edge leave the stick no travel.',
    );
  });

  it('allows one point of travel less than all of it', () => {
    expect(stick(profile([], { deadzone: 50, outerEdge: 51 }))).toBeDefined();
  });

  it('refuses a sensitivity on a stick that does not move the mouse', () => {
    expect(() => stick(profile([], { mode: 'keys', sensitivity: 4 }))).toThrow(
      'L.stick: sensitivity is for a stick that moves the mouse.',
    );
  });

  it('refuses a direction that sends anything but a key', () => {
    const directions = { up: { kind: 'mouse', button: 'left' } } as const;
    expect(() => stick(profile([], { directions }))).toThrow(
      'L.stick up: a stick direction sends a key, nothing else.',
    );
  });

  it('holds two modifiers on a direction, and refuses three', () => {
    const two = { left: key('A', ['ctrl', 'shift']) };
    expect(stick(profile([], { directions: two }))?.directions['left.left']).toEqual([
      0xf004, 0xe001, 0xe002,
    ]);
    const three = { left: key('A', ['ctrl', 'shift', 'alt']) };
    expect(() => stick(profile([], { directions: three }))).toThrow(
      'L.stick left: a stick direction holds two modifiers at most.',
    );
  });
});

describe('the pins that get no record', () => {
  it('a pin the device says is wired to nothing is left alone', () => {
    const wired = records(profile([pin({ tap: key('A') }, { pin: 28 })]));
    expect(wired.map((r) => r.kind)).toEqual(['stick']);
  });

  it('the profile switch on pin 0 is left alone even when the device does not list it', () => {
    const device: AzeronDevice = { ...CYBORG2_LEFT, unknownPins: [28, 29] };
    const wired = records(profile([pin({ tap: key('A') }, { pin: 0 })]), device);
    expect(wired.map((r) => r.kind)).toEqual(['stick']);
  });
});
