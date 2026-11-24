// What the app says is true, in the owner's words (the UI audit of 2026-11-24): the header while
// the Azeron app is open, a drag counted as one change everywhere it is counted, the drawer's rows
// in the game's words, the count after a device is added and after an output round trip, the bind
// sheet kept after the drawer closes, and a game with no scheme yet. Input is Playwright's own,
// into the page.
import type { Page } from '@playwright/test';
import { expect, test } from './helm';
import {
  AZERON_APP,
  CLOSE_AZERON_FIRST,
  applyInDrawer,
  azeronsSend,
  chooseDevice,
  deviceTab,
  drawer,
  editorApply,
  helldivers,
  keepEveryCheck,
  leftUnit,
  pill,
  seriousViolations,
  startFrom,
  unseen,
  walkTabOrder,
} from './screens';

/** Apply from the Editor, to the result, then Close: the scheme is what the units hold. */
async function applyAndClose(page: Page) {
  await editorApply(page).click();
  await expect(applyInDrawer(page)).toBeEnabled();
  await applyInDrawer(page).click();
  await expect(drawer(page).getByLabel('Result')).toContainText('Both units now run the layout.');
  await drawer(page).getByRole('button', { name: 'Close' }).click();
}

test.describe('the header while the Azeron app is open', () => {
  test('keeps both chips, paused, and the pill says the Azeron app is open', async ({ helm }) => {
    const { page } = helm;
    await expect(page.getByLabel('Left, ready')).toBeVisible();
    await helm.setProcesses([AZERON_APP]);

    await expect(page.getByLabel('Left, paused while the Azeron app is open')).toBeVisible();
    await expect(page.getByLabel('Right, paused while the Azeron app is open')).toBeVisible();
    await expect(pill(page)).toHaveText('Azeron app is open');
    await expect(page.getByText('Units not connected')).toHaveCount(0);
    // The warning band under the header says what to do.
    await expect(page.getByText(CLOSE_AZERON_FIRST).first()).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    expect(unseen(await walkTabOrder(page))).toEqual([]);

    await helm.setProcesses([]);
    await expect(page.getByLabel('Left, ready')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Right, ready')).toBeVisible();
  });

  test('the drawer says the units wait for the Azeron app to close', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await helm.setProcesses([AZERON_APP]);
    await expect(pill(page)).toHaveText('Azeron app is open');
    await editorApply(page).click();
    await expect(drawer(page).getByLabel('Left Azeron')).toContainText(
      'Waiting for the Azeron app to close',
    );
    await expect(applyInDrawer(page)).toBeDisabled();
    expect(await seriousViolations(page)).toEqual([]);
  });
});

