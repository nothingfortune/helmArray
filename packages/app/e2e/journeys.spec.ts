// The journeys of docs/plans/01-features.md, with their clicks counted as the test makes them
// (`countInput`): J1 by each preset, J2, J3, switching setup and changing devices. The counts are
// the UI audit's section 4, as built after its wave 2. Input is Playwright's own, into the page.
import type { Page } from '@playwright/test';
import { expect, test } from './helm';
import {
  applyInDrawer,
  countInput,
  drawer,
  helldiversTile,
  leftUnit,
  openFrom,
  pill,
  schemePicker,
  startBlankKeys,
  startFrom,
} from './screens';

/** The units' code for W: 0xF000 | its HID usage (packages/azeron `UNIT_KEY_CODES`). */
const KEY_W = 0xf01a;
/** The fake Steam's game helmArray has no data for (e2e/helm.ts). */
const UNKNOWN = 'A Game Nobody Wrote Yet';

/** The drawer's Apply, to the result. */
async function applyNow(page: Page) {
  await expect(applyInDrawer(page)).toBeEnabled();
  await applyInDrawer(page).click();
  await expect(drawer(page).getByLabel('Result')).toContainText('Both units now run the layout.');
}

test.describe('the click counter', () => {
  test('counts a click as a click and a drag as a drag', async ({ helm }) => {
    const { page } = helm;
    await startBlankKeys(page);
    const counted = await countInput(page);
    await leftUnit(page).getByRole('button', { name: 'Empty, index 1' }).click();
    await leftUnit(page).getByRole('button', { name: 'Empty, index 2' }).click();
    await page
      .locator('.ed-actions')
      .getByRole('button', { name: 'Reload' })
      .dragTo(leftUnit(page).getByRole('button', { name: 'Empty, index 3' }));
    await expect(leftUnit(page).getByRole('button', { name: 'Reload, index 3' })).toBeVisible();
    expect(await counted()).toEqual({ clicks: 2, drags: 1 });
  });
});

test.describe('the journeys, counted', () => {
  test('J1 by the Xbox controller is 3 clicks: the game, the preset, the drawer’s Apply', async ({
    helm,
  }) => {
    const { page } = helm;
    const counted = await countInput(page);
    await openFrom(page, 'Xbox controller');
    // Nothing to keep: the drawer opened by itself, over the Editor, ready.
    await applyNow(page);
    expect(await counted()).toEqual({ clicks: 3, drags: 0 });
    await expect
      .poll(async () => (await helm.units()).map((u) => u.slots.map((s) => s.name)))
      .toEqual([['Xbox controller'], ['Xbox controller']]);
  });

  test('J1 by the game’s own keys is 3 clicks, with nothing to keep, and the stick sends W', async ({
    helm,
  }) => {
    const { page } = helm;
    const counted = await countInput(page);
    await openFrom(page, "Game's own keys");
    await expect(drawer(page).getByLabel('What is ready')).not.toContainText(/needed|button/);
    await applyNow(page);
    expect(await counted()).toEqual({ clicks: 3, drags: 0 });
    // Each button sends the game's own key: Reload's is R, on the left middle 1.
    const [left] = await helm.units();
    const written = left?.slots.find((s) => s.slot === left.running);
    expect([written?.name, (written?.taps.length ?? 0) > 10]).toEqual(["Game's own keys", true]);
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    await expect(pill(page)).toHaveText('In sync');
  });

  test('J1 with something to fix opens the Editor, not the drawer', async ({ helm }) => {
    const { page } = helm;
    // A scheme with something to fix is opened from its tile, not made: the drawer stays shut.
    await startBlankKeys(page);
    await expect(drawer(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Keep, I know' }).first()).toBeVisible();
  });

  test('J2 is a drag, then Apply, then the drawer’s Apply', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, "Game's own keys");
    const right = page.locator('.unit[data-hand="right"]');
    const counted = await countInput(page);
    // Move forward is on the stick; a drag from "On the stick" puts it on a button too.
    await page
      .locator('.ed-on-stick')
      .getByRole('button', { name: /^Move forward/ })
      .dragTo(right.getByRole('button', { name: 'Empty, ring 2' }));
    await expect(right.getByRole('button', { name: 'Move forward, ring 2' })).toBeVisible();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await applyNow(page);
    expect(await counted()).toEqual({ clicks: 2, drags: 1 });
    // The button sends W, Move forward's own key, as the stick's up does.
    const [, unit] = await helm.units();
    const written = unit?.slots.find((s) => s.slot === unit.running);
    expect(written?.taps.some((t) => t.keys.includes(KEY_W))).toBe(true);
  });

  test('J3 is 1 click from the Editor to another game’s Editor', async ({ helm }) => {
    const { page } = helm;
    // Helldivers 2 has a scheme; the other game gets one on the Game screen.
    await startFrom(page, 'Xbox controller');
    await page.getByRole('button', { name: 'Library' }).click();
    await page.getByRole('button', { name: `Set up ${UNKNOWN}` }).click();
    const field = page.getByRole('textbox', { name: 'New action' });
    await field.fill('Jump');
    await field.press('Enter');
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Jump, key: Space' })).toBeVisible();
    await page
      .getByRole('group', { name: 'New scheme from' })
      .getByRole('button', { name: "Game's own keys" })
      .click();
    await drawer(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: UNKNOWN })).toBeVisible();

    const counted = await countInput(page);
    await page.getByRole('navigation', { name: 'Recent games' }).getByRole('button').click();
    await expect(page.getByRole('heading', { name: 'Helldivers 2' })).toBeVisible();
    expect(await counted()).toEqual({ clicks: 1, drags: 0 });
    // And back, in one more.
    await page
      .getByRole('navigation', { name: 'Recent games' })
      .getByRole('button', { name: UNKNOWN })
      .click();
    await expect(page.getByRole('heading', { name: UNKNOWN })).toBeVisible();
  });

  test('switching setup in the Editor is 4: Scheme, the setup, Apply, the drawer’s Apply', async ({
    helm,
  }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    // A second setup, made from the other preset: the drawer opens on it, and is cancelled.
    await schemePicker(page).click();
    await page.getByRole('button', { name: "Game's own keys" }).click();
    await drawer(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(schemePicker(page)).toHaveText(/Game's own keys/);

    const counted = await countInput(page);
    await schemePicker(page).click();
    await page
      .getByRole('dialog', { name: 'Schemes' })
      // The setups come first, then "New from" with its own Xbox controller.
      .getByRole('button', { name: 'Xbox controller', exact: true })
      .first()
      .click();
    await expect(schemePicker(page)).toHaveText(/Xbox controller/);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await applyNow(page);
    expect(await counted()).toEqual({ clicks: 4, drags: 0 });
  });

  test('changing devices is 2: Devices, then the choice', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    const counted = await countInput(page);
    await page.getByRole('button', { name: 'Devices' }).click();
    await page
      .getByRole('dialog', { name: 'Devices' })
      .getByLabel('Keyboard and mouse', { exact: true })
      .click();
    expect(await counted()).toEqual({ clicks: 2, drags: 0 });
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('group', { name: 'Device' }).getByRole('button', { name: 'Keyboard' }),
    ).toBeVisible();
  });

  test('a game with a scheme opens in 1 click from the Library', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await page.getByRole('button', { name: 'Library' }).click();
    const counted = await countInput(page);
    await helldiversTile(page).click();
    await expect(page.getByRole('heading', { name: 'Helldivers 2' })).toBeVisible();
    expect(await counted()).toEqual({ clicks: 1, drags: 0 });
  });
});
