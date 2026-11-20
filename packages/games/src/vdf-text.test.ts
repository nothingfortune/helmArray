import { describe, expect, it } from 'vitest';
import { VdfError, findKey, findSection, findString } from './kv';
import { parseVdfText } from './vdf-text';

describe('parseVdfText', () => {
  it('reads nested sections and quoted pairs', () => {
    const parsed = parseVdfText(`
"AppState"
{
\t"appid"\t\t"620"
\t"name"\t\t"Portal 2"
\t"UserConfig"
\t{
\t\t"language"\t\t"english"
\t}
}
`);
    expect(parsed).toEqual({
      AppState: { appid: '620', name: 'Portal 2', UserConfig: { language: 'english' } },
    });
  });

  it('reads Windows paths with doubled backslashes as single ones', () => {
    const parsed = parseVdfText(String.raw`"path" "D:\\SteamLibrary\\Games"`);
    expect(parsed['path']).toBe(String.raw`D:\SteamLibrary\Games`);
  });

  it('reads the escapes \\n, \\t, \\\\ and \\"; an unknown escape keeps its character', () => {
    const parsed = parseVdfText(
      String.raw`"a" "x\ny" "b" "x\ty" "c" "\\" "d" "say \"hi\"" "e" "\q"`,
    );
    expect(parsed).toEqual({ a: 'x\ny', b: 'x\ty', c: '\\', d: 'say "hi"', e: 'q' });
  });

  it('ends a string at the quote right after an escaped backslash', () => {
    // "a\\" is the one character a backslash; the quote after it closes the string.
    const parsed = parseVdfText(String.raw`"k" "a\\" "next" "v"`);
    expect(parsed).toEqual({ k: 'a\\', next: 'v' });
  });

  it('needs no space between a key and its value, or around braces', () => {
    expect(parseVdfText('"a""b""c"{"d""e"}')).toEqual({ a: 'b', c: { d: 'e' } });
  });

  it('reads bare words as well as quoted ones', () => {
    expect(parseVdfText('name Portal\nsection { n 1 }')).toEqual({
      name: 'Portal',
      section: { n: '1' },
    });
  });

  it('keeps a quoted brace as text, not structure', () => {
    expect(parseVdfText('"a" "{" "b" "}"')).toEqual({ a: '{', b: '}' });
  });

  it('skips // comments but not a // inside a string', () => {
    const parsed = parseVdfText(`// header
"a" "http://example.test" // trailing
"b" // between key and value
"2"`);
    expect(parsed).toEqual({ a: 'http://example.test', b: '2' });
  });

  it('reads CRLF files, and a byte order mark', () => {
    expect(parseVdfText('\uFEFF"a"\r\n{\r\n"b" "c"\r\n}\r\n')).toEqual({ a: { b: 'c' } });
  });

  it('keeps a string that spans lines whole', () => {
    expect(parseVdfText('"a" "one\ntwo"')).toEqual({ a: 'one\ntwo' });
  });

  it('keeps the first of a repeated key', () => {
    expect(parseVdfText('"a" "1" "a" "2"')).toEqual({ a: '1' });
  });

  it('treats __proto__ as an ordinary key', () => {
    const parsed = parseVdfText('"__proto__" { "x" "1" }');
    expect(Object.keys(parsed)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(parsed)).toBeNull();
  });

  it('reads an empty file and an empty section', () => {
    expect(parseVdfText('')).toEqual({});
    expect(parseVdfText('"a" { }')).toEqual({ a: {} });
  });

  it('reads UTF-8 text such as a game title with a trademark sign', () => {
    expect(parseVdfText('"name" "Caf\u00e9 \u2122"')).toEqual({ name: 'Caf\u00e9 \u2122' });
  });
});

describe('parseVdfText: what it refuses', () => {
  it.each([
    ['an unterminated string', '"a" "b', 'Unterminated string starting on line 1'],
    ['a section never closed', '"a" { "b" "c"', 'a "}" is missing'],
    ['a stray closing brace', '"a" "b" }', 'Unexpected "}" on line 1'],
    ['a key with no value at the end', '"a" "b" "c"', 'The key "c" has no value'],
    ['a key followed by a closing brace', '"a" { "b" }', 'The key "b" has no value (line 1)'],
    ['an opening brace where a key belongs', '{ "a" "b" }', 'Unexpected "{" on line 1'],
  ])('refuses %s', (_name, text, message) => {
    expect(() => parseVdfText(text)).toThrow(VdfError);
    expect(() => parseVdfText(text)).toThrow(message);
  });

  it('names the line of the problem', () => {
    expect(() => parseVdfText('"a" "b"\n\n"c" "d"\n}')).toThrow('line 4');
    expect(() => parseVdfText('"a" "b"\n"c" "unfinished')).toThrow('line 2');
  });

  it('refuses sections nested absurdly deep instead of overflowing the stack', () => {
    expect(() => parseVdfText('"a" {'.repeat(200))).toThrow('nested deeper');
  });
});

describe('looking things up', () => {
  const parsed = parseVdfText('"AppState" { "AppID" "620" "nested" { "k" "v" } }');
  const state = findSection(parsed, 'appstate');

  it('matches keys without regard to case, as Valve does', () => {
    expect(state).toBeDefined();
    expect(findString(state ?? {}, 'appid')).toBe('620');
    expect(findKey(state ?? {}, 'APPID')).toBe('620');
  });

  it('prefers an exact match when two keys differ only by case', () => {
    const both = parseVdfText('"Name" "one" "name" "two"');
    expect(findString(both, 'name')).toBe('two');
    expect(findString(both, 'Name')).toBe('one');
  });

  it('says undefined for a missing key, and for a section asked for as text', () => {
    expect(findString(state ?? {}, 'missing')).toBeUndefined();
    expect(findString(state ?? {}, 'nested')).toBeUndefined();
    expect(findSection(state ?? {}, 'appid')).toBeUndefined();
  });
});
