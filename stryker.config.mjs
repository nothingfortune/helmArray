// Mutation testing: tests the tests. A LOCAL layer, not part of `pnpm check`:
//   pnpm test:mutation                      the whole scope (hours)
//   pnpm test:mutation:file -- <glob>       one file or folder, e.g. packages/azeron/src/records.ts
//   .github/workflows/mutation.yml          manual, one glob, informational
//
// Stryker changes the source below one small way at a time (a mutant) and re-runs the Vitest suite
// for each. A mutant the suite does not fail on is a change no test notices: an assertion that
// cannot fail that way. Coverage cannot tell: a line the wrong branch ran still counts as covered.
//
// Scope is the pure logic that can do damage: the unit protocol and records, the plan resolver,
// the game readers and the main-process services that decide what is written to a unit or a
// game file. React components, CSS, `index.ts` and the preload are the Electron glue and the
// screens: the Playwright e2e suite covers them, and mutating them would measure the wrong suite.
//
// INFORMATIONAL by design (`thresholds.break: null`): the score never gates a PR. If it does not
// block, it must not look like it blocks.
//
// Sandbox note: Stryker copies the repo to `.stryker-tmp/` and mutates the copy. Workspace
// packages import each other through node_modules symlinks (`@helmarray/azeron`, `@helmarray/core`)
// that point back at the real, unmutated tree, so a package's own tests are what must kill its
// mutants, and a cross-package import never sees a mutant.
export default {
  // Named, not the `@stryker-mutator/*` glob: pnpm keeps the plugins out of Stryker's own folder.
  plugins: ['@stryker-mutator/vitest-runner', '@stryker-mutator/typescript-checker'],
  testRunner: 'vitest',
  // The base config minus coverage and the meta-tests that spawn child runs; see the file.
  vitest: { configFile: 'vitest.stryker.config.ts' },
  // Mutants that do not compile are discarded instead of run: a type error is not a finding.
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.stryker.json',
  // The first dry run (the whole suite, instrumented) is slow; past the default it aborts early.
  dryRunTimeoutMinutes: 30,
  // Modest on purpose: the machine has had low-memory warnings. Raise it on the build rig.
  concurrency: 3,
  // Build outputs, reports and the other worktrees never belong in the sandbox.
  ignorePatterns: [
    '**/out',
    '**/dist',
    '**/release',
    'coverage',
    'reports',
    'playwright-report',
    'test-results',
    '.claude',
    'docs',
  ],
  mutate: [
    // The units: protocol, record encoding, pin maps, the session, what was stored, what a write verifies.
    'packages/azeron/src/**/*.ts',
    '!packages/azeron/src/index.ts', // re-export barrel
    '!packages/azeron/src/fake.ts', // the fake unit the tests drive: test support, not shipped logic
    '!packages/azeron/src/**/*.test.ts',
    // Core: the resolver, the presets, the checks that produce findings, the game layouts.
    'packages/core/src/resolve.ts',
    'packages/core/src/presets/**/*.ts',
    'packages/core/src/checks.ts',
    'packages/core/src/placed.ts', // whether an action is placed: the checks and the editor ask it
    'packages/core/src/sticks.ts', // what a stick does for the Azerons' output
    'packages/core/src/games/**/*.ts',
    'packages/core/src/game-data.ts', // a game's data checked before it is saved
    '!packages/core/src/**/*.test.ts',
    // Games: Steam folders and the VDF readers and writers.
    'packages/games/src/**/*.ts',
    '!packages/games/src/index.ts', // re-export barrel
    '!packages/games/src/**/*.test.ts',
    // App main: what is written, to which unit, and whether the world allows it.
    'packages/app/src/main/apply-units.ts',
    'packages/app/src/main/apply-service.ts',
    'packages/app/src/main/gated-session.ts',
    'packages/app/src/main/plan-fingerprint.ts',
    'packages/app/src/main/scheme-plan.ts',
    'packages/app/src/main/active-plans.ts',
    'packages/app/src/main/sync-state.ts', // what sync-truth.test.ts tests: which slots are in sync
    'packages/app/src/main/devices.ts',
    'packages/app/src/main/devices-gate.ts',
    'packages/app/src/main/hands.ts',
    'packages/app/src/main/hand-finder.ts',
    'packages/app/src/main/store.ts',
    'packages/app/src/main/hid-transport.ts',
    'packages/app/src/main/processes.ts',
    'packages/app/src/main/exchange-log.ts',
    'packages/app/src/main/e2e-seam.ts',
    'packages/app/src/main/compose.ts',
    // App renderer: the pure models behind the screens, not the components.
    'packages/app/src/renderer/screens/editor-model.ts',
    'packages/app/src/renderer/screens/editor-view.ts',
    'packages/app/src/renderer/screens/libraryView.ts',
    'packages/app/src/renderer/screens/libraryFlow.ts',
    'packages/app/src/renderer/screens/fixes.ts', // the checks' fix buttons
    'packages/app/src/renderer/screens/check-groups.ts',
    'packages/app/src/renderer/screens/recent-games.ts',
    'packages/app/src/renderer/screens/reveal.ts', // where the Editor goes after an action
    'packages/app/src/renderer/screens/offer-work.ts', // the fix offers, worked out after the draw
    'packages/app/src/renderer/screens/offer-slices.ts',
    'packages/app/src/renderer/apply/applyFlow.ts',
    // The Game screen: its edits, its state, press-to-set and what it listens to while waiting.
    'packages/app/src/renderer/screens/game-model.ts',
    'packages/app/src/renderer/screens/game-editor.ts',
    'packages/app/src/renderer/screens/capture.ts',
    'packages/app/src/renderer/screens/press-listener.ts',
    'packages/app/src/renderer/screens/gameTile.ts',
  ],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  // Incremental state makes a re-run test only the mutants whose code or tests changed. The file
  // is committed, so a clone does not start from nothing.
  incremental: true,
  incrementalFile: 'reports/mutation/incremental.json',
  thresholds: { high: 90, low: 75, break: null },
};
