// A game's modes as tabs above the units, in the real window, on Elite (its 14 modes read from the
// player's own .binds, a copy of reference/game-files in the run folder): J4 counted, one button
// doing a job in the ship and another on foot on one key, the file bound to match in each mode;
// the tabs from the keyboard; axe with them showing. The layout with them is layout.spec.ts. Input
// is Playwright's own, into the page.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './helm';
import {
  applyInDrawer,
  countInput,
  drawer,
  editorApply,
  eliteBinds,
  eliteSeed,
  leftUnit,
  modeTabs,
  seriousViolations,
  startElite,
  startFrom,
  unseen,
  walkTabOrder,
} from './screens';

/** The units' code for L: 0xF000 | its HID usage (packages/azeron `UNIT_KEY_CODES`). */
const KEY_L = 0xf00f;

/** What the player's .binds binds an action to: each of its slots' device and key. */
async function boundIn(dataDir: string, action: string): Promise<string[]> {
  const binds = await readFile(join(eliteBinds(dataDir), 'Custom.4.1.binds'), 'utf8');
  const block = new RegExp(`<${action}>[^]*?</${action}>`).exec(binds)?.[0] ?? '';
  return [...block.matchAll(/<(Primary|Secondary) Device="([^"]*)" Key="([^"]*)"/g)].map(
    (m) => `${m[2] ?? ''} ${m[3] ?? ''}`,
  );
}

