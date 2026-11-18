// Valve KeyValues, text and binary. Spike code: just enough to read Steam's files.

/** @typedef {{ [key: string]: string | number | KV | KV[] }} KV */

/**
 * Text KeyValues ("key" "value" / "key" { ... }). Repeated keys become arrays.
 * @param {string} text
 * @returns {KV}
 */
export function parseText(text) {
  let i = 0;
  /** @returns {string | null} */
  function token() {
    for (;;) {
      while (i < text.length && /\s/.test(text[i] ?? '')) i++;
      if (text.startsWith('//', i)) {
        while (i < text.length && text[i] !== '\n') i++;
        continue;
      }
      break;
    }
    if (i >= text.length) return null;
    const c = text[i];
    if (c === '{' || c === '}') {
      i++;
      return c;
    }
    if (c === '"') {
      let out = '';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          const n = text[i + 1];
          out += n === 'n' ? '\n' : n === 't' ? '\t' : (n ?? '');
          i += 2;
        } else out += text[i++];
      }
      i++;
      return out;
    }
    let out = '';
    while (i < text.length && !/[\s{}"]/.test(text[i] ?? '')) out += text[i++];
    return out;
  }
  /** @returns {KV} */
  function object() {
    /** @type {KV} */
    const obj = {};
    for (;;) {
      const key = token();
      if (key === null || key === '}') return obj;
      const next = token();
      const value = next === '{' ? object() : (next ?? '');
      add(obj, key, value);
    }
  }
  return object();
}

/**
 * @param {KV} obj
 * @param {string} key
 * @param {string | number | KV} value
 */
function add(obj, key, value) {
  const existing = obj[key];
  if (existing === undefined) obj[key] = value;
  else if (Array.isArray(existing)) existing.push(/** @type {KV} */ (value));
  else obj[key] = [/** @type {KV} */ (existing), /** @type {KV} */ (value)];
}

/**
 * Binary KeyValues: 0x00 section, 0x01 string, 0x02 int32, 0x07 uint64, 0x08 end.
 * @param {Buffer} buf
 * @returns {KV}
 */
export function parseBinary(buf) {
  let i = 0;
  function cstring() {
    const end = buf.indexOf(0, i);
    const s = buf.toString('utf8', i, end);
    i = end + 1;
    return s;
  }
  /** @returns {KV} */
  function object() {
    /** @type {KV} */
    const obj = {};
    while (i < buf.length) {
      const type = buf[i++];
      if (type === 0x08) return obj;
      const key = cstring();
      if (type === 0x00) add(obj, key, object());
      else if (type === 0x01) add(obj, key, cstring());
      else if (type === 0x02) {
        add(obj, key, buf.readInt32LE(i));
        i += 4;
      } else if (type === 0x07) {
        add(obj, key, Number(buf.readBigUInt64LE(i)));
        i += 8;
      } else throw new Error(`Unknown binary KV type ${type} at ${i - 1}`);
    }
    return obj;
  }
  return object();
}
