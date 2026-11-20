// Vitest globalSetup: runs before any worker starts, so every test's os.tmpdir() resolves
// inside this run's folder. The run fails if a test leaves anything in it.
import type { TestProject } from 'vitest/node';
import { containTmp } from './test-tmp-run.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    helmTestTmp: string;
  }
}

export default function setup(project: TestProject): () => void {
  const { dir, teardown } = containTmp({ failOnLeftover: true });
  project.provide('helmTestTmp', dir);
  return () => {
    try {
      teardown();
    } catch (error) {
      // Vitest only logs an error thrown in teardown and still exits 0, so the run fails itself.
      process.exitCode = 1;
      throw error;
    }
  };
}
