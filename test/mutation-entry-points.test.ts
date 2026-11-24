import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strykerMutateBypasses } from '../scripts/stryker-entry-points';

describe('strykerMutateBypasses', () => {
  it.each([
    'npx stryker run --mutate "$MUTATE"',
    '- run: pnpm exec stryker run --mutate "$MUTATE"',
    'node node_modules/@stryker-mutator/core/bin/stryker.js run --mutate=packages/a.ts',
    'stryker run -m packages/a.ts',
    '"test:x": "stryker run --incremental --mutate"',
  ])('finds %s', (line) => {
    expect(strykerMutateBypasses(`before\n${line}\nafter`)).toEqual([2]);
  });

  it.each([
    'pnpm test:mutation:file -- "$MUTATE"',
    'pnpm exec stryker run --force',
    '"test:mutation": "stryker run"',
    'a mutate list, mentioned without stryker',
  ])('leaves %s alone', (line) => {
    expect(strykerMutateBypasses(line)).toEqual([]);
  });
});

const ROOT = resolve(__dirname, '..');

/** Every place a command line can live: workflows, package scripts, and the docs. */
function entryPoints(): string[] {
  const files: string[] = [];
  const workflows = join(ROOT, '.github', 'workflows');
  if (existsSync(workflows)) {
    for (const name of readdirSync(workflows)) files.push(join(workflows, name));
  }
  files.push(join(ROOT, 'package.json'));
  for (const name of readdirSync(join(ROOT, 'packages'))) {
    const manifest = join(ROOT, 'packages', name, 'package.json');
    if (existsSync(manifest)) files.push(manifest);
  }
  for (const name of readdirSync(join(ROOT, 'docs'))) {
    if (name.endsWith('.md')) files.push(join(ROOT, 'docs', name));
  }
  for (const name of ['README.md', 'CLAUDE.md']) files.push(join(ROOT, name));
  return files;
}

describe('every way to run Stryker over a glob goes through scripts/mutation-file.ts', () => {
  it('no workflow, package script or doc calls stryker with --mutate itself', () => {
    const offenders = entryPoints().flatMap((file) =>
      strykerMutateBypasses(readFileSync(file, 'utf8')).map(
        (line) => `${relative(ROOT, file)}:${String(line)}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('the workflow runs the wrapper, with the input as one quoted argument', () => {
    const text = readFileSync(join(ROOT, '.github', 'workflows', 'mutation.yml'), 'utf8');
    expect(text).toContain('pnpm test:mutation:file -- "$MUTATE"');
  });
});
