// Reading slots back: PROFILE_PAYLOAD_V2 streams every slot as pieces (reference/guides/
// unit-protocol.md, "A slot, as read"). Stored values are little-endian; a record is two pages.
// Each field was told apart by the Azeron app's own decoding of the same reports
// (test/unit-read.test.ts).

import type { UnitReport } from './report';
import { Command, ProtocolError } from './report';
import { STICK_DIRECTIONS } from './records';
import type { StickDirection } from './records';

/** One press as a unit stores it: its type byte as stored, and every field beside it. */
export interface StoredBlock {
  typeByte: number;
  keys: number[];
  mods: number[];
  /** A tap that scrolls (type 35) stores its direction and intervals where keys would be. */
  wheel?: { x: number; y: number; interval: number; yInterval: number };
  hold: boolean;
  holdTime: number;
  turbo: boolean;
  turboInterval: number;
}

export interface StoredButton {
  kind: 'button';
  id: number;
  pinOne: number;
  pinTwo: number;
  tap: StoredBlock;
  long: StoredBlock;
  double: StoredBlock;
  longDelay: number;
  doubleDelay: number;
}

export interface StoredStick {
  kind: 'stick';
  id: number;
  pinOne: number;
  pinTwo: number;
  typeByte: number;
  upperLimit: number;
  lowerLimit: number;
  angle: number;
  sensitivity: number;
  /** The two cone bytes as stored; the app reads them as vertical, then horizontal. */
  cones: [number, number];
  isEightDirectionalTrigger: boolean;
  directions: Record<StickDirection, number[]>;
  mouseSensitivity: number;
  analogThrottle: number;
  isAnalogSmoothing: boolean;
  triggerMagnitude: number;
  /**
   * The packed switches. 0x08 is invert X and 0x10 invert Y, as the app decodes them; combined,
   * hold trigger and angle lock are 0x07 in an order not yet known.
   */
  switches: number;
  invertXAxis: boolean;
  invertYAxis: boolean;
  combinedAnalogMagnitude: number;
  holdMagnitude: number;
  holdType: number;
  holdKeys: number[];
  rotateStickButtonId: number;
  lockZoneAngle: number;
  lockZoneSize: number;
  isRightAnalog: boolean;
}

/**
 * A record of a type whose stored layout isn't known (the types the app runs itself: macros,
 * sequences, layer switches).
 * Only its id, pins and types are read: reading on could misread it, or run off its end and stop
 * every slot after it from being read.
 */
export interface StoredUndecoded {
  kind: 'undecoded';
  id: number;
  pinOne: number;
  pinTwo: number;
  typeBytes: number[];
  raw: Uint8Array;
}

export type StoredRecord = StoredButton | StoredStick | StoredUndecoded;

export interface StoredSlot {
  slot: number;
  name: string;
  /** The slot's 32 bytes of settings, kept as read; null when the stream carried none. */
  settings: Uint8Array | null;
  records: StoredRecord[];
}

/** Types stored in the button layout: the ones helmArray writes, plus 0, 2 and the d-pad (12). */
const BUTTON_TYPES = new Set([0, 1, 2, 6, 11, 12, 15, 0x16, 0x17]);
const STICK_TYPES = new Set([4, 0x15, 0x28]);
/** A tap that scrolls. Stored like a button, its tap's keys and modifiers replaced by 6 bytes. */
const WHEEL_TYPE = 0x23;
const SETTINGS_LENGTH = 32;

