import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workflowProblems } from '../scripts/workflow-hygiene';

const dir = resolve(__dirname, '..', '.github', 'workflows');
// No folder yet is no workflows yet: nothing to check, and the checker's own tests still run.
const files = existsSync(dir) ? readdirSync(dir).filter((name) => /\.ya?ml$/.test(name)) : [];

// A job that keeps the rules, for the planted bad ones to differ from.
const good = `
on: push
jobs:
  check:
    runs-on: [self-hosted, linux, x64, build-rig]
    timeout-minutes: 20
    steps:
      - run: pnpm check
`;

describe('the workflows in .github/workflows', () => {
  it.each(files)('%s: every job is on the build rig and has a timeout', (file) => {
    expect(workflowProblems(file, readFileSync(join(dir, file), 'utf8'))).toEqual([]);
  });
});

describe('workflowProblems', () => {
  it('accepts a job on the rig with a timeout', () => {
    expect(workflowProblems('ok.yml', good)).toEqual([]);
  });

  it('accepts the runner labels in any order', () => {
    const text = good.replace(
      '[self-hosted, linux, x64, build-rig]',
      '[build-rig, x64, linux, self-hosted]',
    );
    expect(workflowProblems('ok.yml', text)).toEqual([]);
  });

  it('refuses a job with no timeout-minutes', () => {
    const text = good.replace('    timeout-minutes: 20\n', '');
    expect(workflowProblems('bad.yml', text)).toEqual([
      "bad.yml: job 'check' must set timeout-minutes to a whole number above 0",
    ]);
  });

  it.each(['0', '-5', '"20"', '2.5', '${{ inputs.minutes }}'])(
    'refuses timeout-minutes of %s',
    (value) => {
      const text = good.replace('timeout-minutes: 20', `timeout-minutes: ${value}`);
      expect(workflowProblems('bad.yml', text)).toHaveLength(1);
    },
  );

  it.each([
    'ubuntu-latest',
    '[ubuntu-latest]',
    '[self-hosted, linux, x64]',
    '[self-hosted, linux, x64, build-rig, extra]',
    '${{ matrix.os }}',
  ])('refuses runs-on of %s', (value) => {
    const text = good.replace('[self-hosted, linux, x64, build-rig]', value);
    expect(workflowProblems('bad.yml', text)).toEqual([
      "bad.yml: job 'check' must run on [self-hosted, linux, x64, build-rig]",
    ]);
  });

  it('refuses a job with no runs-on, such as one that calls a reusable workflow', () => {
    const text = `jobs:\n  call:\n    uses: ./.github/workflows/other.yml\n    timeout-minutes: 5\n`;
    expect(workflowProblems('bad.yml', text)).toEqual([
      "bad.yml: job 'call' must run on [self-hosted, linux, x64, build-rig]",
    ]);
  });

  it('names the bad job when only one of two is bad', () => {
    const text = `${good}  lint:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n`;
    expect(workflowProblems('bad.yml', text)).toEqual([
      "bad.yml: job 'lint' must run on [self-hosted, linux, x64, build-rig]",
    ]);
  });

  it('reports both faults of a job that has both', () => {
    const text = 'jobs:\n  check:\n    runs-on: ubuntu-latest\n';
    expect(workflowProblems('bad.yml', text)).toHaveLength(2);
  });

  it('refuses a workflow with no jobs', () => {
    expect(workflowProblems('bad.yml', 'on: push\n')).toEqual(['bad.yml: has no jobs']);
  });

  it('refuses YAML that does not parse', () => {
    expect(workflowProblems('bad.yml', 'jobs: [unclosed')[0]).toMatch(
      /^bad\.yml: is not valid YAML/,
    );
  });
});
