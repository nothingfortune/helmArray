// One short temp folder per test run, so everything a run writes to os.tmpdir() is accounted
// for, and a test that leaves something behind fails the run instead of filling the disk.
import { lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const RUN_PREFIX = 'helm-test-';
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
// What os.tmpdir() reads: TEMP then TMP on Windows, TMPDIR elsewhere.
export const TMP_VARS = ['TMPDIR', 'TMP', 'TEMP'] as const;
const RUN_NAME = /^helm-test-[A-Za-z0-9]{6}$/;
// Caches that node keeps in os.tmpdir() whenever a test spawns it: tool state, not a leftover.
export const TOOL_CACHES: readonly RegExp[] = [/^node-compile-cache$/];
const LISTED = 20;

export function removeTree(path: string): void {
  // Windows holds a file for a moment after a process closes it; retry before giving up.
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

/**
 * Removes run folders under `base` untouched for over 24 h (an interrupted run's). A younger
 * one may be another worktree's live run, so it is left alone.
 */
export function sweepStale(base: string, now = Date.now()): string[] {
  const swept: string[] = [];
  let names: string[];
  try {
    names = readdirSync(base);
  } catch {
    return swept;
  }
  for (const name of names) {
    if (!RUN_NAME.test(name)) continue;
    const path = join(base, name);
    try {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || now - stat.mtimeMs <= STALE_AFTER_MS) continue;
      removeTree(path);
      swept.push(name);
    } catch {
      // A sweep is housekeeping for an interrupted run; it never fails this one.
    }
  }
  return swept;
}

export function describeLeftovers(dir: string, names: readonly string[]): string {
  const listed = names.slice(0, LISTED).map((name) => `  ${name}`);
  const more = names.length > LISTED ? [`  ... and ${names.length - LISTED} more`] : [];
  return [
    `The test run left ${names.length} entr${names.length === 1 ? 'y' : 'ies'} in its temp folder ${dir}. Every test must remove what it creates.`,
    ...listed,
    ...more,
  ].join('\n');
}

export interface ContainOptions {
  base?: string;
  env?: NodeJS.ProcessEnv;
  now?: number;
  failOnLeftover?: boolean;
}

/**
 * Makes a run folder under `base` and points TMPDIR, TMP and TEMP at it, before any worker or
 * child process starts, so os.tmpdir() resolves inside it everywhere. `teardown` puts the
 * variables back, removes the folder, and returns what was left in it; with `failOnLeftover` it
 * throws instead when that is anything but a tool cache.
 */
export function containTmp({
  base = tmpdir(),
  env = process.env,
  now = Date.now(),
  failOnLeftover = false,
}: ContainOptions = {}): { dir: string; teardown: () => string[] } {
  sweepStale(base, now);
  const dir = mkdtempSync(join(base, RUN_PREFIX));
  const saved = TMP_VARS.map((name) => [name, env[name]] as const);
  for (const name of TMP_VARS) env[name] = dir;
  const teardown = (): string[] => {
    for (const [name, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(env, name);
      else env[name] = value;
    }
    let left: string[];
    try {
      left = readdirSync(dir).sort();
    } finally {
      removeTree(dir);
    }
    const leaked = left.filter((name) => !TOOL_CACHES.some((cache) => cache.test(name)));
    if (failOnLeftover && leaked.length > 0) throw new Error(describeLeftovers(dir, leaked));
    return left;
  };
  return { dir, teardown };
}
