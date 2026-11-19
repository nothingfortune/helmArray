// The record encoder against every OBM_COPY the Azeron app was recorded sending. The fixtures
// hold the app's own export of each input and the bytes it sent for it; the adapter below
// turns the export into records (it is test code: helmArray builds records from its plans).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Block, BlockType, StickDirection, StickType, UnitRecord } from '@helmarray/azeron';
import {
  ProtocolError,
  STICK_DIRECTIONS,
  encodeRecord,
  fromHex,
  hostReports,
  profileNamePayload,
  toHex,
} from '@helmarray/azeron';

const json = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(`../reference/${path}`, import.meta.url), 'utf8')) as T;

// The unit's key codes by the app's key names: 0xF000 | HID usage, 0xE000 | modifier bit,
// 0xE4xx for media keys (reference/guides/unit-protocol.md).
const CODES: Record<string, number> = {
  ControlLeft: 0xe001,
  ShiftLeft: 0xe002,
  AltLeft: 0xe004,
  MetaLeft: 0xe008,
  ControlRight: 0xe010,
  ShiftRight: 0xe020,
  AltRight: 0xe040,
  MetaRight: 0xe080,
  AudioVolumeUp: 0xe4e9,
  Enter: 0xf028,
  Escape: 0xf029,
  Backspace: 0xf02a,
  Tab: 0xf02b,
  Space: 0xf02c,
  Minus: 0xf02d,
  Equal: 0xf02e,
  ArrowRight: 0xf04f,
  ArrowLeft: 0xf050,
  ArrowDown: 0xf051,
  ArrowUp: 0xf052,
};
for (let i = 0; i < 26; i++) CODES[`Key${String.fromCharCode(65 + i)}`] = 0xf004 + i;
for (let i = 1; i <= 9; i++) CODES[`Digit${i}`] = 0xf01d + i;
CODES['Digit0'] = 0xf027;
for (let i = 1; i <= 12; i++) CODES[`F${i}`] = 0xf039 + i;
for (let i = 13; i <= 24; i++) CODES[`F${i}`] = 0xf068 + i - 13;
// Older exports hold JavaScript key codes.
const JS_KEYS: Record<string, string> = {
  '16': 'ShiftLeft',
  '37': 'ArrowLeft',
  '38': 'ArrowUp',
  '39': 'ArrowRight',
  '40': 'ArrowDown',
  '65': 'KeyA',
  '68': 'KeyD',
  '83': 'KeyS',
  '87': 'KeyW',
};

type Token = string | number;
const code = (token: Token): number => {
  const text = String(token);
  if (text === '0') return 0;
  const found = CODES[JS_KEYS[text] ?? text];
  if (found === undefined) throw new Error(`no code for ${text}`);
  return found;
};

interface Export {
  id: number;
  pinOne: number;
  pinTwo: number;
  types: string[];
  [field: string]: unknown;
}

const BLOCKS: Record<string, BlockType> = {
  '1': 'key',
  '6': 'disabled',
  '11': 'none',
  '15': 'mouse',
  '22': 'pad',
  '23': 'trigger',
};
const STICKS: Record<string, StickType> = { '4': 'keys', '21': 'pad', '40': 'mouse' };

function trigger(type: string, token: Token): number {
  if (type === '15' || type === '22') return Number(token);
  if (type === '23') return token === 'T1' ? 1 : token === 'T2' ? 2 : 0;
  return code(token);
}

function blockOf(input: Export, index: number, suffix: '' | 'Long' | 'Double'): Block {
  const type = input.types[index] ?? '11';
  const kind = BLOCKS[type];
  if (!kind) throw new Error(`type ${type}`);
  const field = <T>(name: string, fallback: T) => (input[`${name}${suffix}`] as T) ?? fallback;
  return {
    type: kind,
    keys: field<Token[]>('keyValues', []).map((t) => trigger(type, t)),
    mods: field<Token[]>('metaValues', []).map(code),
    hold: field('isHold', false),
    holdTime: field('holdTime', 0),
    turbo: field('isTurbo', false),
    turboInterval: field('turboInterval', 0),
  };
}

function holdKey(token: Token): number {
  const text = String(token);
  if (text === '16') return CODES['ShiftLeft'] ?? 0;
  return CODES[text] ?? Number(text);
}

