import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_GAP, checkDrift } from '../scripts/check-coverage-drift';

const summary = (s: number, b: number, f: number, l: number): string =>
  JSON.stringify({
    total: {
      statements: { pct: s },
      branches: { pct: b },
      functions: { pct: f },
      lines: { pct: l },
    },
  });
const config = (s: number, b: number, f: number, l: number): string =>
  `export default { test: { coverage: { thresholds: {\n statements: ${s},\n branches: ${b},\n functions: ${f},\n lines: ${l},\n } } } };`;

describe('checkDrift', () => {
  it('passes when every floor is within the allowed gap under measured', () => {
    expect(checkDrift(summary(87.4, 80.1, 81.1, 88), config(86, 79, 80, 87)).ok).toBe(true);
  });

  it('passes with a gap of exactly the maximum', () => {
    expect(checkDrift(summary(90, 90, 90, 90), config(88, 88, 88, 88)).ok).toBe(true);
  });

  it('fails when one metric is further above its floor than the maximum', () => {
    const result = checkDrift(summary(90.1, 90, 90, 90), config(88, 88, 88, 88));
    expect(result.ok).toBe(false);
  });

  it('says which metric to raise, and that the gap is not what to widen', () => {
    const { report } = checkDrift(summary(90, 90, 95, 90), config(88, 88, 88, 88));
    const text = report.join('\n');
    expect(text).toMatch(
      /functions\s+measured\s+95\.00\s+floor\s+88\.00\s+gap\s+7\.00\s+<-- raise this/,
    );
    expect(text).toContain('Do NOT widen MAX_GAP');
  });

  it('does not flag a metric that is on its floor or under it: vitest refuses that itself', () => {
    expect(checkDrift(summary(85, 85, 85, 85), config(86, 86, 86, 86)).ok).toBe(true);
  });

  it('fails closed on a summary that is not JSON', () => {
    expect(checkDrift('not json', config(1, 1, 1, 1)).ok).toBe(false);
  });

  it('fails closed on a summary with no totals', () => {
    expect(checkDrift('{}', config(1, 1, 1, 1)).ok).toBe(false);
  });

  it('fails closed when one metric has no measured total', () => {
    const partial = JSON.stringify({ total: { statements: { pct: 90 } } });
    const { ok, report } = checkDrift(partial, config(88, 88, 88, 88));
    expect({
      ok,
      names: report.some((line) => line.includes('no measured total for branches')),
    }).toEqual({
      ok: false,
      names: true,
    });
  });

  it('fails closed when the config states no floor for a metric', () => {
    const { ok, report } = checkDrift(
      summary(90, 90, 90, 90),
      'thresholds: { statements: 88, functions: 88, lines: 88 }',
    );
    expect({ ok, names: report.some((line) => line.includes('no floor for branches')) }).toEqual({
      ok: false,
      names: true,
    });
  });

  it('fails closed when the config has no thresholds at all', () => {
    expect(checkDrift(summary(90, 90, 90, 90), 'export default {};').ok).toBe(false);
  });

  it('allows a gap of 2 points', () => {
    expect(MAX_GAP).toBe(2);
  });
});

describe('the script', () => {
  const script = resolve(__dirname, '..', 'scripts', 'check-coverage-drift.ts');
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'coverage-drift-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const run = () =>
    spawnSync(process.execPath, [script, root], { encoding: 'utf8', timeout: 30_000 });
  const plant = (measured: string, floors: string) => {
    mkdirSync(join(root, 'coverage'));
    writeFileSync(join(root, 'coverage', 'coverage-summary.json'), measured);
    writeFileSync(join(root, 'vitest.config.ts'), floors);
  };

  it('fails closed when the coverage run wrote no summary', () => {
    writeFileSync(join(root, 'vitest.config.ts'), config(1, 1, 1, 1));
    const result = run();
    expect({ status: result.status, said: result.stderr.includes('cannot read') }).toEqual({
      status: 1,
      said: true,
    });
  });

  it('exits 0 when the floors follow the measured totals', () => {
    plant(summary(90, 90, 90, 90), config(89, 89, 89, 89));
    expect(run().status).toBe(0);
  });

  it('exits 1 when a floor has been left behind', () => {
    plant(summary(90, 90, 90, 90), config(80, 89, 89, 89));
    expect(run().status).toBe(1);
  });
});
