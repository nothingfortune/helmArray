// The edges of the report, record, read-back and verify layers: what a person is told when a
// value is refused, and each boundary exactly at its limit. Found by mutation testing: these are
// the changes no other test noticed.
import { describe, expect, it } from 'vitest';
import { storedFromWritten } from './fake';
import type { Block, ButtonRecord, StickRecord } from './records';
import { encodeRecord, profileNamePayload } from './records';
import type { UnitReport } from './report';
import {
  Command,
  REPORT_LENGTH,
  commandName,
  fromHex,
  hostReports,
  parseHostReport,
  parseUnitReport,
} from './report';
import type { StoredButton, StoredRecord, StoredStick } from './stored';
import { SlotStream, decodeStoredRecord } from './stored';
import { verify } from './verify';

describe('the report layer says why it refuses', () => {
  it.each([
    [255, 'Sequence 255 is not one the app sends.'],
    [-1, 'Sequence -1 is not one the app sends.'],
    [1.5, 'Sequence 1.5 is not one the app sends.'],
  ])('a host report with sequence %s', (seq, message) => {
    expect(() => hostReports('HARDWARE_PROFILE_INDEX', seq, new Uint8Array())).toThrow(message);
  });

  it('a payload past one length byte', () => {
    expect(() => hostReports('OBM_COPY', 0, new Uint8Array(256))).toThrow(
      'A 256-byte payload is longer than any the app sent.',
    );
  });

  it('a unit report of the wrong size', () => {
    expect(() => parseUnitReport(new Uint8Array(63))).toThrow('A unit report is 64 bytes, not 63.');
  });

  it('a unit report that claims more bytes than it holds', () => {
    const report = new Uint8Array(REPORT_LENGTH);
    report[6] = 58;
    expect(() => parseUnitReport(report)).toThrow("A unit report claims 58 bytes it doesn't have.");
  });

  it('a host report of the wrong size, or one that does not start with report id 0', () => {
    expect(() => parseHostReport(new Uint8Array(63))).toThrow('Not a host report.');
    const notZero = new Uint8Array(REPORT_LENGTH);
    notZero[0] = 1;
    expect(() => parseHostReport(notZero)).toThrow('Not a host report.');
  });
});

describe('hex', () => {
  it('reads nothing from an empty or blank string', () => {
    expect([fromHex(''), fromHex('  \n')]).toEqual([new Uint8Array(), new Uint8Array()]);
  });

  it('names a command it does not know by its byte, two digits wide', () => {
    expect(commandName(0x07)).toBe('0x07');
  });
});

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
  id: 7,
  pinOne: 2,
  pinTwo: 255,
  tap: { ...none, type: 'key', keys: [0xf014] },
  long: none,
  double: none,
  longDelay: 500,
  doubleDelay: 150,
  ...over,
});
const wheel = (over: Partial<Extract<ButtonRecord['tap'], { type: 'wheel' }>>) =>
  button({ tap: { type: 'wheel', x: 0, y: 0, interval: 150, yInterval: 150, ...over } });
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
const tuned = (over: Partial<StickRecord['tuning']>): StickRecord => ({
  ...stick,
  tuning: { ...stick.tuning, ...over },
});

