// A plan's unit profile into records, against what the Azeron app wrote for the owner's own
// layouts: the input ids every slot holds, and the bytes of each input a plan can express.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { KeyCode, PinPlan, Signal, UnitProfile } from '@helmarray/core';
import { CYBORG2_LEFT, CYBORG2_RIGHT } from '@helmarray/core';
import {
  INPUT_ID_BY_PIN,
  UNIT_KEY_CODES,
  encodeRecord,
  fromHex,
  toHex,
  unitRecords,
} from '@helmarray/azeron';

const json = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(`../reference/${path}`, import.meta.url), 'utf8')) as T;

interface Input {
  id: number;
  pinOne: number;
  pinTwo: number;
  types: string[];
  keyValues: string[];
  metaValues: string[];
  keyValuesLong: string[];
  keyValuesDouble: string[];
  analogSettings?: Record<string, unknown>;
}

const inputs = (path: string, key: 'copies' | 'records' | 'decoded'): Input[] => {
  const doc = json<Record<string, unknown[]>>(path);
  if (key === 'decoded') return (doc[key] as { inputs: Input[] }[]).flatMap((p) => p.inputs);
  return (doc[key] as { input: Input }[]).map((c) => c.input);
};

const everyInput = [
  ...inputs('unit-protocol/write-slot3.json', 'copies'),
  ...inputs('unit-protocol/write-112.json', 'copies'),
  ...inputs('unit-protocol/onboard-112.json', 'records'),
  ...inputs('unit-protocol/read-all.json', 'decoded'),
  ...json<{ profiles: { inputs: Input[] }[] }>(
    'unit-exports/everspace2-akimbo-left.json',
  ).profiles.flatMap((p) => p.inputs),
  ...json<{ profiles: { inputs: Input[] }[] }>(
    'unit-exports/everspace2-akimbo-right.json',
  ).profiles.flatMap((p) => p.inputs),
];

describe('input ids', () => {
  it('are the ones every slot in reference/ holds, on both units', () => {
    const written = everyInput.filter((i) => i.pinOne !== 255 && i.pinOne !== 0);
    expect(written.length).toBeGreaterThan(200);
    for (const input of written) {
      if ([28, 29].includes(input.pinOne)) continue; // unknown pins: never written
      expect(INPUT_ID_BY_PIN.get(input.pinOne), `pin ${input.pinOne}`).toBe(input.id);
    }
  });

  it('cover every pin of both units but the unknown ones and the profile switch', () => {
    for (const unit of [CYBORG2_LEFT, CYBORG2_RIGHT]) {
      const pins = unit.positions.map((p) => p.pin).sort((a, b) => a - b);
      expect(pins.every((p) => INPUT_ID_BY_PIN.has(p))).toBe(true);
      expect([...INPUT_ID_BY_PIN.keys()].sort((a, b) => a - b)).toEqual(pins);
    }
  });
});

// The app's key names for the keys the owner's layout uses, in core's names.
const CORE_NAMES: Record<string, KeyCode> = {
  Escape: 'Esc',
  Tab: 'Tab',
  Equal: '=',
};
const coreKey = (name: string): KeyCode =>
  CORE_NAMES[name] ??
  ((name.startsWith('Key') || name.startsWith('Digit')
    ? name.replace(/^(Key|Digit)/, '')
    : name) as KeyCode);

