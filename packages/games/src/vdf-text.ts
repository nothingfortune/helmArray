// Valve's text KeyValues, as in libraryfolders.vdf and appmanifest_*.acf:
//
//   "AppState" { "appid" "620" "name" "Portal 2" }
//
// Quoted strings (with \n, \t, \\ and \" escapes) or bare words, `{ }` sections, `//` comments.

import type { KvSection, KvValue } from './kv';
import { MAX_DEPTH, VdfError, addKey, newSection } from './kv';

type Token =
  | { kind: 'open'; line: number }
  | { kind: 'close'; line: number }
  | { kind: 'text'; text: string; line: number };

function tokenize(source: string): Token[] {
  const text = source.startsWith('\uFEFF') ? source.slice(1) : source;
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '\n') {
      line++;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      i++;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '{' || c === '}') {
      tokens.push({ kind: c === '{' ? 'open' : 'close', line });
      i++;
    } else if (c === '"') {
      const start = line;
      let out = '';
      i++;
      for (;;) {
        if (i >= text.length) throw new VdfError(`Unterminated string starting on line ${start}`);
        const d = text[i] as string;
        if (d === '"') {
          i++;
          break;
        }
        if (d === '\\' && i + 1 < text.length) {
          const e = text[i + 1] as string;
          out += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
          continue;
        }
        if (d === '\n') line++;
        out += d;
        i++;
      }
      tokens.push({ kind: 'text', text: out, line: start });
    } else {
      let out = '';
      while (i < text.length && !/[\s{}"]/.test(text[i] as string)) out += text[i++];
      tokens.push({ kind: 'text', text: out, line });
    }
  }
  return tokens;
}

/**
 * Parses text KeyValues into a section. A repeated key keeps its first value.
 * Throws a `VdfError` naming the line for a file that is cut short or has stray braces.
 */
export function parseVdfText(source: string): KvSection {
  const tokens = tokenize(source);
  let at = 0;

  function section(depth: number): KvSection {
    if (depth > MAX_DEPTH) throw new VdfError(`Sections nested deeper than ${MAX_DEPTH}`);
    const out = newSection();
    for (;;) {
      const key = tokens[at++];
      if (key === undefined) {
        if (depth > 0) throw new VdfError('The file ends inside a section: a "}" is missing');
        return out;
      }
      if (key.kind === 'close') {
        if (depth === 0) throw new VdfError(`Unexpected "}" on line ${key.line}`);
        return out;
      }
      if (key.kind === 'open') throw new VdfError(`Unexpected "{" on line ${key.line}`);
      const value = tokens[at++];
      if (value === undefined) throw new VdfError(`The key "${key.text}" has no value`);
      let parsed: KvValue;
      if (value.kind === 'open') parsed = section(depth + 1);
      else if (value.kind === 'close')
        throw new VdfError(`The key "${key.text}" has no value (line ${value.line})`);
      else parsed = value.text;
      addKey(out, key.text, parsed);
    }
  }

  return section(0);
}
