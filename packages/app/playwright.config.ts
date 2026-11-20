import { defineConfig } from '@playwright/test';

const ci = !!process.env['CI'];

// The end-to-end suite: the built app in a real window, over fake units (see
// src/main/e2e-seam.ts). Run it with `pnpm test:e2e` from the repo root, never from `pnpm check`.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  // One app at a time: each run owns a window and its own temp folder, and the machine is small.
  workers: 1,
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  // One test, and the whole run (so a hung app can't hold a CI job past its own limit).
  timeout: 60_000,
  globalTimeout: 15 * 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }], ...(ci ? [['github'] as const] : [])],
  outputDir: 'test-results',
  // The app is launched by e2e/helm.ts, not by Playwright's `page` fixture, so these three are
  // done there: the trace, a window screenshot and the video are kept for a failed test only.
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
});
