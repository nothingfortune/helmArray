import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
    environment: 'node',
    // Each run writes its temp files into one folder and fails if a test leaves something in it.
    globalSetup: ['scripts/vitest-tmp-setup.ts'],
    coverage: {
      provider: 'v8',
      // Report all source, not just what a test happens to load: an untested file shows as 0%
      // instead of vanishing from the report.
      include: ['packages/*/src/**/*.{ts,tsx}'],
      // Excludes are explicit paths, never a blanket `**/index.ts`: that would also hide the
      // package entry points (core, azeron) that hold real code. The one pattern is the tests
      // themselves.
      exclude: [
        '**/*.test.{ts,tsx}',
        // Types only: no statements to run.
        'packages/app/src/renderer/helm.d.ts',
        // Electron glue: these import `electron`, which no test may load. The Playwright e2e
        // suite (`pnpm test:e2e`) is what covers them; their logic lives in the counted modules beside
        // them.
        'packages/app/src/main/index.ts',
        'packages/app/src/preload/index.ts',
      ],
      // json-summary is what scripts/check-coverage-drift.ts reads.
      reporter: ['text-summary', 'json-summary', 'html'],
      // The regression floor: about 1 point under the measured totals (89.67 / 84.99 / 84.13 /
      // 90.31 when it was set), so the gate catches a slide and never honest work. It only goes
      // up. When coverage rises, raise it to follow: scripts/check-coverage-drift.ts fails the
      // gate when a floor is more than 2 points under measured. Never lower it to pass a PR.
      // Falling below means the new code needs tests, not that the gate needs loosening.
      thresholds: {
        statements: 88.6,
        branches: 84,
        functions: 83.1,
        lines: 89.3,
      },
    },
  },
});
