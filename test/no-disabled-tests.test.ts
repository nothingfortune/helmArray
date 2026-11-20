// ESLint's vitest/no-focused-tests and vitest/no-disabled-tests already refuse `.only` and
// `.skip`. This is the second lock on the same door, for what lint cannot see: a skip or focus
// hidden behind an `eslint-disable` comment, and `.todo`, which lint lets through. It scans the
// source text of every test file, so it also fails when lint is not run.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

const SUITE = '(?:it|test|describe|suite|bench)';
const re = (source: string): RegExp => new RegExp(source.replaceAll('SUITE', SUITE));
const FORBIDDEN: readonly [string, RegExp][] = [
  ['a focused test', re(String.raw`\bSUITE\.only\b|\b(?:fit|fdescribe)\s*\(`)],
  ['a skipped test', re(String.raw`\bSUITE\.(?:skip|skipIf)\b|\b(?:xit|xtest|xdescribe)\s*\(`)],
  ['a todo test', re(String.raw`\bSUITE\.todo\b`)],
  ['a conditional test', re(String.raw`\bSUITE\.runIf\b`)],
  ['a lint rule turned off', /eslint-disable[^\n]*\bvitest\//],
];

/** One line per forbidden thing in `text`, with its line number. */
export function disabledTestProblems(name: string, text: string): string[] {
  const found: string[] = [];
  text.split('\n').forEach((line, index) => {
    for (const [what, pattern] of FORBIDDEN) {
      if (pattern.test(line)) found.push(`${name}:${index + 1}: ${what}`);
    }
  });
  return found;
}

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'out', 'dist', 'coverage'].includes(entry.name)
        ? []
        : testFiles(path);
    }
    return /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const files = [...testFiles(join(root, 'packages')), ...testFiles(join(root, 'test'))];
const word = (...parts: string[]): string => parts.join('');

describe('the test files in the repo', () => {
  it('are found, so an empty scan cannot pass for a clean one', () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it('contain no focused, skipped, todo or lint-disabled test', () => {
    const problems = files.flatMap((file) =>
      disabledTestProblems(relative(root, file), readFileSync(file, 'utf8')),
    );
    expect(problems).toEqual([]);
  });
});

describe('disabledTestProblems', () => {
  it('passes an ordinary test', () => {
    expect(disabledTestProblems('a.test.ts', "it('works', () => {});")).toEqual([]);
  });

  it.each([
    [word('it', '.only'), 'a focused test'],
    [word('describe', '.only'), 'a focused test'],
    [word('f', 'it'), 'a focused test'],
    [word('it', '.skip'), 'a skipped test'],
    [word('test', '.skipIf(true)'), 'a skipped test'],
    [word('x', 'describe'), 'a skipped test'],
    [word('it', '.todo'), 'a todo test'],
    [word('it', '.runIf(x)'), 'a conditional test'],
  ])('finds %s', (call, what) => {
    expect(disabledTestProblems('a.test.ts', `${call}('x', () => {});`)).toEqual([
      `a.test.ts:1: ${what}`,
    ]);
  });

  it('finds a lint rule turned off for a test, and says which line', () => {
    const text = `ok();\n// ${word('eslint-', 'disable-next-line')} vitest/expect-expect\nit('x', () => {});`;
    expect(disabledTestProblems('a.test.ts', text)).toEqual([
      'a.test.ts:2: a lint rule turned off',
    ]);
  });

  it('does not mistake a word that merely contains one of them', () => {
    expect(
      disabledTestProblems('a.test.ts', 'const onlyOnce = it.each([1]); skipped(); profit();'),
    ).toEqual([]);
  });
});