describe('a record that cannot be encoded says which field and why', () => {
  it.each<[string, () => unknown, string]>([
    ['the slot', () => encodeRecord(256, button()), 'input 7: slot is 256'],
    ['the id', () => encodeRecord(1, button({ id: 256 })), 'input 256: id is 256'],
    ['a scroll x', () => encodeRecord(1, wheel({ x: 200 })), 'input 7: scroll x is 200'],
    ['a scroll y', () => encodeRecord(1, wheel({ y: -200 })), 'input 7: scroll y is -200'],
    [
      'a scroll interval',
      () => encodeRecord(1, wheel({ interval: 70000 })),
      'input 7: scroll interval is 70000',
    ],
    [
      'a scroll y interval',
      () => encodeRecord(1, wheel({ yInterval: -1 })),
      'input 7: scroll y interval is -1',
    ],
    [
      'a whole number of turbo steps',
      () => encodeRecord(1, button({ tap: { ...none, turboInterval: 1.5 } })),
      'input 7: tap turbo interval is 1.5',
    ],
    [
      'a negative turbo interval',
      () => encodeRecord(1, button({ tap: { ...none, turboInterval: -1 } })),
      'input 7: tap turbo interval is -1',
    ],
    [
      'a long press delay',
      () => encodeRecord(1, button({ longDelay: 70000 })),
      'input 7: long press delay is 70000',
    ],
    [
      'a double tap delay',
      () => encodeRecord(1, button({ doubleDelay: 70000 })),
      'input 7: double tap delay is 70000',
    ],
    [
      'an upper limit',
      () => encodeRecord(1, tuned({ upperLimit: 70000 })),
      'stick 24: upper limit is 70000',
    ],
    [
      'a lower limit',
      () => encodeRecord(1, tuned({ lowerLimit: 70000 })),
      'stick 24: lower limit is 70000',
    ],
    ['an angle', () => encodeRecord(1, tuned({ angle: 40000 })), 'stick 24: angle is 40000'],
    [
      'a combined magnitude',
      () => encodeRecord(1, tuned({ combinedAnalogMagnitude: 256 })),
      'stick 24: combined magnitude is 256',
    ],
    [
      'a hold magnitude',
      () => encodeRecord(1, tuned({ holdMagnitude: 256 })),
      'stick 24: hold magnitude is 256',
    ],
    ['a hold type', () => encodeRecord(1, tuned({ holdType: 256 })), 'stick 24: hold type is 256'],
  ])('%s', (_, encode, message) => {
    expect(encode).toThrow(`${message}, which doesn't fit.`);
  });

  it.each<[string, () => unknown, string]>([
    [
      'tap keys',
      () => encodeRecord(1, button({ tap: { ...none, keys: [1, 2, 3, 4, 5] } })),
      'input 7: tap keys has 5 entries; it holds 4.',
    ],
    [
      'tap modifiers',
      () => encodeRecord(1, button({ tap: { ...none, mods: [1, 2, 3, 4] } })),
      'input 7: tap modifiers has 4 entries; it holds 3.',
    ],
    [
      'long press keys',
      () => encodeRecord(1, button({ long: { ...none, keys: [1, 2, 3, 4, 5] } })),
      'input 7: long press keys has 5 entries; it holds 4.',
    ],
    [
      'double tap keys',
      () => encodeRecord(1, button({ double: { ...none, keys: [1, 2, 3, 4, 5] } })),
      'input 7: double tap keys has 5 entries; it holds 4.',
    ],
  ])('a list too long: %s', (_, encode, message) => {
    expect(encode).toThrow(message);
  });
});

describe('a profile name that cannot be sent says why', () => {
  it.each([-1, 256, 1.5])('slot %s', (slot) => {
    expect(() => profileNamePayload(slot, 'Skiff')).toThrow(`Slot ${slot} is not one a unit has.`);
  });

  it.each(['', 'x'.repeat(20)])('the name %j', (name) => {
    expect(() => profileNamePayload(0, name)).toThrow('A unit keeps a name of 1 to 19 characters.');
  });

  it.each(['tab\there', 'del\x7f', 'é'])('the name %j', (name) => {
    expect(() => profileNamePayload(0, name)).toThrow(
      'A unit keeps only plain letters, digits and punctuation in a name.',
    );
  });
});

/** A report from the unit, as the stream sees it: `[a][b][c][check]` then the body. */
const piece = (part: number, parts: number, [a, b, c]: number[], body: number[]): UnitReport => {
  const payload = Uint8Array.from([
    a ?? 0,
    b ?? 0,
    c ?? 0,
    (a ?? 0) ^ (b ?? 0) ^ (c ?? 0),
    ...body,
  ]);
  return {
    length: payload.length,
    command: Command.PROFILE_PAYLOAD_V2,
    seq: 0,
    parts,
    part,
    payload,
  };
};
const name = (part: number, parts: number, slot: number, text: string) =>
  piece(
    part,
    parts,
    [0, 0, 1],
    [0, 0x0c, slot, text.length + 1, ...Array.from(text, (ch) => ch.charCodeAt(0)), 0],
  );
/** A record page that no layout is known for: it is kept as its bytes. */
const unknown = (id: number, pin: number) => [2, id, pin, 255, 99, 99, 99];

