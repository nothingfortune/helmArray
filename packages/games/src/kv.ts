// What Valve's KeyValues files parse into, shared by the text and binary readers. A section is
// a plain record from key to value; it has no prototype, so a key like "__proto__" is just a key.

/** A value is text, a number, or a nested section. A uint64 too big for a number is a bigint. */
export type KvValue = string | number | bigint | KvSection;

export interface KvSection {
  readonly [key: string]: KvValue;
}

/** Thrown for a file that is not well-formed, with where and what. */
export class VdfError extends Error {
  override readonly name = 'VdfError';
}

export function newSection(): Record<string, KvValue> {
  return Object.create(null) as Record<string, KvValue>;
}

/**
 * Adds a key. When a key repeats, the first one stays: that is what Valve's own `FindKey` returns.
 */
export function addKey(section: Record<string, KvValue>, key: string, value: KvValue): void {
  if (!(key in section)) section[key] = value;
}

export function isSection(value: KvValue | undefined): value is KvSection {
  return typeof value === 'object';
}

/** Valve's keys are case-insensitive ("AppID" and "appid" are one key); an exact match wins. */
export function findKey(section: KvSection, key: string): KvValue | undefined {
  const exact = section[key];
  if (exact !== undefined) return exact;
  const lower = key.toLowerCase();
  for (const [name, value] of Object.entries(section)) {
    if (name.toLowerCase() === lower) return value;
  }
  return undefined;
}

export function findSection(section: KvSection, key: string): KvSection | undefined {
  const value = findKey(section, key);
  return isSection(value) ? value : undefined;
}

/** A text value, or a number written out; a section is not text. */
export function findString(section: KvSection, key: string): string | undefined {
  const value = findKey(section, key);
  return value === undefined || isSection(value) ? undefined : String(value);
}

export const MAX_DEPTH = 64;

/** How many continuation bytes a lead byte takes, its payload bits, and the least code point it may encode. */
function lead(b: number): { need: number; bits: number; min: number } | undefined {
  if (b >= 0xc2 && b <= 0xdf) return { need: 1, bits: b & 0x1f, min: 0x80 };
  if (b >= 0xe0 && b <= 0xef) return { need: 2, bits: b & 0x0f, min: 0x800 };
  if (b >= 0xf0 && b <= 0xf4) return { need: 3, bits: b & 0x07, min: 0x10000 };
  return undefined;
}

/** UTF-8 to a string. Bad bytes become U+FFFD rather than throwing: a name is not worth a failure. */
export function decodeUtf8(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = '';
  let i = start;
  while (i < end) {
    const b = bytes[i] ?? 0;
    const head = b < 0x80 ? undefined : lead(b);
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
    } else if (!head || i + head.need >= end) {
      out += '\uFFFD';
      i++;
    } else {
      let cp = head.bits;
      let j = 1;
      for (; j <= head.need; j++) {
        const c = bytes[i + j] ?? 0;
        if ((c & 0xc0) !== 0x80) break;
        cp = (cp << 6) | (c & 0x3f);
      }
      const ok = j > head.need && cp >= head.min && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff);
      out += ok ? String.fromCodePoint(cp) : '\uFFFD';
      i += ok ? head.need + 1 : 1;
    }
  }
  return out;
}
