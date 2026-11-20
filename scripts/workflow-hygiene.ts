// What every job in .github/workflows must say, so CI can neither hang forever nor quietly move
// to a runner that is not the owner's.
import { parse } from 'yaml';

/** The only runner CI may use. The rig is the owner's; never GitHub-hosted. */
export const RUNNER = ['self-hosted', 'linux', 'x64', 'build-rig'] as const;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** One line per way the workflow in `text` breaks the rules; empty when it keeps them all. */
export function workflowProblems(name: string, text: string): string[] {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (error) {
    return [`${name}: is not valid YAML (${error instanceof Error ? error.message : 'unknown'})`];
  }
  const jobs = asRecord(asRecord(doc)?.['jobs']);
  if (jobs === undefined) return [`${name}: has no jobs`];
  const problems: string[] = [];
  for (const [id, raw] of Object.entries(jobs)) {
    const job = asRecord(raw) ?? {};
    const runsOn = job['runs-on'];
    const onRig =
      Array.isArray(runsOn) &&
      runsOn.length === RUNNER.length &&
      RUNNER.every((label) => runsOn.includes(label));
    if (!onRig) {
      problems.push(`${name}: job '${id}' must run on [${RUNNER.join(', ')}]`);
    }
    const timeout = job['timeout-minutes'];
    if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout <= 0) {
      problems.push(`${name}: job '${id}' must set timeout-minutes to a whole number above 0`);
    }
  }
  return problems;
}
