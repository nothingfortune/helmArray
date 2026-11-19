// The Azeron app's export format, turned into helmArray's records. Test code only: the
// fixtures in reference/ hold the app's own export of each input beside the bytes it sent or
// read, and this is how the tests line the two up. helmArray builds records from its plans.
import type { Block, BlockType, StickDirection, StickType, UnitRecord } from '@helmarray/azeron';
import { STICK_DIRECTIONS } from '@helmarray/azeron';

// The unit's key codes by the app's key names: 0xF000 | HID usage, 0xE000 | modifier bit,
// 0xE4xx for media keys (reference/guides/unit-protocol.md).
export const CODES: Record<string, number> = {
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
  Insert: 0xf049,
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

export type Token = string | number;
export const code = (token: Token): number => {
  const text = String(token);
  if (text === '0') return 0;
  const found = CODES[JS_KEYS[text] ?? text];
  if (found === undefined) throw new Error(`no code for ${text}`);
  return found;
};

export interface Export {
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

export function trigger(type: string, token: Token): number {
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

export function holdKey(token: Token): number {
  const text = String(token);
  if (text === '16') return CODES['ShiftLeft'] ?? 0;
  return CODES[text] ?? Number(text);
}

export function adapt(input: Export): UnitRecord {
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
