// Stryker's copy of scripts/vitest-tmp-setup.ts: the same containment, and the same failure when a
// test leaves something in the run's temp folder, but the folder is made inside the sandbox.
//
// Stryker kills and restarts its test runner whenever a mutant makes a test hang, and a killed
// runner never reaches its teardown. In the real temp folder that left a `helm-test-*` folder
// behind for every restart (74 in one azeron run). Inside the sandbox they go when Stryker removes it.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { containTmp } from './test-tmp-run.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    helmTestTmp: string;
  }
}

export default function setup(project: TestProject): () => void {
  const base = join(process.cwd(), '.tmp-run');
  mkdirSync(base, { recursive: true });
  const { dir, teardown } = containTmp({ base, failOnLeftover: true });
  project.provide('helmTestTmp', dir);
  return () => {
    try {
      teardown();
    } catch (error) {
      process.exitCode = 1;
      throw error;
    }
  };
}
