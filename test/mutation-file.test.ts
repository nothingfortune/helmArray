import { describe, expect, it } from 'vitest';
import { mutateGlobs, requestedGlobs } from '../scripts/mutation-file';
import config from '../stryker.config.mjs';

describe('requestedGlobs', () => {
  it('drops the -- a package runner passes through', () => {
    expect(requestedGlobs(['--', 'packages/azeron/src/records.ts'])).toEqual([
      'packages/azeron/src/records.ts',
    ]);
  });

  it('keeps every glob it is given, in order', () => {
    expect(requestedGlobs(['a.ts', 'b/**/*.ts'])).toEqual(['a.ts', 'b/**/*.ts']);
  });
});

describe('mutateGlobs', () => {
  it('puts the config exclusions after the globs asked for, and leaves the config inclusions out', () => {
    expect(mutateGlobs(['x/**/*.ts'], ['a.ts', '!b.ts', 'c.ts', '!d.ts'])).toEqual([
      'x/**/*.ts',
      '!b.ts',
      '!d.ts',
    ]);
  });

  it('keeps the real exclusions of stryker.config.mjs: the fake unit, and every test', () => {
    const globs = mutateGlobs(['packages/azeron/src/**/*.ts'], config.mutate);
    expect(globs).toEqual(
      expect.arrayContaining(['!packages/azeron/src/fake.ts', '!packages/azeron/src/**/*.test.ts']),
    );
  });
});