test.describe('the mode tabs on Elite', () => {
  test.use({ helmSeed: eliteSeed });

  test('J4 is J2 with a mode tab: the tab, a drag, Apply, the drawer’s Apply', async ({ helm }) => {
    const { page } = helm;
    await startElite(page, "Game's own keys");
    // In the ship the left index 5 lowers the landing gear, on L as the game ships it.
    const index5 = (name: string) =>
      leftUnit(page).getByRole('button', { name: `${name}, index 5` });
    await expect(index5('Landing gear toggle')).toBeVisible();

    const counted = await countInput(page);
    await page.getByRole('tab', { name: 'On foot' }).click();
    await page
      .locator('.ed-actions')
      .getByRole('button', { name: 'Jump', exact: true })
      .dragTo(index5('Empty'));
    await expect(index5('Jump')).toBeVisible();
    await editorApply(page).click();
    await expect(applyInDrawer(page)).toBeEnabled();
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel('Result')).toContainText('Both units now run the layout.');
    await expect(drawer(page).getByLabel('Result')).toContainText(
      "Elite Dangerous now has the scheme's controls",
    );
    expect(await counted()).toEqual({ clicks: 3, drags: 1 });

    // One key on that button, whatever the mode: L. The ship still lowers the gear with it, and
    // on foot the game now jumps with it too, beside the pad's own A.
    const [left] = await helm.units();
    const running = left?.slots.find((s) => s.slot === left.running);
    expect({
      sendingL: running?.taps.filter((t) => t.keys.includes(KEY_L)).length,
      gear: await boundIn(helm.dataDir, 'LandingGearToggle'),
      jump: await boundIn(helm.dataDir, 'HumanoidJumpButton'),
    }).toEqual({
      sendingL: 1,
      gear: ['Keyboard Key_L', '{NoDevice} '],
      jump: ['28DE11FF GamePad_FaceDown', 'Keyboard Key_L'],
    });
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('tab', { name: 'Ship' }).click();
    await expect(index5('Landing gear toggle')).toBeVisible();
  });

  test('a tab shows its mode: its buttons and its actions on none, as the tab’s panel', async ({
    helm,
  }) => {
    const { page } = helm;
    await startElite(page, "Game's own keys");
    const side = page.getByRole('complementary', { name: 'Button and actions' });
    await expect(side).toContainText('Not on a button · Ship');
    await page.getByRole('tab', { name: 'On foot' }).click();
    await expect(page.getByRole('tab', { name: 'On foot' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(side).toContainText('Not on a button · On foot');
    await expect(
      side.locator('.ed-actions').getByRole('button', { name: 'Jump', exact: true }),
    ).toBeVisible();
    // The ship's gear is not on foot's index 5; what the tabs show is a tabpanel named by the tab.
    await expect(leftUnit(page).getByRole('button', { name: 'Empty, index 5' })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: 'On foot' })).toBeVisible();
  });

  test('moving to another tab shuts what was open for the last one: the action picker', async ({
    helm,
  }) => {
    const { page } = helm;
    await startElite(page, "Game's own keys");
    await leftUnit(page).getByRole('button', { name: 'Landing gear toggle, index 5' }).click();
    await page.getByRole('button', { name: 'Change tap' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose an action' });
    await expect(picker).toBeVisible();
    await page.getByRole('tab', { name: 'SRV' }).click();
    await expect(picker).toHaveCount(0);
  });

  test('the keyboard: one Tab stop, the arrows, Home and End, the focus seen', async ({ helm }) => {
    const { page } = helm;
    await startElite(page, "Game's own keys");
    const tab = (name: string) => page.getByRole('tab', { name, exact: true });
    const names = await modeTabs(page).getByRole('tab').allTextContents();
    expect([names.length, names[0], names[3], names.at(-1)]).toEqual([
      14,
      'Ship',
      'On foot',
      'Everywhere',
    ]);

    // The tabs are one stop in the Tab order: the mode shown. Its focus can be seen.
    const stops = await walkTabOrder(page);
    const tabStops = stops.filter((s) => names.includes(s.label));
    expect([tabStops.map((s) => s.label), unseen(tabStops)]).toEqual([['Ship'], []]);

    await tab('Ship').focus();
    const at = async () =>
      page.evaluate(() => {
        const el = document.activeElement;
        return [el?.textContent ?? '', el?.getAttribute('aria-selected') ?? ''];
      });
    const walk: string[][] = [];
    for (const key of ['ArrowRight', 'ArrowRight', 'End', 'ArrowRight', 'ArrowLeft', 'Home']) {
      await page.keyboard.press(key);
      walk.push([key, ...(await at())]);
    }
    await page.keyboard.press('ArrowLeft');
    walk.push(['ArrowLeft', ...(await at())]);
    expect(walk).toEqual([
      ['ArrowRight', 'Landing', 'true'],
      ['ArrowRight', 'SRV', 'true'],
      ['End', 'Everywhere', 'true'],
      // Round from the last to the first, and back.
      ['ArrowRight', 'Ship', 'true'],
      ['ArrowLeft', 'Everywhere', 'true'],
      ['Home', 'Ship', 'true'],
      ['ArrowLeft', 'Everywhere', 'true'],
    ]);
    // The mode gone to by key is the mode shown.
    await expect(page.getByRole('complementary', { name: 'Button and actions' })).toContainText(
      'Not on a button · Everywhere',
    );
    await expect(tab('Everywhere')).toBeFocused();
    // The focus ring is drawn on a tab reached by key.
    const ring = await tab('Everywhere').evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(ring).toBe('solid');
  });

  test('axe finds nothing serious with the tabs showing, on two of them', async ({ helm }) => {
    const { page } = helm;
    await startElite(page, "Game's own keys");
    const ship = await seriousViolations(page);
    await page.getByRole('tab', { name: 'On foot' }).click();
    await leftUnit(page).getByRole('button', { name: 'Empty, index 5' }).click();
    expect({ ship, foot: await seriousViolations(page) }).toEqual({ ship: [], foot: [] });
  });
});

test.describe('a game of one mode', () => {
  test('shows no mode tabs', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await expect(page.getByRole('heading', { name: 'Helldivers 2' })).toBeVisible();
    expect([await modeTabs(page).count(), await page.getByRole('tab').count()]).toEqual([0, 0]);
  });
});