test.describe('one drag is one change', () => {
  test('the pill, Apply 1, the drawer row, the tile and the card agree, and the keyboard adds nothing', async ({
    helm,
  }) => {
    const { page } = helm;
    await startFrom(page, "Game's own keys");
    await keepEveryCheck(page);
    await applyAndClose(page);
    await expect(pill(page)).toHaveText('In sync');
    await expect(editorApply(page)).toHaveText('Applied');

    // One action from the list onto one empty button: on the unit, that button alone changes.
    await page
      .locator('.ed-actions')
      .getByRole('button', { name: 'Move forward' })
      .dragTo(leftUnit(page).getByRole('button', { name: 'Empty, index 1' }));
    await expect(
      leftUnit(page).getByRole('button', { name: 'Move forward, index 1' }),
    ).toBeVisible();
    await expect(pill(page)).toHaveText('1 change not applied');
    await expect(editorApply(page)).toHaveText('Apply 1');

    await editorApply(page).click();
    await expect(applyInDrawer(page)).toBeEnabled();
    const left = drawer(page).getByLabel('Left Azeron');
    await expect(left).toContainText('1 button');
    await expect(left.locator('.apply-line')).toHaveText(['Index 1 · Move forward · new']);
    await expect(drawer(page).getByLabel('Right Azeron')).toContainText(
      'It already holds this layout.',
    );
    // Only what can fail or needs doing: the Azeron app, and nothing that is merely fine.
    await expect(drawer(page).getByLabel('What is ready').getByRole('listitem')).toHaveText([
      'Ready: The Azeron app is closed.',
    ]);
    expect(await seriousViolations(page)).toEqual([]);
    await drawer(page).getByRole('button', { name: 'Cancel' }).click();

    // The keyboard, with the game's own keys on it, changes nothing anywhere: still one change.
    await chooseDevice(page, 'Keyboard and mouse');
    await expect(deviceTab(page, 'Keyboard')).toHaveAttribute('aria-pressed', 'true');
    await expect(pill(page)).toHaveText('1 change not applied');
    await expect(editorApply(page)).toHaveText('Apply 1');

    await page.getByRole('button', { name: 'Library' }).click();
    await expect(helldivers(page)).toHaveAttribute('aria-label', /1 change · Keys$/);
    await expect(page.getByLabel('On your Azerons now')).toContainText('1 change not applied');
  });

  test('Keys, Controller and back count the same: nothing is lost on the way', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    // Nothing applied yet: each action the scheme puts on a button.
    await expect(pill(page)).toHaveText('15 changes not applied');
    await azeronsSend(page).getByRole('button', { name: 'Keys' }).click();
    await expect(pill(page)).toHaveText('15 changes not applied');
    await azeronsSend(page).getByRole('button', { name: 'Controller' }).click();
    await expect(pill(page)).toHaveText('15 changes not applied');
    await expect(editorApply(page)).toHaveText('Apply 15');
  });
});

test('the bind sheet is still there after Close: a line on the Library card until Done', async ({
  helm,
}) => {
  const { page } = helm;
  await startFrom(page, 'Xbox controller');
  await applyAndClose(page);
  // Reload onto middle 2, which sends Xbox Y: the game is to be told Reload is on Y, by hand.
  const left = leftUnit(page);
  await left
    .getByRole('button', { name: 'Reload, middle 1' })
    .dragTo(left.getByRole('button', { name: 'Empty, middle 2' }));
  await applyAndClose(page);

  await page.getByRole('button', { name: 'Library' }).click();
  const card = page.getByLabel('On your Azerons now');
  await expect(card).toContainText('1 to set in the game');
  await card.getByRole('button', { name: 'Show what to set' }).click();
  await expect(page.getByRole('dialog', { name: "In Helldivers 2's controls" })).toContainText(
    'Set Reload to Xbox Y',
  );
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  expect(unseen(await walkTabOrder(page))).toEqual([]);

  await card.getByRole('button', { name: 'Done, they are set' }).click();
  await expect(card).not.toContainText('to set in the game');
});

test('a game with actions and no scheme says No scheme yet, not Not set up', async ({ helm }) => {
  const { page } = helm;
  // A game added by hand whose action has no key of the game's own: no defaults to start from.
  await page.evaluate(() =>
    (window as unknown as { helm: { saveGame(game: unknown): Promise<void> } }).helm.saveGame({
      id: 'quiet-skies',
      name: 'Quiet Skies',
      modes: [{ id: 'flight', name: 'Flight' }],
      actions: [{ id: 'climb', name: 'Climb', mode: 'flight', role: 'movement', required: false }],
    }),
  );
  await page.getByRole('button', { name: 'Look again' }).click();
  const tile = page.locator('.tile', { hasText: 'Quiet Skies' });
  await expect(tile.locator('.status')).toHaveText('No scheme yet');
  await expect(helldivers(page)).toHaveAttribute('aria-label', /Defaults found · not set up$/);
  // Two games from Steam and one added by hand: not "From Steam".
  await expect(page.locator('.games-head .hint')).toHaveText('3 games · 0 with a scheme');
  await expect(tile.getByRole('button', { name: 'Edit actions: Quiet Skies' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});