describe("the owner's Everspace 2 layout (left unit, slot 4)", () => {
  const copies = json<{ copies: { slot: number; input: Input; frames: string[] }[] }>(
    'unit-protocol/write-112.json',
  ).copies;
  // What a plan can say: one key or a mouse button per press, no modifiers alone, and no
  // Disabled presses (2.0.3 writes an empty press as 6; helmArray writes it as 11, as 2.0.2 did).
  const expressible = copies.filter(
    ({ input }) =>
      input.pinTwo === 255 &&
      input.types.every((t) => t === '1' || t === '11' || (t === '15' && input.types[0] === t)) &&
      input.keyValues.some((k) => k !== '0'),
  );

  const signal = (type: string | undefined, keys: string[]): Signal | undefined => {
    const key = keys.find((k) => k !== '0');
    if (key === undefined) return undefined;
    if (type === '15')
      return { kind: 'mouse', button: key === '1' ? 'left' : key === '3' ? 'right' : 'middle' };
    return { kind: 'key', code: coreKey(key) };
  };

  const pins: PinPlan[] = CYBORG2_LEFT.positions
    .filter((p) => p.name !== 'stick')
    .map((p) => {
      const input = expressible.find((c) => c.input.pinOne === p.pin)?.input;
      const presses: PinPlan['presses'] = {};
      const tap = input && signal(input.types[0], input.keyValues);
      const long = input && signal(input.types[1], input.keyValuesLong);
      const double = input && signal(input.types[2], input.keyValuesDouble);
      if (tap) presses.tap = tap;
      if (long) presses.long = long;
      if (double) presses.double = double;
      return {
        control: `L.${p.name}`,
        position: p.name,
        pin: p.pin,
        presses,
        turbo: false,
        latch: false,
      };
    });
  const profile: UnitProfile = {
    deviceId: CYBORG2_LEFT.id,
    hand: 'left',
    pins,
    stick: { mode: 'keys', angle: 0, invertX: false },
  };
  const records = unitRecords(profile, CYBORG2_LEFT);

  it('is a good sample: 23 of its 31 inputs, a mouse button and long and double presses among them', () => {
    expect(expressible).toHaveLength(23);
    expect(expressible.some((c) => c.input.types[0] === '15')).toBe(true);
    expect(expressible.some((c) => c.input.keyValuesLong.some((k) => k !== '0'))).toBe(true);
    expect(expressible.some((c) => c.input.keyValuesDouble.some((k) => k !== '0'))).toBe(true);
  });

  it('comes out byte for byte as the app wrote each of those inputs', () => {
    for (const { slot, input, frames } of expressible) {
      const record = records.find((r) => r.id === input.id);
      const sent = frames.map(fromHex).flatMap((f) => [...f.slice(7, 7 + (f[6] ?? 0))]);
      expect(record && toHex(encodeRecord(slot, record)), `input ${input.id}`).toBe(
        toHex(Uint8Array.from(sent)),
      );
    }
  });

  it('writes one record per input, in id order, and none for the unknown pins', () => {
    expect(records.map((r) => r.id)).toEqual([...INPUT_ID_BY_PIN.values()].sort((a, b) => a - b));
    expect(records.some((r) => [28, 29, 0].includes(r.pinOne))).toBe(false);
  });
});

describe('the stick', () => {
  const pins: PinPlan[] = [];
  const left = (stick: UnitProfile['stick']): UnitProfile => ({
    deviceId: CYBORG2_LEFT.id,
    hand: 'left',
    pins,
    stick,
  });

  it("as the left unit's Xbox stick, tunes as the app wrote it", () => {
    const sent = json<{ records: { capture: string; slot: number; input: Input; wire: string }[] }>(
      'unit-protocol/onboard-112.json',
    ).records.find((r) => r.capture === 'xinput' && r.input.pinTwo === 30);
    const stick = unitRecords(
      left({ mode: 'pad-left', angle: 0, invertX: false }),
      CYBORG2_LEFT,
    ).find((r) => r.kind === 'stick');
    // The directions after byte 38 are keys the template left behind; an Xbox stick ignores them.
    expect(stick && toHex(encodeRecord(sent?.slot ?? 0, stick)).slice(0, 76)).toBe(
      sent?.wire.slice(0, 76),
    );
  });

  it('as a mouse, tunes as the app wrote the owner’s “super sensitive” stick', () => {
    const sent = json<{ records: { capture: string; slot: number; input: Input; wire: string }[] }>(
      'unit-protocol/onboard-112.json',
    ).records.find((r) => r.capture === 'joystick-mouse' && r.input.pinTwo === 30);
    const stick = unitRecords(
      left({ mode: 'mouse', sensitivity: 2, angle: 5, invertX: false }),
      CYBORG2_LEFT,
    ).find((r) => r.kind === 'stick');
    // Header and tuning: the directions after byte 38 are keys the template left behind.
    expect(stick && toHex(encodeRecord(sent?.slot ?? 0, stick)).slice(0, 76)).toBe(
      sent?.wire.slice(0, 76),
    );
  });
});

describe('the key table', () => {
  it('gives every key the unit code of its HID usage', () => {
    expect(UNIT_KEY_CODES.A).toBe(0xf004);
    expect(UNIT_KEY_CODES.Z).toBe(0xf01d);
    expect(UNIT_KEY_CODES['1']).toBe(0xf01e);
    expect(UNIT_KEY_CODES['0']).toBe(0xf027);
    expect(UNIT_KEY_CODES.F12).toBe(0xf045);
    expect(UNIT_KEY_CODES.F13).toBe(0xf068);
    expect(UNIT_KEY_CODES.Insert).toBe(0xf049);
    expect(UNIT_KEY_CODES.LShift).toBe(0xe002);
    expect(new Set(Object.values(UNIT_KEY_CODES)).size).toBe(Object.keys(UNIT_KEY_CODES).length);
  });
});
