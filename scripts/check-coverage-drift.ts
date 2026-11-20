/**
 * The coverage floor in `vitest.config.ts` only means something while it sits just under the
 * measured totals. Left behind as coverage rises, it stops catching a slide and becomes
 * decoration, the same as an assertion that cannot fail.
 *
 * This runs in `pnpm check` right after the coverage run and fails when a metric has climbed
 * more than MAX_GAP points above its floor. The remedy is always to RAISE the floor: never to
 * lower coverage, and never to widen MAX_GAP.
 *
 * Usage: node scripts/check-coverage-drift.ts [root]   (root defaults to the repo root)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Points of slack: wide enough that ordinary movement between PRs does not nag, narrow enough
 * that the floor cannot quietly become decoration. */
export const MAX_GAP = 2;
export const METRICS = ['statements', 'branches', 'functions', 'lines'] as const;

export interface DriftResult {
  ok: boolean;
  /** One line per metric, then the verdict. */
  report: string[];
}

/**
 * Compares the measured totals (the text of coverage-summary.json) with the floors in the text
 * of vitest.config.ts. Fails closed: anything it cannot read is a failure, never a pass.
 */
export function checkDrift(summaryText: string, configText: string): DriftResult {
  let summary: unknown;
  try {
    summary = JSON.parse(summaryText);
  } catch {
    return { ok: false, report: ['coverage-drift: the coverage summary is not valid JSON.'] };
  }
  const total = (summary as { total?: Record<string, { pct?: unknown } | undefined> } | null)
    ?.total;
  const thresholds = configText.slice(Math.max(configText.indexOf('thresholds:'), 0));
  const rows: string[] = [];
  const problems: string[] = [];
  let worst = 0;
  for (const metric of METRICS) {
    const measured = total?.[metric]?.pct;
    if (typeof measured !== 'number') {
      problems.push(`coverage-drift: no measured total for ${metric}.`);
      continue;
    }
    const found = new RegExp(String.raw`${metric}:\s*([0-9.]+)`).exec(thresholds);
    if (found === null) {
      problems.push(`coverage-drift: no floor for ${metric} in vitest.config.ts.`);
      continue;
    }
    const floor = Number(found[1]);
    const gap = Number((measured - floor).toFixed(2));
    worst = Math.max(worst, gap);
    const flag = gap > MAX_GAP ? '  <-- raise this' : '';
    rows.push(
      `  ${metric.padEnd(10)} measured ${measured.toFixed(2).padStart(6)}  floor ${floor.toFixed(2).padStart(6)}  gap ${gap.toFixed(2).padStart(5)}${flag}`,
    );
  }
  if (problems.length > 0) return { ok: false, report: [...rows, ...problems] };
  if (worst > MAX_GAP) {
    return {
      ok: false,
      report: [
        ...rows,
        '',
        `coverage-drift: the floor is ${worst.toFixed(2)} points below measured (max ${MAX_GAP}).`,
        'Coverage rose and the floor did not follow, so it no longer catches a slide.',
        'Raise `thresholds` in vitest.config.ts to about 1 point under the measured totals above.',
        'Do NOT widen MAX_GAP: that is the check, not the obstacle.',
      ],
    };
  }
  return {
    ok: true,
    report: [...rows, `coverage-drift OK: every floor is within ${MAX_GAP} points of measured.`],
  };
}

function main(): number {
  const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');
  const summaryPath = join(root, 'coverage', 'coverage-summary.json');
  let summaryText: string;
  try {
    summaryText = readFileSync(summaryPath, 'utf8');
  } catch {
    // Fail closed: this runs after the coverage run, so a missing summary means the reporter is
    // misconfigured, not that everything is fine.
    console.error(`coverage-drift: cannot read ${summaryPath}`);
    console.error('Run `pnpm test:coverage` first: its json-summary reporter writes that file.');
    return 1;
  }
  let configText: string;
  try {
    configText = readFileSync(join(root, 'vitest.config.ts'), 'utf8');
  } catch {
    console.error(`coverage-drift: cannot read ${join(root, 'vitest.config.ts')}`);
    return 1;
  }
  const { ok, report } = checkDrift(summaryText, configText);
  for (const line of report) (ok ? console.log : console.error)(line);
  return ok ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
