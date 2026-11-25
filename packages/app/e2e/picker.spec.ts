// The action picker (canvas board docs/design/canvas/EditorPicker.dc.html): "Add" or "Change" on a
// press opens it over the side panel. Search, the role chips, the two groups, Enter and the arrows,
// a drag from a row, Esc, a two-mode game, the keyboard and axe. Input is Playwright's, into the page.
import type { Page } from '@playwright/test';
import { expect, test } from './helm';
import {
  contentSize,
  countInput,
  leftUnit,
  schemePicker,
  seriousViolations,
  startBlankKeys,
  startFrom,
  unseen,
  walkTabOrder,
} from './screens';

const picker = (page: Page) => page.getByRole('dialog', { name: 'Choose an action' });
const search = (page: Page) => picker(page).getByRole('combobox', { name: 'Search actions' });
const option = (page: Page, name: string | RegExp) => picker(page).getByRole('option', { name });
const chip = (page: Page, name: string) => picker(page).getByRole('button', { name, exact: true });
/** The trailing "Add" or "Change" of a press in the side panel: "Add tap", "Change long press". */
const trigger = (page: Page, name: RegExp) =>
  page.locator('.ed-panel').getByRole('button', { name });

/** A blank keys scheme on Helldivers 2, the left index 2 selected, its tap's picker open. */
async function openOnIndex2(page: Page) {
  await startBlankKeys(page);
  await leftUnit(page).getByRole('button', { name: 'Empty, index 2' }).click();
  await trigger(page, /^Add tap$/).click();
  await expect(picker(page)).toBeVisible();
}