class Reader {
  private at = 0;
  constructor(private readonly bytes: Uint8Array) {}
  u8(): number {
    const value = this.bytes[this.at++];
    if (value === undefined) throw new ProtocolError('A stored record ended early.');
    return value;
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  i8(): number {
    const value = this.u8();
    return value >= 0x80 ? value - 0x100 : value;
  }
  i16(): number {
    const value = this.u16();
    return value >= 0x8000 ? value - 0x10000 : value;
  }
  list(count: number): number[] {
    return Array.from({ length: count }, () => this.u16());
  }
}

function decodeButton(
  r: Reader,
  id: number,
  pinOne: number,
  pinTwo: number,
  types: number[],
): StoredButton {
  // Seen 2026-11-19 on both units: a scrolling tap stores x and y (signed bytes), then the two
  // intervals, where a key's tap stores its four keys and three modifiers.
  const presses = types.map(
    (typeByte, i): Omit<StoredBlock, 'hold' | 'holdTime' | 'turbo' | 'turboInterval'> =>
      i === 0 && typeByte === WHEEL_TYPE
        ? {
            typeByte,
            keys: [],
            mods: [],
            wheel: { x: r.i8(), y: r.i8(), interval: r.u16(), yInterval: r.u16() },
          }
        : { typeByte, keys: r.list(4), mods: r.list(3) },
  );
  const longDelay = r.u16();
  const doubleDelay = r.u16();
  const holds = r.u8();
  const [tap, long, double] = presses.map((p, i) => ({
    ...p,
    hold: (holds & (1 << i)) !== 0,
    holdTime: r.u16(),
    turbo: r.u8() === 1,
    turboInterval: r.u8(),
  }));
  if (!tap || !long || !double) throw new ProtocolError(`Input ${id} has no three presses.`);
  return { kind: 'button', id, pinOne, pinTwo, tap, long, double, longDelay, doubleDelay };
}

function decodeStick(
  r: Reader,
  id: number,
  pinOne: number,
  pinTwo: number,
  typeByte: number,
): StoredStick {
  const upperLimit = r.u16();
  const lowerLimit = r.u16();
  const angle = r.i16();
  const sensitivity = r.u16();
  const cones: [number, number] = [r.u8(), r.u8()];
  const isEightDirectionalTrigger = r.u8() === 1;
  const directions = Object.fromEntries(STICK_DIRECTIONS.map((d) => [d, r.list(3)])) as Record<
    StickDirection,
    number[]
  >;
  const mouseSensitivity = r.u8();
  const analogThrottle = r.u8();
  const isAnalogSmoothing = r.u8() === 1;
  const triggerMagnitude = r.u8();
  const switches = r.u8();
  return {
    kind: 'stick',
    id,
    pinOne,
    pinTwo,
    typeByte,
    upperLimit,
    lowerLimit,
    angle,
    sensitivity,
    cones,
    isEightDirectionalTrigger,
    directions,
    mouseSensitivity,
    analogThrottle,
    isAnalogSmoothing,
    triggerMagnitude,
    switches,
    invertXAxis: (switches & 0x08) !== 0,
    invertYAxis: (switches & 0x10) !== 0,
    combinedAnalogMagnitude: r.u8(),
    holdMagnitude: r.u8(),
    holdType: r.u8(),
    holdKeys: r.list(3),
    rotateStickButtonId: r.u8(),
    lockZoneAngle: r.u8(),
    lockZoneSize: r.u8(),
    isRightAnalog: r.u8() === 1,
  };
}

/** One record as a unit stores it: page 0, then page 1. */
export function decodeStoredRecord(record: Uint8Array): StoredRecord {
  const r = new Reader(record);
  r.u8(); // 2 in every record seen
  const id = r.u8();
  const pinOne = r.u8();
  const pinTwo = r.u8();
  const types = [r.u8(), r.u8(), r.u8()];
  const [first = 0] = types;
  if (STICK_TYPES.has(first)) return decodeStick(r, id, pinOne, pinTwo, first);
  const [, ...rest] = types;
  if ((BUTTON_TYPES.has(first) || first === WHEEL_TYPE) && rest.every((t) => BUTTON_TYPES.has(t))) {
    return decodeButton(r, id, pinOne, pinTwo, types);
  }
  return { kind: 'undecoded', id, pinOne, pinTwo, typeBytes: types, raw: record };
}

/**
 * Collects one PROFILE_PAYLOAD_V2 stream. Every report is a piece: a slot's name, its settings,
 * or part of a record's page. A piece starts `[a][b][c][a^b^c]`: a name is `0 0 1 1`, settings
 * `0 1 …`, a record `[id][2][page][check]`, and a page longer than one report continues in the
 * next behind the same four bytes. The report's `parts` byte is the index of the stream's last
 * item, and the stream ends with that item's last piece.
 */
export class SlotStream {
  private readonly done: StoredSlot[] = [];
  private current: {
    slot: number;
    name: string;
    settings: Uint8Array | null;
    pages: Map<string, number[]>;
  } | null = null;
  private finished = false;

  /** Feeds one report; reports of other commands are passed over. True once the stream ends. */
  push(report: UnitReport): boolean {
    if (report.command !== Command.PROFILE_PAYLOAD_V2 || this.finished) return this.finished;
    const p = report.payload;
    const [a = 0, b = 0, c = 0, check = -1] = p;
    if ((a ^ b ^ c) !== check) {
      throw new ProtocolError(`A slot piece failed its check: ${[a, b, c, check].join(' ')}.`);
    }
    const isName = a === 0 && b === 0 && c === 1;
    const isSettings = a === 0 && b === 1;
    if (isName) {
      this.close();
      const length = p[7] ?? 0;
      // The stored length counts a terminator; the app shows the name trimmed.
      const name = String.fromCharCode(...p.slice(8, 8 + Math.max(0, length - 1))).trimEnd();
      this.current = { slot: p[6] ?? 0, name, settings: null, pages: new Map() };
    } else if (!this.current) {
      throw new ProtocolError('A slot stream began without a name.');
    } else if (isSettings) {
      if (p.length - 4 < SETTINGS_LENGTH)
        throw new ProtocolError('A slot’s settings were cut short.');
      this.current.settings = p.slice(4, 4 + SETTINGS_LENGTH);
    } else {
      const key = `${a}:${c}`;
      this.current.pages.set(key, [...(this.current.pages.get(key) ?? []), ...p.subarray(4)]);
    }
    // A record ends with its second page, which always fits one report; a slot with no
    // records ends with its name or settings, and waiting for a record there would never end.
    const endsItem = isName || isSettings || (b === 2 && c === 1);
    if (report.part === report.parts && endsItem) {
      this.close();
      this.finished = true;
    }
    return this.finished;
  }

  /** Every slot the stream carried, in order. */
  slots(): StoredSlot[] {
    if (!this.finished) throw new ProtocolError('The slot stream has not ended.');
    return this.done;
  }

  private close() {
    if (!this.current) return;
    const ids = [...new Set([...this.current.pages.keys()].map((k) => Number(k.split(':')[0])))];
    const records = ids
      .sort((x, y) => x - y)
      .map((id) => {
        const page0 = this.current?.pages.get(`${id}:0`) ?? [];
        const page1 = this.current?.pages.get(`${id}:1`) ?? [];
        return decodeStoredRecord(Uint8Array.from([...page0, ...page1]));
      });
    this.done.push({
      slot: this.current.slot,
      name: this.current.name,
      settings: this.current.settings,
      records,
    });
    this.current = null;
  }
}