describe('reading a slot stream back', () => {
  it('refuses a piece with no check byte, which is not the same as a check of 1', () => {
    expect(() =>
      new SlotStream().push({ ...name(0, 0, 0, 'A'), payload: Uint8Array.of(0, 0, 1) }),
    ).toThrow('A slot piece failed its check: 0 0 1 -1.');
  });

  it('names the four bytes of a piece that failed its check', () => {
    const bad = { ...name(0, 0, 0, 'A'), payload: Uint8Array.of(0, 0, 1, 5) };
    expect(() => new SlotStream().push(bad)).toThrow('A slot piece failed its check: 0 0 1 5.');
  });

  it('refuses a stream that begins with something other than a name', () => {
    expect(() => new SlotStream().push(piece(0, 0, [0, 0, 0], []))).toThrow(
      'A slot stream began without a name.',
    );
  });

  it('refuses settings cut short', () => {
    const stream = new SlotStream();
    stream.push(name(0, 2, 0, 'A'));
    expect(() => stream.push(piece(1, 2, [0, 1, 1], [1, 2, 3]))).toThrow(
      'A slot’s settings were cut short.',
    );
  });

  it('refuses to hand back slots before the stream has ended', () => {
    expect(() => new SlotStream().slots()).toThrow('The slot stream has not ended.');
  });

  it('keeps a record whose first or second page never came as the bytes it has', () => {
    const stream = new SlotStream();
    stream.push(name(0, 2, 0, 'A'));
    stream.push(piece(1, 2, [5, 2, 0], unknown(5, 6)));
    stream.push(piece(2, 2, [6, 2, 1], unknown(6, 7)));
    expect(stream.slots()[0]?.records).toEqual([
      {
        kind: 'undecoded',
        id: 5,
        pinOne: 6,
        pinTwo: 255,
        typeBytes: [99, 99, 99],
        raw: Uint8Array.from(unknown(5, 6)),
      },
      {
        kind: 'undecoded',
        id: 6,
        pinOne: 7,
        pinTwo: 255,
        typeBytes: [99, 99, 99],
        raw: Uint8Array.from(unknown(6, 7)),
      },
    ]);
  });

  it('says a stored record ended early', () => {
    expect(() => decodeStoredRecord(new Uint8Array(2))).toThrow('A stored record ended early.');
  });

  it('reads a scroll direction stored as 0x80 as -128, and 0x7f as 127', () => {
    const written = wheel({ x: -128, y: 127 });
    const held = decodeStoredRecord(storedFromWritten(encodeRecord(1, written))) as StoredButton;
    expect(held.tap.wheel).toEqual({ x: -128, y: 127, interval: 150, yInterval: 150 });
  });
});

const held = (record: ButtonRecord): StoredButton =>
  decodeStoredRecord(storedFromWritten(encodeRecord(1, record))) as StoredButton;

describe('verifying a write says what differed', () => {
  it('a double tap delay that came back changed, with both values', () => {
    const stored = held(button());
    stored.doubleDelay = 200;
    expect(verify([button()], [stored]).differences).toEqual([
      { id: 7, what: 'double tap delay', meant: '150', stored: '200' },
    ]);
  });

  it('pins that came back moved, with both pairs', () => {
    const stored = held(button());
    stored.pinOne = 9;
    expect(verify([button()], [stored]).differences).toEqual([
      { id: 7, what: 'pins', meant: '[2,255]', stored: '[9,255]' },
    ]);
  });

  it('an input held in a layout it cannot read, as unreadable', () => {
    const raw = Uint8Array.of(2, 7, 2, 255, 99, 99, 99);
    const undecoded: StoredRecord = {
      kind: 'undecoded',
      id: 7,
      pinOne: 2,
      pinTwo: 255,
      typeBytes: [99, 99, 99],
      raw,
    };
    expect(verify([button()], [undecoded]).differences).toEqual([
      { id: 7, what: 'kind', meant: 'button', stored: 'unreadable' },
    ]);
  });

  it.each<[string, (s: StoredButton) => void, string]>([
    ['type', (s) => (s.tap.typeByte = 1), 'tap type'],
    ['hold', (s) => (s.tap.hold = true), 'tap hold'],
    ['turbo', (s) => (s.tap.turbo = true), 'tap turbo'],
  ])('a scroll whose %s came back changed', (_, change, what) => {
    const written = wheel({ y: 1 });
    const stored = held(written);
    change(stored);
    expect(verify([written], [stored]).differences.map((d) => d.what)).toEqual([what]);
  });
});

