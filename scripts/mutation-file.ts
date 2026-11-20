// `pnpm test:mutation:file -- <glob>...`: Stryker over just those files.
//
// `stryker run --mutate <glob>` replaces the whole `mutate` list in stryker.config.mjs, and with
// it the `!` entries that keep tests, barrels and fakes out. A bare glob such as
// `packages/azeron/src/**/*.ts` would then mutate the tests themselves. This puts the config's
// exclusions back after whatever was asked for.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The `--mutate` value for `globs`: the globs, then every exclusion the config lists. */
export function mutateGlobs(globs: readonly string[], configured: readonly string[]): string[] {
  return [...globs, ...configured.filter((glob) => glob.startsWith('!'))];
}

/** What follows the script name, without the `--` some runners pass through. */
export function requestedGlobs(argv: readonly string[]): string[] {
  return argv.filter((arg) => arg !== '--');
}

async function main(): Promise<number> {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const globs = requestedGlobs(process.argv.slice(2));
  if (globs.length === 0) {
    console.error(
      'Name what to mutate, e.g. pnpm test:mutation:file -- packages/azeron/src/records.ts',
    );
    return 2;
  }
  const { default: config } = (await import(
    pathToFileURL(join(root, 'stryker.config.mjs')).href
  )) as {
    default: { mutate: string[] };
  };
  const stryker = join(root, 'node_modules', '@stryker-mutator', 'core', 'bin', 'stryker.js');
  const run = spawnSync(
    process.execPath,
    [stryker, 'run', '--mutate', mutateGlobs(globs, config.mutate).join(',')],
    { cwd: root, stdio: 'inherit' },
  );
  return run.status ?? 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
