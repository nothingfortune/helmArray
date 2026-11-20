import { fileURLToPath } from 'node:url';
import { defaultExclude, defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.ts';

// The package's source in the folder this config sits in: inside Stryker's sandbox, the mutated copy.
const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// Stryker only: the base config with what a mutation run should not pay for or cannot use.
//  - coverage: Stryker finds out which tests reach which mutant itself.
//  - test/tmp-containment.test.ts: spawns a child Vitest run to plant a leak, and tests the
//    setup file, which is the harness and not code under mutation. The containment itself still
//    runs, from scripts/vitest-stryker-tmp-setup.ts, which makes the folder inside the sandbox.
//  - test/check-coverage-drift.test.ts: spawns node over a planted coverage summary; the script
//    is not under mutation.
//  - test/lint-test-integrity.test.ts, test/boundaries.test.ts: run ESLint over planted code;
//    nothing under mutation changes what they say.
//  - test/no-disabled-tests.test.ts, test/stryker-disable-comments.test.ts,
//    test/workflow-hygiene.test.ts, test/mutation-file.test.ts, test/mutation-entry-points.test.ts: read the repository's own files
//    and scripts, not the code under mutation.
// `test/integration` stays in: it drives the real wiring and kills most main-process mutants.
const config = mergeConfig(
  base,
  defineConfig({
    resolve: {
      // The packages reach each other through node_modules links that lead back to the real,
      // unmutated tree, so a test in test/ or in app would never see a mutant in azeron, core
      // or games. Pointing the names at the sandbox's own source lets every test that uses the
      // protocol kill its mutants: the reference-capture tests above all.
      alias: {
        '@helmarray/azeron': source('./packages/azeron/src/index.ts'),
        '@helmarray/core': source('./packages/core/src/index.ts'),
        '@helmarray/games': source('./packages/games/src/index.ts'),
      },
    },
    test: {
      exclude: [
        ...defaultExclude,
        'test/tmp-containment.test.ts',
        'test/check-coverage-drift.test.ts',
        'test/lint-test-integrity.test.ts',
        'test/boundaries.test.ts',
        'test/no-disabled-tests.test.ts',
        'test/stryker-disable-comments.test.ts',
        'test/workflow-hygiene.test.ts',
        'test/mutation-file.test.ts',
        'test/mutation-entry-points.test.ts',
      ],
      coverage: { enabled: false },
    },
  }),
);

// mergeConfig joins arrays, and the base's global setup must be replaced, not added to.
config.test = { ...config.test, globalSetup: ['scripts/vitest-stryker-tmp-setup.ts'] };

export default config;
