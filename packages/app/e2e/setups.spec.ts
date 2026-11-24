// Setups, the owner's model (docs/plans/04-roadmap.md, M4.5 "Done when"), in the real window over
// the fake units: J1 and J2 on Azerons as a controller, a left Azeron + mouse setup, a keyboard-only
// setup, and switching between two setups of one game. Input is Playwright's own, into the page.
import type { Page } from '@playwright/test';
import type { Helm } from './helm';
import { expect, test } from './helm';
import {
  applyInDrawer,
  azeronsSend,
  chooseDevice,
  deviceTab,
  drawer,
  gameHalf,
  helldivers,
  leftUnit,
  pill,
  schemePicker,
  startFrom,
} from './screens';

/** Apply, from the editor's button to the result; the drawer is left open. */
async function applyAndWait(page: Page, result: string | RegExp) {
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(applyInDrawer(page)).toBeEnabled();
  await applyInDrawer(page).click();
  await expect(drawer(page).getByLabel('Result')).toContainText(result);
}

const slotNames = async (helm: Helm) => (await helm.units()).map((u) => u.slots.map((s) => s.name));

test.describe('setups', () => {
  test('J1: Helldivers 2 as a controller is two clicks, and Apply writes both units', async ({
    helm,
  }) => {
    const { page } = helm;
    // Click 1, the game; click 2, the default.
    await helldivers(page).click();
    await page.getByRole('button', { name: 'Xbox controller' }).click();
    await expect(page.getByRole('heading', { name: 'Helldivers 2' })).toBeVisible();
    await expect(azeronsSend(page).getByRole('button', { name: 'Controller' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(deviceTab(page, 'Azerons')).toHaveAttribute('aria-pressed', 'true');
    await applyAndWait(page, 'Both units now run the layout.');
    await expect.poll(() => slotNames(helm)).toEqual([['Xbox controller'], ['Xbox controller']]);
    await expect(pill(page)).toHaveText('In sync');
  });

  test('J2: Reload dragged to another Azeron button lists the unit write and the game binding', async ({
    helm,
  }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    // Applied once, so what the second Apply writes is the drag's doing.
    await applyAndWait(page, 'Both units now run the layout.');
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    await expect(pill(page)).toHaveText('In sync');
    const before = await helm.units();

    // Reload is on the left middle 1 (Xbox X); middle 2 sends Y with nothing on it.
    const left = leftUnit(page);
    await left
      .getByRole('button', { name: 'Reload, middle 1' })
      .dragTo(left.getByRole('button', { name: 'Empty, middle 2' }));
    await expect(left.getByRole('button', { name: 'Reload, middle 2' })).toBeVisible();
    await expect(page.locator('.ed-panel-title')).toHaveText('Reload');
    await expect(page.getByRole('combobox')).toHaveValue('Y');

    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(applyInDrawer(page)).toBeEnabled();
    await expect(drawer(page).getByLabel('Left Azeron')).toContainText('is written');
    await expect(drawer(page).getByLabel('Right Azeron')).toContainText(
      'It already holds this layout.',
    );
    await expect(gameHalf(page)).toContainText('Set Reload to Xbox Y');
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel('Result')).toContainText('Both units');
    // After Apply the binding is what is left to set by hand: the bind sheet.
    await expect(drawer(page).getByLabel("Now, in Helldivers 2's controls")).toContainText(
      'Set Reload to Xbox Y',
    );
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    await expect(pill(page)).toHaveText('In sync');

    const after = await helm.units();
    // The left unit was written again; the right unit, which held its layout already, was not.
    expect([
      (after[0]?.writesReceived ?? 0) > (before[0]?.writesReceived ?? 0),
      after[1]?.writesReceived,
      after[1]?.slots,
    ]).toEqual([true, before[1]?.writesReceived, before[1]?.slots]);
  });

  test('an action on a long press only is dragged to another button, and moves', async ({
    helm,
  }) => {
    const { page } = helm;
    await startFrom(page, "Game's own keys");
    const left = leftUnit(page);
    // Throw grenade on the left index 2's long press, nothing on its tap.
    await left.getByRole('button', { name: 'Empty, index 2' }).click();
    await page.locator('.ed-panel').getByRole('button', { name: /^Long/ }).click();
    await page.locator('.ed-actions').getByRole('button', { name: 'Throw grenade' }).click();
    const from = left.getByRole('button', { name: 'Long: Throw grenade, index 2' });
    await expect(from).toBeVisible();

    await from.dragTo(left.getByRole('button', { name: 'Empty, index 3' }));
    await expect(left.getByRole('button', { name: 'Throw grenade, index 3' })).toBeVisible();
    await expect(left.getByRole('button', { name: 'Empty, index 2' })).toBeVisible();
  });

  test('switching to Controller with a long press targeted puts the next action on the tap', async ({
    helm,
  }) => {
    const { page } = helm;
    await startFrom(page, "Game's own keys");
    const left = leftUnit(page);
    await left.getByRole('button', { name: 'Empty, index 2' }).click();
    await page.locator('.ed-panel').getByRole('button', { name: /^Long/ }).click();
    await expect(page.locator('.ed-panel').getByRole('button', { name: /^Long/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await azeronsSend(page).getByRole('button', { name: 'Controller' }).click();
    await page.locator('.ed-actions').getByRole('button', { name: 'Throw grenade' }).click();

    // On the tap, which a controller button sends: not on a long press that would send nothing.
    await expect(left.getByRole('button', { name: 'Throw grenade, index 2' })).toBeVisible();
    await expect(page.locator('.ed-panel').getByRole('button', { name: /^Tap/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText(/sends nothing/)).toHaveCount(0);
  });

  test('the card still names what the units hold after that scheme is edited to drop its Azerons', async ({
    helm,
  }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await applyAndWait(page, 'Both units now run the layout.');
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    // Edited, not applied: the units still hold the controller layout.
    await chooseDevice(page, 'Keyboard and mouse');
    await chooseDevice(page, 'None');
    await expect(deviceTab(page, 'Azerons')).toHaveCount(0);

    await page.getByRole('button', { name: 'Library' }).click();
    const card = page.getByLabel('On your Azerons now');
    await expect(card).toContainText('HELLDIVERS™ 2 · Xbox controller');
    await expect(card).toContainText('Applied · Controller');
  });

  test('an action cleared off the mouse beside the left unit goes back on it in two clicks', async ({
    helm,
  }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await chooseDevice(page, 'Left + mouse');
    const mouse = page.getByRole('group', { name: 'Mouse' });
    await mouse.getByRole('button', { name: 'Left, Fire' }).click();
    await page.locator('.ed-panel').getByRole('button', { name: 'Clear tap' }).click();
    await expect(mouse.getByRole('button', { name: 'Left, Not used' })).toBeVisible();
    // The mouse is still selected (click 1); Fire is offered for it, among the mouse's actions.
    await page.locator('.ed-actions').getByRole('button', { name: 'Fire', exact: true }).click();
    await expect(mouse.getByRole('button', { name: 'Left, Fire' })).toBeVisible();
  });

  test('a left Azeron + mouse setup writes the left unit only', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await chooseDevice(page, 'Left + mouse');
    // The right unit is not drawn; the mouse is, where it was.
    await expect(page.locator('.unit[data-hand="right"]')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Mouse' })).toBeVisible();
    const right = (await helm.units())[1];

    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(applyInDrawer(page)).toBeEnabled();
    await expect(drawer(page).getByLabel('Right Azeron')).toHaveCount(0);
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel('Result')).toContainText(
      'The left unit now runs the layout.',
    );
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    await expect(pill(page)).toHaveText('In sync');

    const [leftAfter, rightAfter] = await helm.units();
    expect(leftAfter?.slots.map((s) => s.name)).toEqual(['Xbox controller']);
    // The right unit: the same slots, running the same one, and not one command that changes it.
    // (Its raw report count moves: the app asks every unit which slot it runs every few seconds,
    // and reads each before an Apply.)
    expect([rightAfter?.slots, rightAfter?.running, rightAfter?.writesReceived]).toEqual([
      right?.slots,
      right?.running,
      right?.writesReceived,
    ]);
  });

  test('a keyboard-only setup: a drag onto a key is a game row, with no unit and no Azeron app', async ({
    helm,
  }) => {
    const { page } = helm;
    await startFrom(page, "Game's own keys");
    await chooseDevice(page, 'Keyboard and mouse');
    await chooseDevice(page, 'None');
    await expect(deviceTab(page, 'Keyboard')).toHaveAttribute('aria-pressed', 'true');
    await expect(azeronsSend(page)).toHaveCount(0);
    const before = await helm.units();

    // The keyboard starts from the game's own keys: Reload on R. It moves to T.
    const keyboard = page.getByRole('group', { name: 'Keyboard' });
    await keyboard
      .getByRole('button', { name: 'R, Reload', exact: true })
      .dragTo(keyboard.getByRole('button', { name: 'T, not used', exact: true }));
    await expect(keyboard.getByRole('button', { name: 'T, Reload', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(applyInDrawer(page)).toBeEnabled();
    await expect(gameHalf(page)).toContainText('Set Reload to T');
    await expect(drawer(page).getByLabel('Left Azeron')).toHaveCount(0);
    await expect(drawer(page).getByLabel('Right Azeron')).toHaveCount(0);
    await expect(drawer(page).getByLabel('What is ready')).not.toContainText('Azeron app');
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel('Result')).toContainText('uses no Azeron');
    await expect(drawer(page).getByLabel("Now, in Helldivers 2's controls")).toContainText(
      'Set Reload to T',
    );
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    // No unit to judge, and nothing left to apply.
    await expect(pill(page)).toHaveText('In sync');

    const after = await helm.units();
    expect(after.map((u) => [u.slots, u.writesReceived])).toEqual(
      before.map((u) => [u.slots, u.writesReceived]),
    );
  });

  test('switching to another setup and applying it changes the units', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await applyAndWait(page, 'Both units now run the layout.');
    await drawer(page).getByRole('button', { name: 'Close' }).click();

    // A second setup: a copy (two clicks), whose Azerons send keys.
    await schemePicker(page).click();
    await page.getByRole('button', { name: 'Copy this one' }).click();
    await expect(schemePicker(page)).toHaveText(/Scheme: Xbox controller copy/);
    await azeronsSend(page).getByRole('button', { name: 'Keys' }).click();
    await expect(pill(page)).not.toHaveText('In sync');
    await applyAndWait(page, 'Both units now run the layout.');
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    // A unit keeps 19 characters of a name.
    await expect
      .poll(() => slotNames(helm))
      .toEqual([['Xbox controller cop'], ['Xbox controller cop']]);
    await expect(pill(page)).toHaveText('In sync');

    // Back to the first: two clicks, then Apply.
    await schemePicker(page).click();
    await page
      .getByRole('group', { name: 'Helldivers 2' })
      .getByRole('button', { name: 'Xbox controller', exact: true })
      .click();
    await expect(schemePicker(page)).toHaveText(/^Scheme: Xbox controller$/);
    await expect(azeronsSend(page).getByRole('button', { name: 'Controller' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await applyAndWait(page, 'Both units now run the layout.');
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    await expect.poll(() => slotNames(helm)).toEqual([['Xbox controller'], ['Xbox controller']]);
    await expect(pill(page)).toHaveText('In sync');

    // The Library says which setup the game holds, and lists both to pick from.
    await page.getByRole('button', { name: 'Library' }).click();
    await expect(page.locator('.tile', { hasText: 'HELLDIVERS' }).locator('.status')).toHaveText(
      'On the units · Xbox controller',
    );

    // From the Library, the other setup is two clicks: the game's list, then the setup.
    await page.getByRole('button', { name: /^HELLDIVERS.* schemes$/ }).click();
    await page
      .getByRole('dialog', { name: /schemes$/ })
      .getByRole('button', { name: /^Xbox controller copy/ })
      .click();
    await expect(schemePicker(page)).toHaveText(/^Scheme: Xbox controller copy$/);
    await expect(azeronsSend(page).getByRole('button', { name: 'Keys' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