function adapt(input: Export): UnitRecord {
  const stick = STICKS[input.types[0] ?? ''];
  if (stick) {
    const a = input['analogSettings'] as Record<string, unknown>;
    const n = (name: string, fallback: number) => (a[name] as number | undefined) ?? fallback;
    const b = (name: string) => a[name] === true;
    const cones = a['analogCones'] as { verticalCone: number; horizontalCone: number };
    const groups = { analogKeys: a['analogKeys'], diagonalKeys: a['diagonalKeys'] } as Record<
      string,
      Record<string, Record<string, Token[]>>
    >;
    const directions: Partial<Record<StickDirection, number[]>> = {};
    for (const d of STICK_DIRECTIONS) {
      const [side = '', way = ''] = d.split('.');
      const group = way.includes('_') ? 'diagonalKeys' : 'analogKeys';
      directions[d] = (groups[group]?.[side]?.[way] ?? []).map(code);
    }
    return {
      kind: 'stick',
      id: input.id,
      pinOne: input.pinOne,
      pinTwo: input.pinTwo,
      mode: stick,
      tuning: {
        upperLimit: n('upperLimit', 0),
        lowerLimit: n('lowerLimit', 0),
        angle: n('angle', 0),
        sensitivity: n('sensitivity', 0),
        verticalCone: cones.verticalCone,
        horizontalCone: cones.horizontalCone,
        isEightDirectionalTrigger: b('isEightDirectionalTrigger'),
        mouseSensitivity: n('mouseSensitivity', 5),
        analogThrottle: n('analogThrottle', 0),
        isAnalogSmoothing: b('isAnalogSmoothing'),
        triggerMagnitude: n('triggerMagnitude', 4),
        isCombinedAnalog: b('isCombinedAnalog'),
        combinedAnalogMagnitude: n('combinedAnalogMagnitude', 6),
        isHoldTrigger: b('isHoldTrigger'),
        holdMagnitude: n('holdMagnitude', 9),
        holdType: Number(a['holdType'] ?? 1),
        holdKeys: (a['holdKeyValues'] as Token[]).map(holdKey),
        rotateStickButtonId: n('rotateStickButtonId', 0),
        isAngleLock: b('isAngleLock'),
        lockZoneAngle: n('lockZoneAngle', 70),
        lockZoneSize: n('lockZoneSize', 30),
        isRightAnalog: b('isRightAnalog'),
        invertXAxis: b('invertXAxis'),
        invertYAxis: b('invertYAxis'),
      },
      directions,
    };
  }
  const num = (name: string, fallback: number) => (input[name] as number | undefined) ?? fallback;
  return {
    kind: 'button',
    id: input.id,
    pinOne: input.pinOne,
    pinTwo: input.pinTwo,
    tap:
      input.types[0] === '35'
        ? {
            type: 'wheel',
            x: num('x', 0),
            y: num('y', 0),
            // The app sends an interval whole: 100.5 went as 100.
            interval: Math.trunc(num('interval', 150)),
            yInterval: Math.trunc(num('yInterval', 150)),
          }
        : blockOf(input, 0, ''),
    long: blockOf(input, 1, 'Long'),
    double: blockOf(input, 2, 'Double'),
    longDelay: num('featureDelay', 500),
    doubleDelay: num('doubleDelay', 150),
  };
}

interface Copy {
  slot: number;
  input: Export;
  frames: string[];
}

describe('every OBM_COPY the app sent', () => {
  const copies = [
    ...json<{ copies: Copy[] }>('unit-protocol/write-slot3.json').copies,
    ...json<{ copies: Copy[] }>('unit-protocol/write-112.json').copies,
  ];
  const records = json<{ records: { slot: number; input: Export; wire: string }[] }>(
    'unit-protocol/onboard-112.json',
  ).records;

  it('is a good sample: every block type and stick mode, scroll, and both units', () => {
    expect(copies.length + records.length).toBe(79);
    const all = [...copies.map((c) => c.input), ...records.map((r) => r.input)].map(adapt);
    const kinds = new Set(
      all.flatMap((r) =>
        r.kind === 'stick' ? [`stick:${r.mode}`] : [r.tap.type, r.long.type, r.double.type],
      ),
    );
    expect([...kinds].sort()).toEqual(
      [
        'disabled',
        'key',
        'mouse',
        'none',
        'pad',
        'stick:keys',
        'stick:mouse',
        'stick:pad',
        'trigger',
        'wheel',
      ].sort(),
    );
  });

  it('is rebuilt byte for byte, framed as the app framed it', () => {
    for (const copy of copies) {
      const seq = fromHex(copy.frames[0] ?? '')[3] ?? 0;
      const built = hostReports('OBM_COPY', seq, encodeRecord(copy.slot, adapt(copy.input)));
      expect(built.map(toHex), `input ${copy.input.id}`).toEqual(copy.frames);
    }
  });

  it('reproduces onboard-112.json, record by record', () => {
    for (const r of records) {
      expect(toHex(encodeRecord(r.slot, adapt(r.input))), `input ${r.input.id}`).toBe(r.wire);
    }
  });
});

describe('the profile name', () => {
  const sent = [
    json<{ profileName: string }>('unit-protocol/write-slot3.json').profileName,
    ...json<{ appCopyOverExistingSlot: { profileName: string[] } }>('unit-protocol/session2.json')
      .appCopyOverExistingSlot.profileName,
  ].map((hex) => {
    const bytes = fromHex(hex);
    const payload = bytes.slice(7, 7 + (bytes[6] ?? 0));
    return {
      hex,
      seq: bytes[3] ?? 0,
      slot: payload[0] ?? 0,
      name: String.fromCharCode(...payload.slice(2)),
    };
  });

  it('is rebuilt as the app sent it', () => {
    const fits = sent.filter((s) => s.name.length <= 19);
    expect(fits.length).toBeGreaterThan(0);
    for (const s of fits) {
      expect(
        hostReports('PROFILE_NAME', s.seq, profileNamePayload(s.slot, s.name)).map(toHex),
      ).toEqual([s.hex]);
    }
  });

  it('is refused past 19 characters, though the app sent one: the unit keeps only 19', () => {
    // "Everspace 2 akimbo v10 (right)" went out whole and was stored cut short, so reading
    // the slot back would never match what was written.
    const long = sent.filter((s) => s.name.length > 19);
    expect(long.map((s) => s.name)).toEqual(['Everspace 2 akimbo v10 (right)']);
    expect(() => profileNamePayload(long[0]?.slot ?? 0, long[0]?.name ?? '')).toThrow(
      ProtocolError,
    );
  });

  it('refuses one a unit can’t keep', () => {
    expect(() => profileNamePayload(1, '')).toThrow(ProtocolError);
    expect(() => profileNamePayload(1, 'x'.repeat(20))).toThrow(ProtocolError);
    expect(() => profileNamePayload(1, 'Café')).toThrow(ProtocolError);
    expect(profileNamePayload(1, 'x'.repeat(19))).toHaveLength(21);
  });
});
