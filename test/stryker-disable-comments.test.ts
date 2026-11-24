import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { malformedStrykerDirectives } from '../scripts/stryker-disable-comments';

// A line planted in the middle of valid code, so the line number it is reported on is checked too.
const plant = (line: string): string => `const before = 0;\n${line}\nconst after = 1;`;

describe('malformedStrykerDirectives', () => {
  it('accepts the single-line form that names its mutators and gives a reason', () => {
    const source = [
      'const a = 1;',
      '  // Stryker disable next-line BooleanLiteral: the array is a compile-time exhaustiveness pin',
      'const pinned = [true, true];',
      '// Stryker disable next-line BooleanLiteral,ArrayDeclaration,ArrowFunction,CallExpression: the same pin, four mutators',
      'const alsoPinned = [true];',
    ].join('\n');
    expect(malformedStrykerDirectives(source)).toEqual([]);
  });

  it('accepts a valid directive in a file with CRLF line endings', () => {
    const source = [
      'const a = 1;',
      '// Stryker disable next-line StringLiteral: the label is only ever compared with itself',
      'const pinned = "x";',
    ].join('\r\n');
    expect(malformedStrykerDirectives(source)).toEqual([]);
  });

  it('accepts a source with no directive at all', () => {
    expect(malformedStrykerDirectives('const a = 1;\nconst b = 2;')).toEqual([]);
  });

  it.each([
    ['// Stryker disable next-line BooleanLiteral', 'no reason'],
    ['// Stryker disable next-line BooleanLiteral: ', 'an empty reason'],
    ['// Stryker disable next-line: equivalent', 'no mutator named'],
    ['// Stryker disable next-line all: equivalent', 'the catch-all mutator'],
    ['// Stryker disable next-line Boolean: equivalent', 'a mutator that does not exist'],
    [
      '// Stryker disable next-line BooleanLiteral,Nonsense: equivalent',
      'one real mutator and one that does not exist',
    ],
    ['// Stryker disable BooleanLiteral: equivalent', 'a disable that runs to the end of the file'],
    ['// Stryker disable all', 'a file-wide disable'],
    ['// Stryker restore all', 'a restore, which only a block disable needs'],
    ['/* Stryker disable next-line BooleanLiteral: equivalent */', 'the block-comment form'],
    ['const x = 1; // Stryker disable next-line BooleanLiteral: equivalent', 'a trailing comment'],
    ['// Stryker disable next-line BooleanLiteral: hard to test', 'a reason that is not one'],
    [
      '// Stryker disable next-line BooleanLiteral: Difficult to test here',
      'the same, capitalised',
    ],
    ['// Stryker disable next-line BooleanLiteral: this is untestable', 'the same, another way'],
  ])('refuses %s (%s)', (line) => {
    expect(malformedStrykerDirectives(plant(line))).toEqual([2]);
  });

  it('reports every offending line, and only those', () => {
    const source = [
      '// Stryker disable next-line BooleanLiteral: ok, equivalent',
      'a;',
      '// Stryker disable all',
      'b;',
      '// Stryker disable next-line Regex: ok, equivalent',
      'c;',
      '// Stryker restore all',
    ].join('\n');
    expect(malformedStrykerDirectives(source)).toEqual([3, 7]);
  });
});

const ROOT = resolve(__dirname, '..');
const SKIPPED = new Set(['node_modules', 'out', 'dist']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIPPED.has(name)) return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('every accepted mutant in the source says which mutator and why', () => {
  it('no Stryker directive in packages/ breaks the convention', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, 'packages'))) {
      for (const line of malformedStrykerDirectives(readFileSync(file, 'utf8'))) {
        offenders.push(`${relative(ROOT, file)}:${String(line)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
