// Proves helm/no-keyed-write-on-literal (eslint/no-keyed-write-on-literal.js) catches a record
// keyed by data written by key onto an object literal, where a key such as __proto__ is lost, in
// core and app code, and lets through the ways that keep it: withOwn, Object.fromEntries,
// Object.create(null), a literal key, and a write allowed with a reason.
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });
const RULE = 'helm/no-keyed-write-on-literal';

async function hits(filePath: string, code: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === RULE && m.severity === 2).length;
}

// The first lint loads the whole config; paid once, in a hook only a hang can time out.
beforeAll(async () => {
  await hits('packages/core/src/index.ts', 'export {};\n');
}, 120_000);

const BAD: [name: string, code: string][] = [
  [
    'an empty literal, written by a computed key',
    'export function f(mode: string) {\n  const map = {} as Record<string, number>;\n  map[mode] = 1;\n  return map;\n}\n',
  ],
  [
    'a typed literal, written in a loop',
    'export function f(ids: string[]) {\n  const out: Record<string, number> = {};\n  for (const id of ids) out[id] = 1;\n  return out;\n}\n',
  ],
  [
    'a literal with entries, written later',
    'export function f(id: string) {\n  let rows: Record<string, number> = { a: 1 };\n  rows[id] = 2;\n  return rows;\n}\n',
  ],
  [
    'Object.assign onto a literal',
    'export function f(more: Record<string, number>) {\n  const out: Record<string, number> = {};\n  Object.assign(out, more);\n  return out;\n}\n',
  ],
  [
    'an allow comment with no reason',
    'export function f(id: string) {\n  const out: Record<string, number> = {};\n  // keyed-write-ok:\n  out[id] = 1;\n  return out;\n}\n',
  ],
];

const GOOD: [name: string, code: string][] = [
  [
    'Object.fromEntries',
    'export const f = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 1]));\n',
  ],
  [
    'a null-prototype record',
    'export function f(id: string) {\n  const out: Record<string, number> = Object.create(null);\n  out[id] = 1;\n  return out;\n}\n',
  ],
  [
    'a literal key',
    "export function f() {\n  const out: Record<string, number> = {};\n  out['a'] = 1;\n  return out;\n}\n",
  ],
  [
    'a write allowed with a reason',
    "export function f(hand: 'left' | 'right') {\n  const out: Record<string, number> = {};\n  // keyed-write-ok: the key is a hand, never data\n  out[hand] = 1;\n  return out;\n}\n",
  ],
  [
    'a computed read',
    'export function f(id: string) {\n  const out: Record<string, number> = {};\n  return out[id];\n}\n',
  ],
];

const PLACES = [
  'packages/core/src/x.ts',
  'packages/app/src/renderer/x.ts',
  'packages/app/src/main/x.ts',
];

describe('the keyed-write lint rule', () => {
  describe.each(PLACES)('in %s', (place) => {
    it.each(BAD)('flags %s', async (_name, code) => {
      expect(await hits(place, code)).toBe(1);
    });

    it.each(GOOD)('lets %s through', async (_name, code) => {
      expect(await hits(place, code)).toBe(0);
    });
  });
});
