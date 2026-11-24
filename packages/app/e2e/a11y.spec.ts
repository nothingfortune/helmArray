// An axe scan of every state the journeys reach. Serious and critical violations fail the test;
// the failure lists each rule, how many elements, and the first one's selector.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './helm';
import {
  applyInDrawer,
  AZERON_APP,
  chooseDevice,
  CLOSE_AZERON_FIRST,
  deviceTab,
  drawer,
  editorApply,
  gameHalf,
  helldivers,
  keepEveryCheck,
  leftUnit,
  schemePicker,
  startFrom,
  startWithChecks,
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
    // Only the cover art is dimmed; the "No cover" text keeps full contrast (it was 3.0:1).
    await expect(helm.page.getByRole('heading', { name: 'Games' })).toBeVisible();
    expect(await seriousViolations(helm.page)).toEqual([]);
  });

  test('the Library has one top-level heading, Games', async ({ helm }) => {
    await expect(helm.page.getByRole('heading', { level: 1, name: 'Games' })).toBeVisible();
    await expect(helm.page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('the Library, with the start-from choices open', async ({ helm }) => {
    const { page } = helm;
    await helldivers(page).click();
    await expect(page.getByRole('button', { name: 'Xbox controller' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Library, with a scheme started and its list of schemes open', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await page.getByRole('button', { name: 'Library' }).click();
    await page.getByRole('button', { name: 'Helldivers 2 schemes' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('Settings, open', async ({ helm }) => {
    const { page } = helm;
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Editor, with the side panel open on a button that has an action', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await leftUnit(page)
      .getByRole('button', { name: /^Interact, / })
      .click();
    await expect(page.getByRole('button', { name: /^Tap/ }).first()).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Editor, with a key label set on a button', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await leftUnit(page)
      .getByRole('button', { name: /^Interact, / })
      .click();
    await page.getByLabel('Key label').fill('Use');
    await page.getByLabel('Key label').press('Enter');
    await expect(page.getByLabel('Key label')).toHaveValue('Use');
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Editor, with the side panel shut by the Inspector button', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await leftUnit(page)
      .getByRole('button', { name: /^Interact, / })
      .click();
    await page.getByRole('button', { name: 'Inspector' }).click();
    await expect(page.getByRole('button', { name: 'Inspector' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Editor, with the side panel open on an empty button', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await leftUnit(page)
      .getByRole('button', { name: /^Empty, middle 2/ })
      .click();
    await expect(page.getByRole('button', { name: /^Tap/ }).first()).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Editor, with the side panel open on the stick', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    // The stick press sits over the stick's own button, so the keyboard selects it.
    await leftUnit(page)
      .getByRole('button', { name: /^Stick/ })
      .press('Enter');
    await expect(page.getByText('The stick sends its four directions.')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Editor, with findings', async ({ helm }) => {
    const { page } = helm;
    await startWithChecks(page);
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Editor, with findings and the side panel open', async ({ helm }) => {
    const { page } = helm;
    await startWithChecks(page);
    // A drop opens the side panel on the button it landed on.
    const action = page.locator('.ed-actions').getByRole('button', { name: 'Throw grenade' });
    await action.dragTo(leftUnit(page).getByRole('button', { name: 'Empty, middle 2' }));
    await expect(page.locator('.ed-panel-title')).toHaveText('Throw grenade');
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
    await editorApply(page).click();
    await expect(applyInDrawer(page)).toBeEnabled();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Apply drawer, blocked by the Azeron app', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await keepEveryCheck(page);
    await helm.setProcesses([AZERON_APP]);
    await expect(page.getByText(CLOSE_AZERON_FIRST).first()).toBeVisible();
    await editorApply(page).click();
    await expect(drawer(page).getByLabel('What is ready')).toContainText(CLOSE_AZERON_FIRST);
    await expect(applyInDrawer(page)).toBeDisabled();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Editor, with the Scheme picker open', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await schemePicker(page).click();
    await expect(page.getByRole('button', { name: 'Copy this one' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Editor, with the Scheme picker asking to confirm a delete', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await schemePicker(page).click();
    await page.getByRole('button', { name: 'Delete this scheme' }).click();
    await expect(page.getByRole('button', { name: 'Keep' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Editor, with the device chooser open', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await page.getByRole('button', { name: 'Devices' }).click();
    await expect(page.getByRole('dialog', { name: 'Devices' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Editor, a left Azeron + mouse setup, with a mouse button selected', async ({
    helm,
  }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await chooseDevice(page, 'Left + mouse');
    await page.getByRole('button', { name: /^Left, / }).click();
    await expect(page.locator('.ed-panel')).toContainText('Mouse · Left button');
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Editor, the Keyboard tab, with a key selected', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await chooseDevice(page, 'Keyboard and mouse');
    await deviceTab(page, 'Keyboard').click();
    await page.getByRole('button', { name: 'R, Reload', exact: true }).click();
    await expect(page.locator('.ed-panel')).toContainText('Keyboard · R');
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Editor, the Controller tab, with a button selected', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await chooseDevice(page, 'Xbox controller');
    await deviceTab(page, 'Controller').click();
    await page.getByRole('button', { name: /^X, / }).click();
    await expect(page.locator('.ed-panel')).toContainText('Controller · X');
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Apply drawer, with the game’s bindings to set', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    const left = leftUnit(page);
    await left
      .getByRole('button', { name: 'Reload, middle 1' })
      .dragTo(left.getByRole('button', { name: 'Empty, middle 2' }));
    await editorApply(page).click();
    await expect(gameHalf(page)).toContainText('Set Reload to Xbox Y');
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('the Apply drawer, after Apply, with the bind sheet', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    const left = leftUnit(page);
    await left
      .getByRole('button', { name: 'Reload, middle 1' })
      .dragTo(left.getByRole('button', { name: 'Empty, middle 2' }));
    await editorApply(page).click();
    await expect(applyInDrawer(page)).toBeEnabled();
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel("Now, in Helldivers 2's controls")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
