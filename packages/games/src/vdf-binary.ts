// Valve's binary KeyValues, as in appcache/librarycache/assetcache.vdf. A stream of entries:
//
//   type (1 byte), key (UTF-8, ends with a 0 byte), then by type
//     0x00 section : entries follow, up to a 0x08 that closes it
//     0x01 string  : UTF-8, ends with a 0 byte
//     0x02 int32   : 4 bytes, little-endian, signed
//     0x07 uint64  : 8 bytes, little-endian
//     0x08 end     : no key, no value; closes the section
//
// Any other type (float 0x03, pointer 0x04, wide string 0x05, colour 0x06, int64 0x09) has a
// layout this reader was never checked against, so it stops with an error rather than guess.

import type { KvSection, KvValue } from './kv';
import { MAX_DEPTH, VdfError, addKey, decodeUtf8, newSection } from './kv';

const T_SECTION = 0x00;
const T_STRING = 0x01;
const T_INT32 = 0x02;
const T_UINT64 = 0x07;
const T_END = 0x08;

/**
 * Parses binary KeyValues into a section. The root's closing end byte may be missing (the file
 * is read to its end); anywhere else, running out of bytes is an error. A repeated key keeps its
 * first value. A uint64 above 2^53 comes back as a bigint, so nothing is rounded.
 */
export function parseVdfBinary(bytes: Uint8Array): KvSection {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;

  function cstring(what: string): string {
    const start = at;
    while (at < bytes.length && bytes[at] !== 0) at++;
    if (at >= bytes.length) throw new VdfError(`Unterminated ${what} at byte ${start}`);
    const text = decodeUtf8(bytes, start, at);
    at++;
    return text;
  }

  function need(count: number, key: string): void {
    if (at + count > bytes.length)
      throw new VdfError(`The data ends inside the value of "${key}" at byte ${at}`);
  }

  function section(depth: number): KvSection {
    if (depth > MAX_DEPTH) throw new VdfError(`Sections nested deeper than ${MAX_DEPTH}`);
    const out = newSection();
    for (;;) {
      if (at >= bytes.length) {
        if (depth > 0) throw new VdfError('The data ends inside a section: an end byte is missing');
        return out;
      }
      const typeAt = at;
      const type = bytes[at++] as number;
      if (type === T_END) return out;
      if (type !== T_SECTION && type !== T_STRING && type !== T_INT32 && type !== T_UINT64) {
        throw new VdfError(
          `Unknown binary KeyValues type 0x${type.toString(16).padStart(2, '0')} at byte ${typeAt}`,
        );
      }
      const key = cstring('key');
      let value: KvValue;
      if (type === T_SECTION) {
        value = section(depth + 1);
      } else if (type === T_STRING) {
        value = cstring(`string value of "${key}"`);
      } else if (type === T_INT32) {
        need(4, key);
        value = view.getInt32(at, true);
        at += 4;
      } else {
        need(8, key);
        const big = view.getBigUint64(at, true);
        value = big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
        at += 8;
      }
      addKey(out, key, value);
    }
  }

  return section(0);
}
