// Reading slots back, against the Azeron app's own decoding of the same streams: every slot
// it read on connect (read-all) and the slot it had just written (read-slot3).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StoredSlot } from '@helmarray/azeron';
import { STICK_DIRECTIONS, SlotStream, fromHex, parseUnitReport } from '@helmarray/azeron';
import type { Export, Token } from './azeron-export';
import { code, holdKey, trigger } from './azeron-export';

const json = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(`../reference/${path}`, import.meta.url), 'utf8')) as T;

interface Decoded {
  id: string;
  name: string;
  inputs: (Export & Record<string, unknown>)[];
}

function read(frames: string[]): { slots: StoredSlot[]; endedAt: number } {
  const stream = new SlotStream();
  let endedAt = -1;
  frames.forEach((hex, i) => {
    if (stream.push(parseUnitReport(fromHex(hex))) && endedAt < 0) endedAt = i;
  });
  return { slots: stream.slots(), endedAt };
}

const PRESSES = [
  ['tap', ''],
  ['long', 'Long'],
  ['double', 'Double'],
] as const;

function expectSame(slot: StoredSlot, app: Decoded) {
  expect(slot.slot).toBe(Number(app.id));
  expect(slot.name).toBe(app.name);
  expect(slot.settings).toHaveLength(32);
  expect(slot.records.map((r) => r.id)).toEqual(app.inputs.map((i) => i.id).sort((a, b) => a - b));
  for (const input of app.inputs) {
    const stored = slot.records.find((r) => r.id === input.id);
    const where = `${app.name}, input ${input.id}`;
    expect(stored?.pinOne, where).toBe(input.pinOne);
    expect(stored?.pinTwo, where).toBe(input.pinTwo);
    if (stored?.kind === 'button') {
      PRESSES.forEach(([press, suffix], i) => {
        const type = input.types[i] ?? '';
        expect(stored[press], `${where} ${press}`).toEqual({
          typeByte: Number(type),
          keys: (input[`keyValues${suffix}`] as Token[]).map((t) => trigger(type, t)),
          mods: (input[`metaValues${suffix}`] as Token[]).map(code),
          hold: input[`isHold${suffix}`],
          holdTime: input[`holdTime${suffix}`],
          turbo: input[`isTurbo${suffix}`],
          turboInterval: input[`turboInterval${suffix}`],
        });
      });
      expect([stored.longDelay, stored.doubleDelay], where).toEqual([
        input['featureDelay'],
        input['doubleDelay'],
      ]);
    } else if (stored?.kind === 'stick') {
      const a = input['analogSettings'] as Record<string, unknown>;
      const cones = a['analogCones'] as { verticalCone: number; horizontalCone: number };
      expect(stored.typeByte, where).toBe(Number(input.types[0]));
      expect(stored, where).toMatchObject({
        upperLimit: a['upperLimit'],
        lowerLimit: a['lowerLimit'],
        angle: a['angle'],
        sensitivity: a['sensitivity'],
        cones: [cones.verticalCone, cones.horizontalCone],
        isEightDirectionalTrigger: a['isEightDirectionalTrigger'],
        mouseSensitivity: a['mouseSensitivity'],
        analogThrottle: a['analogThrottle'],
        isAnalogSmoothing: a['isAnalogSmoothing'],
        triggerMagnitude: a['triggerMagnitude'],
        invertXAxis: a['invertXAxis'],
        invertYAxis: a['invertYAxis'],
        combinedAnalogMagnitude: a['combinedAnalogMagnitude'],
        holdMagnitude: a['holdMagnitude'],
        holdType: Number(a['holdType']),
        holdKeys: (a['holdKeyValues'] as Token[]).map(holdKey),
        rotateStickButtonId: a['rotateStickButtonId'],
        lockZoneAngle: a['lockZoneAngle'],
        lockZoneSize: a['lockZoneSize'],
        isRightAnalog: a['isRightAnalog'],
      });
      // The three switches whose bits aren't known yet: as many set as the app shows.
      const set = ['isCombinedAnalog', 'isHoldTrigger', 'isAngleLock'].filter(
        (k) => a[k] === true,
      ).length;
      expect([0, 1, 2].filter((bit) => (stored.switches & (1 << bit)) !== 0).length, where).toBe(
        set,
      );
      const groups = { analogKeys: a['analogKeys'], diagonalKeys: a['diagonalKeys'] } as Record<
        string,
        Record<string, Record<string, Token[]>>
      >;
      for (const d of STICK_DIRECTIONS) {
        const [side = '', way = ''] = d.split('.');
        const group = way.includes('_') ? 'diagonalKeys' : 'analogKeys';
        expect(stored.directions[d], `${where} ${d}`).toEqual(
          (groups[group]?.[side]?.[way] ?? []).map(code),
        );
      }
    } else {
      throw new Error(`${where} was not decoded`);
    }
  }
}

describe('reading every slot on connect (read-all)', () => {
  const fixture = json<{ frames: string[]; decoded: Decoded[] }>('unit-protocol/read-all.json');
  const { slots, endedAt } = read(fixture.frames);

  it('ends with the stream’s last report, not before', () => {
    expect(endedAt).toBe(fixture.frames.length - 1);
  });

  it('reads each slot as the app did, field by field', () => {
    expect(slots).toHaveLength(fixture.decoded.length);
    slots.forEach((slot, i) => expectSame(slot, fixture.decoded[i] as Decoded));
  });
});

describe('reading the slot just written (read-slot3)', () => {
  const fixture = json<{ frames: string[]; decoded: Decoded[] }>('unit-protocol/read-slot3.json');

  it('reads every field of the all-fields test profile as the app did', () => {
    const { slots, endedAt } = read(fixture.frames);
    expect(endedAt).toBe(fixture.frames.length - 1);
    expect(slots).toHaveLength(1);
    expectSame(slots[0] as StoredSlot, fixture.decoded[0] as Decoded);
  });
});