describe('more edges of what a record says', () => {
  it.each<[string, () => unknown, string]>([
    [
      'a hold time',
      () => encodeRecord(1, button({ tap: { ...none, holdTime: 70000 } })),
      'input 7: tap hold time is 70000',
    ],
    ['a button pin', () => encodeRecord(1, button({ pinOne: 256 })), 'input 7: pin is 256'],
    [
      'a button second pin',
      () => encodeRecord(1, button({ pinTwo: 256 })),
      'input 7: second pin is 256',
    ],
    ['a stick slot', () => encodeRecord(256, stick), 'stick 24: slot is 256'],
    ['a stick id', () => encodeRecord(1, { ...stick, id: 256 }), 'stick 256: id is 256'],
    ['a stick pin', () => encodeRecord(1, { ...stick, pinOne: 256 }), 'stick 24: pin is 256'],
    [
      'a stick second pin',
      () => encodeRecord(1, { ...stick, pinTwo: 256 }),
      'stick 24: second pin is 256',
    ],
    [
      'a stick sensitivity',
      () => encodeRecord(1, tuned({ sensitivity: 70000 })),
      'stick 24: sensitivity is 70000',
    ],
    [
      'a vertical cone',
      () => encodeRecord(1, tuned({ verticalCone: 256 })),
      'stick 24: vertical cone is 256',
    ],
    [
      'a horizontal cone',
      () => encodeRecord(1, tuned({ horizontalCone: 256 })),
      'stick 24: horizontal cone is 256',
    ],
    [
      'a mouse sensitivity',
      () => encodeRecord(1, tuned({ mouseSensitivity: 256 })),
      'stick 24: mouse sensitivity is 256',
    ],
    [
      'an analog throttle',
      () => encodeRecord(1, tuned({ analogThrottle: 256 })),
      'stick 24: analog throttle is 256',
    ],
    [
      'a trigger magnitude',
      () => encodeRecord(1, tuned({ triggerMagnitude: 256 })),
      'stick 24: trigger magnitude is 256',
    ],
  ])('%s that does not fit is named', (_, encode, message) => {
    expect(encode).toThrow(`${message}, which doesn't fit.`);
  });

  it('a name may use the first and last printable characters, and slot 255 is a slot', () => {
    expect(profileNamePayload(255, ' ~')).toEqual(Uint8Array.of(255, 2, 0x20, 0x7e));
  });
});

describe('telling a stored record from one it cannot read', () => {
  const page = (types: number[]) =>
    Uint8Array.from([2, 9, 4, 255, ...types, ...new Array(80).fill(0)]);

  it.each([[[1, 1, 99]], [[1, 99, 1]], [[99, 1, 1]]])('the types %j are not a button', (types) => {
    expect(decodeStoredRecord(page(types)).kind).toBe('undecoded');
  });

  it('three button types are a button', () => {
    expect(decodeStoredRecord(page([1, 1, 1])).kind).toBe('button');
  });
});

describe('the pieces of a slot stream, each told by its own three bytes', () => {
  const started = () => {
    const stream = new SlotStream();
    stream.push(name(0, 9, 0, 'A'));
    return stream;
  };

  it('a piece that only looks like a name is not one', () => {
    expect(() => new SlotStream().push(piece(0, 0, [5, 0, 1], []))).toThrow(
      'A slot stream began without a name.',
    );
  });

  it('a piece that only looks like settings is a record page', () => {
    expect(() => started().push(piece(1, 9, [3, 1, 0], [1, 2, 3]))).not.toThrow();
  });

  it('a record page of input 0 is not settings', () => {
    expect(() => started().push(piece(1, 9, [0, 2, 1], [1, 2, 3]))).not.toThrow();
  });

  it('settings one byte short are cut short', () => {
    const body = Array.from({ length: 31 }, (_, i) => i);
    expect(() => started().push(piece(1, 9, [0, 1, 1], body))).toThrow(
      'A slot’s settings were cut short.',
    );
  });

  it('only a second page ends a record, and so the stream', () => {
    const stream = started();
    expect(stream.push(piece(9, 9, [5, 3, 1], [1, 2, 3]))).toBe(false);
  });

  it('records come back in the order of their ids, whatever order they were sent in', () => {
    const stream = new SlotStream();
    stream.push(name(0, 3, 0, 'A'));
    stream.push(piece(1, 3, [10, 2, 0], unknown(10, 1)));
    stream.push(piece(2, 3, [2, 2, 0], unknown(2, 1)));
    stream.push(piece(3, 3, [7, 2, 1], unknown(7, 1)));
    expect(stream.slots()[0]?.records.map((r) => r.id)).toEqual([2, 7, 10]);
  });
});

