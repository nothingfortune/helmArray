import { defineConfig } from '@playwright/test';

// The end-to-end suite: the built app in a real window, over fake units (see
// src/main/e2e-seam.ts). Run it with `pnpm e2e` from the repo root, never from `pnpm check`.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  // One app at a time: each run owns a window and its own temp folder, and the machine is small.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results',
});
