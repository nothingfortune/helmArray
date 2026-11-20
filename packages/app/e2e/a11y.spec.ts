// An axe scan of every state the journeys reach. Serious and critical violations fail the test;
// the failure lists each rule, how many elements, and the first one's selector.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './helm';
import {
  AZERON_APP,
  CLOSE_AZERON_FIRST,
  applyInDrawer,
  drawer,
  keepEveryCheck,
  startFrom,
} from './screens';

// Legacy mode runs axe inside the page itself: the default opens a second page, which an
// Electron window can't give.
async function seriousViolations(page: Page, leaveOut?: string): Promise<string[]> {
  const builder = new AxeBuilder({ page }).setLegacyMode(true);
  if (leaveOut !== undefined) builder.exclude(leaveOut);
  const { violations } = await builder.analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id} (${v.impact}, ${v.nodes.length}): ${v.nodes[0]?.target.join(' ') ?? ''} - ${v.help}`,
    );
}

test.describe('axe: no serious or critical violations', () => {
  test('the Library', async ({ helm }) => {
    await expect(helm.page.getByRole('heading', { name: 'Games' })).toBeVisible();
    // The tile of a game helmArray has no definition for is dimmed: see the next test.
    expect(await seriousViolations(helm.page, '.tile.unsupported')).toEqual([]);
  });

  test('the Library, the dimmed tile of a game that is not supported yet', async ({ helm }) => {
    // KNOWN PROBLEM, found by this suite: the tile is drawn at 0.6 opacity (`.unsupported
    // .cover` in library.css), which takes its "No cover" text to a contrast of 3.0:1, under
    // the 4.5:1 a small text needs. Fixing it changes how the owner's canvas draws that tile, so
    // it is left to them; remove `test.fail` when it is settled.
    test.fail();
    await expect(helm.page.getByRole('heading', { name: 'Games' })).toBeVisible();
    expect(await seriousViolations(helm.page)).toEqual([]);
  });

  test('the Editor, with findings', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await expect(page.getByRole('button', { name: 'Keep, I know' }).first()).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Editor, with no findings', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await keepEveryCheck(page);
    await expect(page.getByText('Nothing to fix.')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Apply drawer, ready', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await keepEveryCheck(page);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(applyInDrawer(page)).toBeEnabled();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Apply drawer, blocked by the Azeron app', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await keepEveryCheck(page);
    await helm.setProcesses([AZERON_APP]);
    await expect(page.getByText(CLOSE_AZERON_FIRST).first()).toBeVisible();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(drawer(page).getByLabel('What is ready')).toContainText(CLOSE_AZERON_FIRST);
    await expect(applyInDrawer(page)).toBeDisabled();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
