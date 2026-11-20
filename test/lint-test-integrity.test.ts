// Proves the test-integrity lint rules in eslint.config.js are switched on, as errors, for
// every place a test lives. A rule that is configured but off would let the shapes it bans in
// without a sound.
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

async function lint(filePath: string, code: string): Promise<{ rule: string; severity: number }[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => ({
    rule: m.ruleId ?? m.message,
    severity: m.severity,
  }));
}

// The first lint loads the whole ESLint config: about 1.7 s of CPU on a quiet machine and 8 to 40 s
// with sixteen busy loops on twelve cores, which used to fail whichever test went first at 5 s.
// It is paid here, once, in a hook whose timeout only a hang can reach.
beforeAll(async () => {
  await lint('packages/core/src/index.ts', 'export {};\n');
}, 120_000);

const header = "import { expect, it } from 'vitest';\n";

// Spelled in pieces so test/no-disabled-tests.test.ts, which scans this file, does not see them.
const call = (modifier: string): string => ['it', modifier].join('.');

const BAD: [rule: string, body: string][] = [
  ['vitest/expect-expect', "it('x', () => { 1 + 1; });"],
  ['vitest/require-to-throw-message', "it('x', () => { expect(() => f()).toThrow(); });"],
  [
    'vitest/no-conditional-expect',
    "it('x', () => { try { f(); } catch (e) { expect(e).toBeDefined(); } });",
  ],
  ['vitest/valid-expect', "it('x', () => { expect(1, 'a', 'b').toBe(1); });"],
  [
    'vitest/no-identical-title',
    "it('same', () => { expect(1).toBe(1); });\nit('same', () => { expect(2).toBe(2); });",
  ],
  ['vitest/no-focused-tests', `${call('only')}('x', () => { expect(1).toBe(1); });`],
  ['vitest/no-disabled-tests', `${call('skip')}('x', () => { expect(1).toBe(1); });`],
];

// Where a test can live: beside its source in a package, or in the root test folder.
const PLACES = ['packages/core/src/x.test.ts', 'packages/app/src/renderer/x.test.tsx', 'test/x.ts'];

describe('the test-integrity lint rules', () => {
  describe.each(PLACES)('in %s', (place) => {
    it.each(BAD)('%s is an error', async (rule, body) => {
      const found = await lint(place, `${header}${body}\n`);
      expect(found).toContainEqual({ rule, severity: 2 });
    });

    it('lets a test with an ordinary assertion through', async () => {
      const found = await lint(place, `${header}it('x', () => { expect(1).toBe(1); });\n`);
      expect(found).toEqual([]);
    });
  });

  it('allows expect() a failure message, as vitest does (maxArgs is 2, not 1)', async () => {
    const found = await lint(
      'packages/core/src/x.test.ts',
      `${header}it('x', () => { expect(1, 'why').toBe(1); });\n`,
    );
    expect(found).toEqual([]);
  });
});
