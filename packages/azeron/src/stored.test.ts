import { describe, expect, it } from 'vitest';
import type { UnitReport } from './report';
import { Command, ProtocolError } from './report';
import { SlotStream, decodeStoredRecord } from './stored';

/** A stream report: `[a][b][c][a^b^c]` and the piece's bytes, item `part` of `parts`. */
const piece = (
  part: number,
  parts: number,
  head: [number, number, number],
  body: number[],
  command: number = Command.PROFILE_PAYLOAD_V2,
): UnitReport => {
  const [a, b, c] = head;
  const payload = Uint8Array.from([a, b, c, a ^ b ^ c, ...body]);
  return { length: payload.length, command, seq: 0, parts, part, payload };
};
const name = (part: number, parts: number, slot: number, text: string) =>
  piece(
    part,
    parts,
    [0, 0, 1],
    [0, 0x0c, slot, text.length + 1, ...Array.from(text, (ch) => ch.charCodeAt(0)), 0],
  );
const settings = (part: number, parts: number) =>
  piece(
    part,
    parts,
    [0, 1, 1],
    Array.from({ length: 32 }, (_, i) => i),
  );

/** A button record, stored: types, then 21 zero words, the delays and the hold byte. */
function button(id: number, pin: number, types: [number, number, number]) {
  const page0 = [
    2,
    id,
    pin,
    255,
    ...types,
    ...Array.from({ length: 42 }, () => 0),
    0xf4,
    0x01,
    0x96,
    0x00,
  ];
  const page1 = [0b101, 0xd2, 0x04, 1, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return { page0, page1 };
}

describe('a slot stream', () => {
  it('reads a name, settings and a record over two pages, and ends on the last item', () => {
    const r = button(4, 5, [1, 11, 11]);
    const stream = new SlotStream();
    expect(stream.push(name(0, 2, 3, 'Mine '))).toBe(false);
    expect(stream.push(settings(1, 2))).toBe(false);
    expect(stream.push(piece(2, 2, [4, 2, 0], r.page0))).toBe(false);
    expect(stream.push(piece(2, 2, [4, 2, 1], r.page1))).toBe(true);
    const [slot] = stream.slots();
    expect(slot).toMatchObject({ slot: 3, name: 'Mine' });
    expect(slot?.settings).toHaveLength(32);
    expect(slot?.records).toEqual([
      expect.objectContaining({
        kind: 'button',
        id: 4,
        pinOne: 5,
        longDelay: 500,
        doubleDelay: 150,
        tap: expect.objectContaining({
          typeByte: 1,
          hold: true,
          holdTime: 1234,
          turbo: true,
          turboInterval: 40,
        }),
        long: expect.objectContaining({ hold: false }),
        double: expect.objectContaining({ hold: true }),
      }),
    ]);
  });

  it('ends on a slot with no records, rather than wait for one forever', () => {
    const stream = new SlotStream();
    stream.push(name(0, 1, 0, 'Empty'));
    expect(stream.push(settings(1, 1))).toBe(true);
    expect(stream.slots()).toEqual([expect.objectContaining({ name: 'Empty', records: [] })]);
  });

  it('passes over reports nobody asked for', () => {
    const stream = new SlotStream();
    expect(stream.push(piece(0, 0, [0, 0, 1], [], Command.BUTTON_POSITION))).toBe(false);
    stream.push(name(0, 1, 0, 'A'));
    expect(stream.push(settings(1, 1))).toBe(true);
  });

  it('refuses a piece that fails its check, or a record before any name', () => {
    const bad: UnitReport = { ...name(0, 1, 0, 'A'), payload: Uint8Array.from([0, 0, 1, 0]) };
    expect(() => new SlotStream().push(bad)).toThrow(ProtocolError);
    expect(() => new SlotStream().push(piece(0, 1, [4, 2, 0], []))).toThrow(ProtocolError);
  });

  it('reads on past a record it can’t decode, to the records and slots after it', () => {
    const macro = {
      page0: [2, 4, 5, 255, 16, 11, 11, ...Array.from({ length: 46 }, () => 9)],
      page1: [9, 9, 9],
    };
    const key = button(6, 9, [1, 11, 11]);
    const stream = new SlotStream();
    const items = 7;
    stream.push(name(0, items, 0, 'One'));
    stream.push(settings(1, items));
    stream.push(piece(2, items, [4, 2, 0], macro.page0));
    stream.push(piece(2, items, [4, 2, 1], macro.page1));
    stream.push(piece(3, items, [6, 2, 0], key.page0));
    stream.push(piece(3, items, [6, 2, 1], key.page1));
    stream.push(name(4, items, 1, 'Two'));
    stream.push(settings(5, items));
    stream.push(piece(6, items, [6, 2, 0], key.page0));
    expect(stream.push(piece(7, items, [6, 2, 1], key.page1))).toBe(true);
    const [one, two] = stream.slots();
    expect(one?.records.map((r) => [r.id, r.kind])).toEqual([
      [4, 'undecoded'],
      [6, 'button'],
    ]);
    expect(two?.records.map((r) => [r.id, r.kind])).toEqual([[6, 'button']]);
  });

  it('has no slots to give before it ends', () => {
    const stream = new SlotStream();
    stream.push(name(0, 2, 0, 'A'));
    expect(() => stream.slots()).toThrow(ProtocolError);
  });
});

describe('a stored record', () => {
  it('of a type whose layout isn’t known is kept whole, never misread', () => {
    // 16 is a macro, which the app runs itself and stores as nothing anyone has decoded.
    const raw = Uint8Array.from([2, 9, 14, 255, 16, 11, 11, 1, 0, 0x96, 0]);
    expect(decodeStoredRecord(raw)).toEqual({
      kind: 'undecoded',
      id: 9,
      pinOne: 14,
      pinTwo: 255,
      typeBytes: [16, 11, 11],
      raw,
    });
  });

  it('that scrolls reads its direction and intervals where a key’s codes would be', () => {
    const tail = Array.from({ length: 28 }, () => 0);
    const raw = Uint8Array.from([
      2,
      4,
      5,
      255,
      0x23,
      6,
      6,
      0,
      0xff,
      0x96,
      0,
      0x2d,
      0,
      ...tail,
      0xf4,
      1,
      0xc8,
      0,
      ...Array.from({ length: 15 }, () => 0),
    ]);
    const record = decodeStoredRecord(raw);
    expect(record).toMatchObject({
      kind: 'button',
      tap: {
        typeByte: 0x23,
        keys: [],
        mods: [],
        wheel: { x: 0, y: -1, interval: 150, yInterval: 45 },
      },
      long: { typeByte: 6 },
      longDelay: 500,
      doubleDelay: 200,
    });
  });

  it('that ends early is refused', () => {
    const { page0 } = button(4, 5, [1, 11, 11]);
    expect(() => decodeStoredRecord(Uint8Array.from(page0))).toThrow(ProtocolError);
  });
});