test.describe('the action picker', () => {
  test('Add opens it with the search focused; a search and a role narrow it, Enter picks', async ({
    helm,
  }) => {
    const { page } = helm;
    await openOnIndex2(page);
    await expect(search(page)).toBeFocused();
    await expect(picker(page).getByText('Left · Index 2 · Tap')).toBeVisible();
    // Nothing is on a button yet: every action is under "Not on a button".
    await expect(picker(page).getByRole('group', { name: 'Not on a button' })).toBeVisible();

    await page.keyboard.type('st');
    await expect(picker(page).getByRole('option')).toHaveText([
      /^Strafe left/,
      /^Strafe right/,
      /^Stim/,
      /^Stratagem \(hold\)/,
    ]);
    await chip(page, 'Combat').click();
    await expect(chip(page, 'Combat')).toHaveAttribute('aria-pressed', 'true');
    await expect(picker(page).getByRole('option')).toHaveText([/^Stim/]);
    // The chip gives the focus back to the search: Enter picks, it doesn't press the chip again.
    await expect(search(page)).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(picker(page)).toHaveCount(0);
    await expect(leftUnit(page).getByRole('button', { name: 'Stim, index 2' })).toBeVisible();
    await expect(page.locator('.ed-panel-title')).toHaveText('Stim');
    // The focus is back where the picker was opened from, now "Change".
    await expect(trigger(page, /^Change tap$/)).toBeFocused();
  });

  test('Change on a press with an action opens it; the pick replaces that action', async ({
    helm,
  }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await leftUnit(page)
      .getByRole('button', { name: /^Interact, / })
      .click();
    await expect(page.locator('.ed-panel-title')).toHaveText('Interact');
    await trigger(page, /^Change tap$/).click();
    await expect(search(page)).toBeFocused();
    await page.keyboard.type('throw');
    await expect(picker(page).getByRole('option')).toHaveText([/^Throw grenade/]);
    await page.keyboard.press('Enter');
    await expect(picker(page)).toHaveCount(0);
    await expect(page.locator('.ed-panel-title')).toHaveText('Throw grenade');
    await expect(trigger(page, /^Change tap$/)).toBeFocused();
  });

  test('the arrows move through the results and Enter picks the one shown, on the long press', async ({
    helm,
  }) => {
    const { page } = helm;
    await startBlankKeys(page);
    await leftUnit(page).getByRole('button', { name: 'Empty, index 2' }).click();
    await trigger(page, /^Add long press$/).click();
    await expect(picker(page).getByText('Left · Index 2 · Long')).toBeVisible();
    await page.keyboard.type('gren');
    // Grenade slot starts with it; Throw grenade has a word that does.
    await expect(picker(page).getByRole('option')).toHaveText([/^Grenade slot/, /^Throw grenade/]);
    await expect(option(page, /^Grenade slot/)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(option(page, /^Throw grenade/)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(
      leftUnit(page).getByRole('button', { name: 'Long: Throw grenade, index 2' }),
    ).toBeVisible();
  });

  test('an action on another button is under "Already on a button", and picking moves it here', async ({
    helm,
  }) => {
    const { page } = helm;
    await openOnIndex2(page);
    await page.keyboard.type('reload');
    await page.keyboard.press('Enter');
    await leftUnit(page).getByRole('button', { name: 'Empty, index 3' }).click();
    await trigger(page, /^Add tap$/).click();
    await page.keyboard.type('reload');
    const moved = picker(page).getByRole('group', {
      name: 'Already on a button · picking moves it here',
    });
    await expect(moved.getByRole('option')).toHaveText([/^Reload\s*Left · Index 2/]);
    await page.keyboard.press('Enter');
    await expect(leftUnit(page).getByRole('button', { name: 'Reload, index 3' })).toBeVisible();
    await expect(leftUnit(page).getByRole('button', { name: 'Empty, index 2' })).toBeVisible();
  });

  test('a row is dragged onto another button, and lands there', async ({ helm }) => {
    const { page } = helm;
    await openOnIndex2(page);
    await page.keyboard.type('reload');
    await option(page, /^Reload/).dragTo(
      leftUnit(page).getByRole('button', { name: 'Empty, index 3' }),
    );
    await expect(leftUnit(page).getByRole('button', { name: 'Reload, index 3' })).toBeVisible();
    // The drop selects the button it landed on: the picker, for index 2, is gone.
    await expect(picker(page)).toHaveCount(0);
    await expect(page.locator('.ed-panel-title')).toHaveText('Reload');
  });

  test('Esc closes it, with a search typed, and picks nothing', async ({ helm }) => {
    const { page } = helm;
    await openOnIndex2(page);
    await page.keyboard.type('gr');
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
    await expect(trigger(page, /^Add tap$/)).toBeFocused();
    await expect(leftUnit(page).getByRole('button', { name: 'Empty, index 2' })).toBeVisible();
  });

  test('another button selected, then the first again: the picker stays closed (Codex, #111)', async ({
    helm,
  }) => {
    const { page } = helm;
    await openOnIndex2(page);
    await leftUnit(page).getByRole('button', { name: 'Empty, index 3' }).click();
    await expect(picker(page)).toHaveCount(0);
    await leftUnit(page).getByRole('button', { name: 'Empty, index 2' }).click();
    await expect(page.locator('.ed-panel')).toBeVisible();
    await expect(picker(page)).toHaveCount(0);
    // The press settings and the list are there, not the picker.
    await expect(trigger(page, /^Add tap$/)).toBeVisible();
    await expect(page.locator('.ed-actions').first()).toBeVisible();
  });

  test('a device tab, then the button again: the picker stays closed', async ({ helm }) => {
    const { page } = helm;
    await openOnIndex2(page);
    // Helldivers 2 has one mode: the device tab is the move here. It drops the selection.
    await page
      .getByRole('group', { name: 'Device' })
      .getByRole('button', { name: 'Azerons' })
      .click();
    await expect(page.locator('.ed-panel')).toHaveCount(0);
    await leftUnit(page).getByRole('button', { name: 'Empty, index 2' }).click();
    await expect(page.locator('.ed-panel')).toBeVisible();
    await expect(picker(page)).toHaveCount(0);
  });

  test('Close closes it too', async ({ helm }) => {
    const { page } = helm;
    await openOnIndex2(page);
    await picker(page).getByRole('button', { name: 'Close' }).click();
    await expect(picker(page)).toHaveCount(0);
    await expect(page.locator('.ed-panel')).toBeVisible();
  });

  test('says so when nothing matches', async ({ helm }) => {
    const { page } = helm;
    await openOnIndex2(page);
    await page.keyboard.type('zzz');
    await expect(picker(page).getByText('Nothing matches “zzz”.')).toBeVisible();
    await expect(picker(page).getByRole('option')).toHaveCount(0);
    // Enter with nothing to pick does nothing.
    await page.keyboard.press('Enter');
    await expect(picker(page)).toBeVisible();
  });

  test('the window doesn’t scroll at 1280 with every action listed: the results do', async ({
    helm,
  }) => {
    const { page } = helm;
    await contentSize(helm, 1280, 900);
    await openOnIndex2(page);
    const scroll = await page.evaluate(() => {
      const doc = document.scrollingElement ?? document.documentElement;
      return doc.scrollHeight > window.innerHeight || doc.scrollWidth > window.innerWidth;
    });
    expect(scroll).toBe(false);
    await option(page, /^Menu/).scrollIntoViewIfNeeded();
    await expect(option(page, /^Menu/)).toBeInViewport();
    await expect(page.locator('header.header')).toBeInViewport({ ratio: 1 });
  });
});

test.describe('the action picker on a two-mode game', () => {
  async function twoModes(page: Page) {
    await page.evaluate(async () => {
      const helm = (
        window as unknown as {
          helm: {
            saveGame(game: unknown): Promise<void>;
            createScheme(gameId: string, preset: string): Promise<{ id: string }>;
            setActive(gameId: string, schemeId: string): Promise<void>;
          };
        }
      ).helm;
      const act = (id: string, name: string, mode: string, role?: string) => ({
        id,
        name,
        mode,
        ...(role === undefined ? {} : { role }),
        required: false,
      });
      await helm.saveGame({
        id: 'two_modes',
        name: 'Two Modes',
        modes: [
          { id: 'ship', name: 'Ship' },
          { id: 'foot', name: 'On foot' },
        ],
        actions: [
          act('boost', 'Boost', 'ship', 'movement'),
          act('jump', 'Jump', 'foot', 'movement'),
          act('wave', 'Wave', 'foot'),
          act('wait', 'Wait', 'foot', 'menu'),
        ],
      });
      const made = await helm.createScheme('two_modes', 'xbox');
      await helm.setActive('two_modes', made.id);
    });
    await page.getByRole('button', { name: 'Look again' }).click();
    await page.locator('.tile', { hasText: 'Two Modes' }).locator('.tile-button').click();
    await expect(page.getByRole('heading', { name: 'Two Modes' })).toBeVisible();
  }

  test('offers the mode shown, and No role; the pick lands in that mode', async ({ helm }) => {
    const { page } = helm;
    await twoModes(page);
    await page.getByRole('tab', { name: 'On foot' }).click();
    await leftUnit(page).getByRole('button', { name: 'Empty, middle 2' }).click();
    await trigger(page, /^Add tap$/).click();
    await expect(search(page)).toHaveAttribute('placeholder', 'Search On foot actions');
    // Ship's Boost is not On foot's to pick.
    await page.keyboard.type('boo');
    await expect(picker(page).getByText('Nothing matches “boo”.')).toBeVisible();
    await search(page).fill('wa');
    await expect(picker(page).getByRole('option')).toHaveText([/^Wave/, /^Wait/]);
    // Wave has no role yet (#98).
    await chip(page, 'No role').click();
    await expect(picker(page).getByRole('option')).toHaveText([/^Wave/]);
    await page.keyboard.press('Enter');

    await expect(page.getByRole('tab', { name: 'On foot' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(leftUnit(page).getByRole('button', { name: 'Wave, middle 2' })).toBeVisible();
    await page.getByRole('tab', { name: 'Ship' }).click();
    await expect(leftUnit(page).getByRole('button', { name: 'Empty, middle 2' })).toBeVisible();
  });
});

test.describe('the action picker: the keyboard and axe', () => {
  test('opened from the keyboard: Enter on Add, then the search has the focus', async ({
    helm,
  }) => {
    const { page } = helm;
    await startBlankKeys(page);
    await leftUnit(page).getByRole('button', { name: 'Empty, index 2' }).click();
    await trigger(page, /^Add tap$/).focus();
    await page.keyboard.press('Enter');
    await expect(search(page)).toBeFocused();
    await page.keyboard.type('reload');
    await page.keyboard.press('Enter');
    await expect(leftUnit(page).getByRole('button', { name: 'Reload, index 2' })).toBeVisible();
  });

  test('with results: every stop shows its focus, and axe finds nothing serious', async ({
    helm,
  }) => {
    const { page } = helm;
    await openOnIndex2(page);
    await page.keyboard.type('re');
    await expect(picker(page).getByRole('option').first()).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    const stops = await walkTabOrder(page);
    const inPicker = stops.filter((s) => s.inDialog).map((s) => s.label);
    expect(inPicker).toEqual([
      'Close',
      'Search actions',
      'All',
      'Combat',
      'Movement',
      'Ability',
      'Travel',
      'Menu',
    ]);
    expect(unseen(stops)).toEqual([]);
  });

  test('with no results: axe finds nothing serious', async ({ helm }) => {
    const { page } = helm;
    await openOnIndex2(page);
    await page.keyboard.type('zzz');
    await expect(picker(page).getByText('Nothing matches “zzz”.')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    expect(unseen(await walkTabOrder(page))).toEqual([]);
  });

  test('picking by search is 2 clicks and the typing: the button, Add, then type and Enter', async ({
    helm,
  }) => {
    const { page } = helm;
    await startBlankKeys(page);
    const counted = await countInput(page);
    await leftUnit(page).getByRole('button', { name: 'Empty, index 2' }).click();
    await trigger(page, /^Add tap$/).click();
    await page.keyboard.type('reload');
    await page.keyboard.press('Enter');
    await expect(leftUnit(page).getByRole('button', { name: 'Reload, index 2' })).toBeVisible();
    expect(await counted()).toEqual({ clicks: 2, drags: 0 });
  });
});

test.describe('what is open for one place doesn’t outlive it', () => {
  test('the scheme picker’s question: asked, a button clicked, the picker opened again: not asked', async ({
    helm,
  }) => {
    const { page } = helm;
    await startBlankKeys(page);
    await schemePicker(page).click();
    await page.getByRole('button', { name: 'Delete this scheme' }).click();
    await expect(page.getByRole('group', { name: /^Delete the scheme/ })).toBeVisible();
    // A button of the right unit: the picker's popover lies over the left one.
    await page
      .locator('.unit[data-hand="right"]')
      .getByRole('button', { name: 'Empty, index 1' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Schemes' })).toHaveCount(0);
    await schemePicker(page).click();
    await expect(page.getByRole('button', { name: 'Delete this scheme' })).toBeVisible();
    await expect(page.getByRole('group', { name: /^Delete the scheme/ })).toHaveCount(0);
  });

  test('the long press targeted, another button and back: the tap again', async ({ helm }) => {
    const { page } = helm;
    await startBlankKeys(page);
    await leftUnit(page).getByRole('button', { name: 'Empty, index 2' }).click();
    const long = page.locator('.ed-panel').getByRole('button', { name: /^Long/ });
    await long.click();
    await expect(long).toHaveAttribute('aria-pressed', 'true');
    await leftUnit(page).getByRole('button', { name: 'Empty, index 3' }).click();
    await leftUnit(page).getByRole('button', { name: 'Empty, index 2' }).click();
    await expect(long).toHaveAttribute('aria-pressed', 'false');
  });
});
