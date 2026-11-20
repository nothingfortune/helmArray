import { describe, expect, it } from 'vitest';
import { VdfError } from './kv';
import { parseVdfBinary } from './vdf-binary';

/** Bytes from a hand-written hex string, so no code under test helps lay them out. */
function hex(text: string): Uint8Array {
  const pairs = text.replace(/#.*$/gm, '').trim().split(/\s+/);
  return Uint8Array.from(pairs.map((pair) => parseInt(pair, 16)));
}

describe('parseVdfBinary: the layout, byte by byte', () => {
  // Every byte below is written out from the documented layout. Each value is followed by
  // another entry, so a value read one byte too long or too short derails the entries after it.
  const bytes = hex(`
    00 72 6f 6f 74 00                   # section "root"
      01 6e 61 6d 65 00 50 6f 72 74 61 6c 00     # string  name = "Portal"
      02 65 69 67 68 74 00 08 00 00 00           # int32   eight = 8 (its first byte looks like an end byte)
      02 6e 65 67 00 ff ff ff ff                 # int32   neg = -1 (signed)
      02 6c 65 00 04 03 02 01                    # int32   le = 0x01020304 (little-endian)
      07 62 69 67 00 00 00 00 00 01 00 00 00     # uint64  big = 2^32
      01 7a 00 00                                # string  z = "" (a lone 0 byte)
      02 6c 61 73 74 00 07 00 00 00              # int32   last = 7
      00 69 6e 00                                # section "in"
        01 6b 00 76 00                           # string  k = "v"
      08                                         # end of "in"
      01 61 66 74 65 72 00 79 00                 # string  after = "y"
    08                                  # end of "root"
    08                                  # end of the top level
  `);

  it('reads every type at its documented width', () => {
    expect(parseVdfBinary(bytes)).toEqual({
      root: {
        name: 'Portal',
        eight: 8,
        neg: -1,
        le: 0x01020304,
        big: 4294967296,
        z: '',
        last: 7,
        in: { k: 'v' },
        after: 'y',
      },
    });
  });

  it('reads an int32 as signed little-endian, not big-endian or unsigned', () => {
    const one = parseVdfBinary(hex('02 61 00 01 00 00 00 08'));
    expect(one).toEqual({ a: 1 });
    const minInt = parseVdfBinary(hex('02 61 00 00 00 00 80 08'));
    expect(minInt).toEqual({ a: -2147483648 });
  });

  it('reads a uint64 whole: the high half counts', () => {
    expect(parseVdfBinary(hex('07 61 00 ff ff ff ff 00 00 00 00 08'))).toEqual({ a: 4294967295 });
    expect(parseVdfBinary(hex('07 61 00 00 00 00 00 ff 00 00 00 08'))).toEqual({
      a: 0xff * 2 ** 32,
    });
  });

  it('returns a uint64 beyond 2^53 as a bigint, rounding nothing', () => {
    const parsed = parseVdfBinary(hex('07 61 00 ff ff ff ff ff ff ff ff 08'));
    expect(parsed['a']).toBe(18446744073709551615n);
  });

  it('keeps going after an int32 whose bytes include 0x08 and 0x00', () => {
    // If a reader skipped 3 bytes for an int32, 0x08 would end the section here.
    expect(parseVdfBinary(hex('02 61 00 08 08 08 08 01 62 00 63 00 08'))).toEqual({
      a: 0x08080808,
      b: 'c',
    });
  });

  it('reads UTF-8 in keys and strings: multi-byte characters stay whole', () => {
    // "Caf" + e-acute (c3 a9), then TM (e2 84 a2), then a four-byte game controller (f0 9f 8e ae).
    const parsed = parseVdfBinary(
      hex('01 6e 00 43 61 66 c3 a9 e2 84 a2 f0 9f 8e ae 00 01 c3 a9 00 78 00 08'),
    );
    expect(parsed).toEqual({ n: 'Café™\u{1F3AE}', é: 'x' });
  });

  it('turns invalid UTF-8 into replacement characters instead of failing', () => {
    expect(parseVdfBinary(hex('01 6e 00 61 ff 62 c3 00 08'))).toEqual({ n: 'a�b�' });
  });

  it('accepts a file without the closing end bytes (read to the end)', () => {
    expect(parseVdfBinary(hex('01 61 00 62 00'))).toEqual({ a: 'b' });
    expect(parseVdfBinary(new Uint8Array())).toEqual({});
  });

  it('reads from a view into a larger buffer, not from the start of it', () => {
    const body = hex('02 61 00 05 00 00 00 08');
    const padded = new Uint8Array(body.length + 6);
    padded.set(body, 3);
    expect(parseVdfBinary(padded.subarray(3, 3 + body.length))).toEqual({ a: 5 });
  });

  it('keeps the first of a repeated key', () => {
    expect(parseVdfBinary(hex('01 61 00 31 00 01 61 00 32 00 08'))).toEqual({ a: '1' });
  });

  it('treats a key like __proto__ as an ordinary key', () => {
    const parsed = parseVdfBinary(hex('01 5f 5f 70 72 6f 74 6f 5f 5f 00 78 00 08'));
    expect(Object.keys(parsed)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(parsed)).toBeNull();
  });
});

describe('parseVdfBinary: what it refuses', () => {
  it.each([
    ['float', '03', 'type 0x03'],
    ['pointer', '04', 'type 0x04'],
    ['wide string', '05', 'type 0x05'],
    ['colour', '06', 'type 0x06'],
    ['int64', '09', 'type 0x09'],
    ['one past the end type', '0a', 'type 0x0a'],
  ])('stops at a %s rather than misreading the bytes after it', (_name, type, message) => {
    const bytes = hex(`${type} 61 00 00 00 00 00 08`);
    expect(() => parseVdfBinary(bytes)).toThrow(VdfError);
    expect(() => parseVdfBinary(bytes)).toThrow(message);
  });

  it('says where an unknown type is, inside a section', () => {
    // root(00 61 00) holds one string (01 62 00 63 00, bytes 3..7) then 0x42 at byte 8.
    expect(() => parseVdfBinary(hex('00 61 00 01 62 00 63 00 42 78 00 08 08'))).toThrow(
      'type 0x42 at byte 8',
    );
  });

  it.each([
    ['an int32 cut short', '02 61 00 01 00 00'],
    ['a uint64 cut short', '07 61 00 01 00 00 00 00 00 00'],
    ['an int32 with no bytes at all', '02 61 00'],
  ])('refuses %s', (_name, bytes) => {
    expect(() => parseVdfBinary(hex(bytes))).toThrow('ends inside the value of "a"');
  });

  it('refuses a string or key with no terminator', () => {
    expect(() => parseVdfBinary(hex('01 61 00 62'))).toThrow('Unterminated string value of "a"');
    expect(() => parseVdfBinary(hex('01 61'))).toThrow('Unterminated key');
  });

  it('refuses a section that is never closed', () => {
    expect(() => parseVdfBinary(hex('00 61 00 01 62 00 63 00'))).toThrow('ends inside a section');
  });

  it('refuses sections nested absurdly deep instead of overflowing the stack', () => {
    const open = [0x00, 0x61, 0x00];
    const bytes = Uint8Array.from(Array.from({ length: 200 }, () => open).flat());
    expect(() => parseVdfBinary(bytes)).toThrow('nested deeper');
  });
});
