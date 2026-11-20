import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import {
  RUN_PREFIX,
  STALE_AFTER_MS,
  containTmp,
  describeLeftovers,
  sweepStale,
} from '../scripts/test-tmp-run';
import { thrown } from './thrown';

// This file's own scratch space lives inside the contained run folder, and is removed by it.
let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tmp-containment-'));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('the per-run temp folder', () => {
  it('is what os.tmpdir() resolves to inside a test worker', () => {
    expect(tmpdir()).toBe(inject('helmTestTmp'));
  });

  it('is named for the run, so a leftover can be told from anything else', () => {
    expect(basename(inject('helmTestTmp'))).toMatch(/^helm-test-[A-Za-z0-9]{6}$/);
  });

  it('is where TEMP and TMP point, which is what os.tmpdir() reads on Windows', () => {
    expect([process.env['TEMP'], process.env['TMP']]).toEqual([
      inject('helmTestTmp'),
      inject('helmTestTmp'),
    ]);
  });
});

describe('containTmp', () => {
  it('points the temp variables at a new folder, and puts them back', () => {
    const env: NodeJS.ProcessEnv = { TEMP: 'old-temp' };
    const { dir, teardown } = containTmp({ base: scratch, env });
    const during = [env['TMPDIR'], env['TMP'], env['TEMP']];
    teardown();
    expect({ during, after: env }).toEqual({
      during: [dir, dir, dir],
      after: { TEMP: 'old-temp' },
    });
  });

  it('makes the folder under the base, named with the run prefix', () => {
    const { dir, teardown } = containTmp({ base: scratch, env: {} });
    teardown();
    expect([dirname(dir), basename(dir).startsWith(RUN_PREFIX)]).toEqual([scratch, true]);
  });

  it('removes the folder and reports nothing when the run left nothing', () => {
    const { dir, teardown } = containTmp({ base: scratch, env: {}, failOnLeftover: true });
    const left = teardown();
    expect({ left, folderRemains: existsSync(dir) }).toEqual({ left: [], folderRemains: false });
  });

  it('fails the run, naming the file, when a test left one behind', () => {
    const { dir, teardown } = containTmp({ base: scratch, env: {}, failOnLeftover: true });
    writeFileSync(join(dir, 'planted-leak.txt'), 'left behind');
    const error = thrown<Error>(teardown);
    expect(error.message).toMatch(/left 1 entry[\s\S]*planted-leak\.txt/);
  });

  it('fails the run for a leftover folder as well as a leftover file', () => {
    const { dir, teardown } = containTmp({ base: scratch, env: {}, failOnLeftover: true });
    mkdirSync(join(dir, 'planted-dir', 'inner'), { recursive: true });
    expect(thrown<Error>(teardown).message).toContain('planted-dir');
  });

  it('still removes the folder when it fails, so a leak is reported once and not kept', () => {
    const { dir, teardown } = containTmp({ base: scratch, env: {}, failOnLeftover: true });
    writeFileSync(join(dir, 'planted-leak.txt'), 'left behind');
    thrown(teardown);
    expect(existsSync(dir)).toBe(false);
  });

  it('lists what was left, without failing, when asked only to report', () => {
    const { dir, teardown } = containTmp({ base: scratch, env: {} });
    writeFileSync(join(dir, 'b.txt'), '');
    writeFileSync(join(dir, 'a.txt'), '');
    expect(teardown()).toEqual(['a.txt', 'b.txt']);
  });

  it('does not count a cache node keeps in the temp folder as a test leftover', () => {
    const { dir, teardown } = containTmp({ base: scratch, env: {}, failOnLeftover: true });
    mkdirSync(join(dir, 'node-compile-cache'));
    expect(teardown()).toEqual(['node-compile-cache']);
  });
});

describe('describeLeftovers', () => {
  it('names a single entry in the singular', () => {
    expect(describeLeftovers('/t', ['a'])).toMatch(
      /^The test run left 1 entry in its temp folder \/t/,
    );
  });

  it('lists the first 20 and counts the rest', () => {
    const names = Array.from({ length: 23 }, (_, i) => `file-${String(i).padStart(2, '0')}`);
    const text = describeLeftovers('/t', names);
    expect([
      text.includes('file-19'),
      text.includes('file-20'),
      text.includes('and 3 more'),
    ]).toEqual([true, false, true]);
  });
});

describe('sweepStale', () => {
  const age = (path: string, ms: number, now: number) =>
    utimesSync(path, new Date(now - ms), new Date(now - ms));

  it('removes a run folder left by an interrupted run, and keeps a recent one', () => {
    const now = Date.now();
    const old = join(scratch, `${RUN_PREFIX}oldold`);
    const recent = join(scratch, `${RUN_PREFIX}recent`);
    mkdirSync(old);
    mkdirSync(recent);
    age(old, STALE_AFTER_MS + 60_000, now);
    age(recent, 60_000, now);
    expect({
      swept: sweepStale(scratch, now),
      oldRemains: existsSync(old),
      recentRemains: existsSync(recent),
    }).toEqual({
      swept: [basename(old)],
      oldRemains: false,
      recentRemains: true,
    });
  });

  it('leaves alone an old folder that is not a run folder', () => {
    const now = Date.now();
    const other = join(scratch, 'somebody-elses');
    mkdirSync(other);
    age(other, STALE_AFTER_MS * 3, now);
    expect([sweepStale(scratch, now), existsSync(other)]).toEqual([[], true]);
  });
});

// The wiring, end to end: a real Vitest run whose only test plants a file in its temp folder.
describe('the Vitest run', () => {
  const vitestBin = join(
    dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
    'vitest.mjs',
  );
  const setup = resolve(__dirname, '..', 'scripts', 'vitest-tmp-setup.ts');

  function childRun(testBody: string) {
    const root = join(scratch, 'child');
    const base = join(scratch, 'child-tmp');
    mkdirSync(root);
    mkdirSync(base);
    writeFileSync(
      join(root, 'vitest.config.mjs'),
      `export default { test: { globals: true, include: ['*.test.mjs'], globalSetup: [${JSON.stringify(setup)}] } };\n`,
    );
    writeFileSync(
      join(root, 'planted.test.mjs'),
      `import { writeFileSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nit('runs', () => { ${testBody} });\n`,
    );
    const result = spawnSync(
      process.execPath,
      [vitestBin, 'run', '--config', join(root, 'vitest.config.mjs'), '--root', root],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 90_000,
        env: { ...process.env, TEMP: base, TMP: base, TMPDIR: base },
      },
    );
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  }

  it('passes when the tests leave nothing behind', () => {
    const run = childRun('');
    expect(run.status).toBe(0);
  }, 120_000);

  it('fails, naming the file, when a test leaves one behind', () => {
    const run = childRun("writeFileSync(join(tmpdir(), 'planted-leak.txt'), 'left behind');");
    expect({ status: run.status, namesTheFile: run.output.includes('planted-leak.txt') }).toEqual({
      status: 1,
      namesTheFile: true,
    });
  }, 120_000);
});