describe('verifying a write names the press that differed', () => {
  const key = (over: Partial<Block> = {}): Block => ({
    ...none,
    type: 'key',
    keys: [0xf004],
    ...over,
  });
  const differing = (written: ButtonRecord, change: (s: StoredButton) => void) => {
    const stored = held(written);
    change(stored);
    return verify([written], [stored]).differences.map((d) => d.what);
  };

  it.each<[string, (s: StoredButton) => void, string]>([
    ['type', (s) => (s.tap.typeByte = 6), 'tap type'],
    ['modifiers', (s) => (s.tap.mods[0] = 0xe001), 'tap modifiers'],
    ['hold', (s) => (s.tap.hold = true), 'tap hold'],
    ['hold time', (s) => (s.tap.holdTime = 5), 'tap hold time'],
    ['turbo', (s) => (s.tap.turbo = true), 'tap turbo'],
    ['turbo interval', (s) => (s.tap.turboInterval = 5), 'tap turbo interval'],
    ['long press', (s) => (s.long.holdTime = 5), 'long press hold time'],
    ['double tap', (s) => (s.double.holdTime = 5), 'double tap hold time'],
  ])('the %s', (_, change, what) => {
    expect(differing(button({ tap: key(), long: key(), double: key() }), change)).toEqual([what]);
  });

  it('a second pin alone that came back moved', () => {
    const stored = held(button());
    stored.pinTwo = 3;
    expect(verify([button()], [stored]).differences).toEqual([
      { id: 7, what: 'pins', meant: '[2,255]', stored: '[2,3]' },
    ]);
  });
});

describe('every stick field is named when it differs', () => {
  const heldStick = (record: StickRecord) =>
    decodeStoredRecord(storedFromWritten(encodeRecord(1, record))) as StoredStick;
  const whatDiffers = (change: (s: StoredStick) => void) => {
    const stored = heldStick(stick);
    change(stored);
    return verify([stick], [stored]).differences.map((d) => d.what);
  };

  it.each<[string, (s: StoredStick) => void]>([
    ['stick upper limit', (s) => (s.upperLimit = 1)],
    ['stick sensitivity', (s) => (s.sensitivity = 1)],
    ['stick eight directions', (s) => (s.isEightDirectionalTrigger = true)],
    ['stick throttle', (s) => (s.analogThrottle = 1)],
    ['stick smoothing', (s) => (s.isAnalogSmoothing = true)],
    ['stick trigger magnitude', (s) => (s.triggerMagnitude = 1)],
    ['stick invert Y', (s) => (s.invertYAxis = true)],
    ['stick combined magnitude', (s) => (s.combinedAnalogMagnitude = 1)],
    ['stick hold magnitude', (s) => (s.holdMagnitude = 1)],
    ['stick hold type', (s) => (s.holdType = 2)],
    ['stick hold keys', (s) => (s.holdKeys = [1, 2, 3])],
    ['stick rotate button', (s) => (s.rotateStickButtonId = 1)],
    ['stick lock zone angle', (s) => (s.lockZoneAngle = 1)],
    ['stick lock zone size', (s) => (s.lockZoneSize = 1)],
  ])('%s', (what, change) => {
    expect(whatDiffers(change)).toEqual([what]);
  });

  it('a stick with combined analog, hold trigger and angle lock reads back as written', () => {
    const switches = tuned({ isCombinedAnalog: true, isHoldTrigger: true, isAngleLock: true });
    expect(verify([switches], [heldStick(switches)]).differences).toEqual([]);
  });

  it('an input the slot does not hold is said missing, with what was meant', () => {
    expect(verify([stick], []).differences).toEqual([
      { id: 24, what: 'input', meant: 'written', stored: 'missing' },
    ]);
  });

  it('reads an angle of -32768 and sets invert Y from its switch bit', () => {
    const read = heldStick(tuned({ angle: -32768, invertYAxis: true }));
    expect([read.angle, read.invertYAxis]).toEqual([-32768, true]);
  });
});

describe('more stick fields that cannot be encoded say which', () => {
  it.each<[string, () => unknown, string]>([
    [
      'hold keys',
      () => encodeRecord(1, tuned({ holdKeys: [1, 2, 3, 4] })),
      'stick 24: hold keys has 4 entries; it holds 3.',
    ],
    [
      'a rotate button',
      () => encodeRecord(1, tuned({ rotateStickButtonId: 256 })),
      "stick 24: rotate button is 256, which doesn't fit.",
    ],
    [
      'a lock zone angle',
      () => encodeRecord(1, tuned({ lockZoneAngle: 256 })),
      "stick 24: lock zone angle is 256, which doesn't fit.",
    ],
    [
      'a lock zone size',
      () => encodeRecord(1, tuned({ lockZoneSize: 256 })),
      "stick 24: lock zone size is 256, which doesn't fit.",
    ],
  ])('%s', (_, encode, message) => {
    expect(encode).toThrow(message);
  });
});
