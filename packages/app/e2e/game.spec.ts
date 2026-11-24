// The Game screen, in the real window over the fake units: a game's data added in the app, its
// defaults set by pressing them (docs/plans/04-roadmap.md, M4.5, *Game data in the app*). Keys are
// Playwright's own, into the page; the controller is a fake `navigator.getGamepads`, put into the
// page by this test only. No OS-level input is ever sent.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './helm';
import {
  applyInDrawer,
  drawer,
  keepEveryCheck,
  leftUnit,
  pill,
  seriousViolations,
  unseen,
  walkTabOrder,
} from './screens';

/** The fake Steam's game helmArray has no data for (e2e/helm.ts). */
const UNKNOWN = 'A Game Nobody Wrote Yet';
/** Its id, made from its name: the file the game is saved to. */
const UNKNOWN_ID = 'a_game_nobody_wrote_yet';
/** The units' codes for Space and R: 0xF000 | the HID usage (packages/azeron `UNIT_KEY_CODES`). */
const KEY_SPACE = 0xf02c;

const gameName = (page: Page) => page.getByRole('textbox', { name: 'Game name' });

/** *Set up* on the Steam game helmArray doesn't know: the Game screen, on a new game. */
async function setUpUnknown(page: Page) {
  await page.getByRole('button', { name: `Set up ${UNKNOWN}` }).click();
  await expect(gameName(page)).toHaveValue(UNKNOWN);
}

/** Types an action's name, Enter, then presses its key: what the new-action field asks for. */
async function addAction(page: Page, name: string, key: string, shown: string) {
  const field = page.getByRole('textbox', { name: 'New action' });
  await field.fill(name);
  await field.press('Enter');
  await expect(page.getByRole('status')).toHaveText(
    `Press ${name}'s key or mouse button. Esc cancels.`,
  );
  await page.keyboard.press(key);
  await expect(page.getByRole('button', { name: `${name}, key: ${shown}` })).toBeVisible();
}

async function savedGame(dataDir: string): Promise<string> {
  return readFile(join(dataDir, 'games', `${UNKNOWN_ID}.json`), 'utf8').catch(() => '');
}

/** A fake Xbox controller, standard layout, nothing pressed: `window.fakePad` presses it. */
async function plugFakePad(page: Page) {
  await page.addInitScript(() => {
    const pad = {
      id: 'Fake Xbox controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      axes: [0, 0, 0, 0],
    };
    (window as unknown as { fakePad: typeof pad }).fakePad = pad;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [pad, null, null, null],
    });
  });
  // An init script runs from the next load on: load the window again, and see it is there.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.getGamepads()[0]?.id))
    .toBe('Fake Xbox controller');
}

async function pressPad(page: Page, change: { button?: number; axis?: [number, number] }) {
  await page.evaluate((c) => {
    const pad = (
      window as unknown as {
        fakePad: {
          buttons: { pressed: boolean; touched: boolean; value: number }[];
          axes: number[];
        };
      }
    ).fakePad;
    if (c.button !== undefined) pad.buttons[c.button] = { pressed: true, touched: true, value: 1 };
    if (c.axis !== undefined) pad.axes[c.axis[0]] = c.axis[1];
  }, change);
}

test.describe('the Game screen', () => {
  test('Set up, two actions by pressing their keys, Game’s own keys, Apply: the unit sends the key pressed', async ({
    helm,
  }) => {
    const { page } = helm;
    await setUpUnknown(page);
    // Nothing is written until the game has something in it.
    expect(await savedGame(helm.dataDir)).toBe('');
    // The new-action field has the focus: no click to start typing.
    await expect(page.getByRole('textbox', { name: 'New action' })).toBeFocused();

    await addAction(page, 'Jump', 'Space', 'Space');
    await addAction(page, 'Reload', 'KeyR', 'R');
    await expect.poll(() => savedGame(helm.dataDir)).toContain('"code": "R"');
    const saved = JSON.parse(await savedGame(helm.dataDir)) as {
      steamAppId: number;
      actions: { id: string; native?: unknown }[];
    };
    expect([saved.steamAppId, saved.actions.map((a) => [a.id, a.native])]).toEqual([
      1245620,
      [
        ['jump', { key: { kind: 'key', code: 'Space' } }],
        ['reload', { key: { kind: 'key', code: 'R' } }],
      ],
    ]);

    // J1 from here: a default, then Apply.
    await page
      .getByRole('group', { name: 'New scheme from' })
      .getByRole('button', { name: "Game's own keys" })
      .click();
    await expect(page.getByRole('heading', { name: UNKNOWN })).toBeVisible();
    const jump = page.locator('.ed-actions').getByRole('button', { name: 'Jump' });
    await jump.dragTo(leftUnit(page).getByRole('button', { name: 'Empty, index 1' }));
    await expect(leftUnit(page).getByRole('button', { name: 'Jump, index 1' })).toBeVisible();
    await keepEveryCheck(page);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(applyInDrawer(page)).toBeEnabled();
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel('Result')).toContainText('Both units now run the layout.');
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    await expect(pill(page)).toHaveText('In sync');

    const [left] = await helm.units();
    const written = left?.slots.find((s) => s.slot === left.running);
    expect([written?.name, written?.taps]).toEqual([
      "Game's own keys",
      [{ input: expect.any(Number), keys: [KEY_SPACE] }],
    ]);
  });

  test('a controller button is set by pressing it on the controller', async ({ helm }) => {
    const { page } = helm;
    await plugFakePad(page);
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');

    await page.getByRole('button', { name: "Set Jump's controller button" }).click();
    await expect(page.getByRole('status')).toHaveText(
      "Press Jump's button on the controller. Esc cancels.",
    );
    await pressPad(page, { button: 3 });
    await expect(page.getByRole('button', { name: 'Jump, controller button: Y' })).toBeVisible();
  });

  test('a stick direction is set by pushing the stick', async ({ helm }) => {
    const { page } = helm;
    await plugFakePad(page);
    await setUpUnknown(page);
    await addAction(page, 'Forward', 'KeyW', 'W');

    await page.getByRole('button', { name: "Set Forward's controller button" }).click();
    await pressPad(page, { axis: [1, -1] });
    await expect(
      page.getByRole('button', { name: 'Forward, controller button: Left stick up' }),
    ).toBeVisible();
  });

  test('a button already held when the wait begins does not set itself', async ({ helm }) => {
    const { page } = helm;
    await plugFakePad(page);
    await pressPad(page, { button: 0 }); // A is held down from before
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');
    await page.getByRole('button', { name: "Set Jump's controller button" }).click();
    await pressPad(page, { button: 1 });
    await expect(page.getByRole('button', { name: 'Jump, controller button: B' })).toBeVisible();
  });

  test('Esc leaves the wait for a key, and Tab reaches the keys a press can’t set', async ({
    helm,
  }) => {
    const { page } = helm;
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');
    await addAction(page, 'Menu', 'KeyM', 'M');
    // Menu is on Esc in most games: Esc can't be pressed (it cancels), so it is picked.
    await page.getByRole('button', { name: 'Menu, key: M' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Menu, key: M' })).toBeVisible();
    await page.getByRole('button', { name: 'Menu, key: M' }).click();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('combobox', { name: "Keys a press can't set" })).toBeFocused();
    await page.getByRole('combobox', { name: "Keys a press can't set" }).selectOption('Esc');
    await expect(page.getByRole('button', { name: 'Menu, key: Esc' })).toBeVisible();
  });

  test('Add a game, by name only, leads to the same screen and then to the Library', async ({
    helm,
  }) => {
    const { page } = helm;
    await page.getByRole('button', { name: 'Add a game' }).click();
    await expect(gameName(page)).toBeFocused();
    await page.keyboard.type('Ace Combat 7');
    await page.getByRole('textbox', { name: 'New action' }).click();
    await addAction(page, 'Fire', 'Space', 'Space');
    await page.getByRole('button', { name: 'Library' }).click();
    await expect(page.getByRole('button', { name: 'Edit game: Ace Combat 7' })).toBeVisible();
  });

  test('Edit game on Helldivers 2 keeps your copy, and Back to helmArray’s drops it', async ({
    helm,
  }) => {
    const { page } = helm;
    await page.getByRole('button', { name: /^Edit game: HELLDIVERS/ }).click();
    await expect(gameName(page)).toHaveValue('Helldivers 2');
    await page.getByRole('textbox', { name: 'Reload, name' }).fill('Reload weapon');
    await expect(page.getByText("Your copy of helmArray's game")).toBeVisible();
    await expect
      .poll(() => readFile(join(helm.dataDir, 'games', 'helldivers2.json'), 'utf8').catch(() => ''))
      .toContain('Reload weapon');

    await page.getByRole('button', { name: "Back to helmArray's" }).click();
    await page
      .getByRole('group', { name: 'Are you sure?' })
      .getByRole('button', { name: "Back to helmArray's" })
      .click();
    await expect(page.getByRole('textbox', { name: 'Reload, name' })).toBeVisible();
    await expect
      .poll(() => readFile(join(helm.dataDir, 'games', 'helldivers2.json'), 'utf8').catch(() => ''))
      .toBe('');
  });
});

test.describe('the Game screen: axe and the keyboard in each state', () => {
  test('empty', async ({ helm }) => {
    const { page } = helm;
    await setUpUnknown(page);
    await expect(page.getByText('No actions yet.')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    const stops = await walkTabOrder(page);
    expect(stops.map((s) => s.label)).toEqual(
      expect.arrayContaining(['Library', 'Game name', 'Add mode', 'Mode name', 'New action']),
    );
    expect(unseen(stops)).toEqual([]);
  });

  test('with actions', async ({ helm }) => {
    const { page } = helm;
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');
    await addAction(page, 'Reload', 'KeyR', 'R');
    expect(await seriousViolations(page)).toEqual([]);
    const stops = await walkTabOrder(page);
    expect(stops.map((s) => s.label)).toEqual(
      expect.arrayContaining([
        'Jump, name',
        'Jump, role',
        'Jump is required',
        'Jump, key: Space',
        "Set Jump's controller button",
        'More for Jump',
        "Game's own keys",
      ]),
    );
    expect(unseen(stops)).toEqual([]);
  });

  test('while waiting for a press', async ({ helm }) => {
    const { page } = helm;
    await plugFakePad(page);
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');
    await page.getByRole('button', { name: "Set Jump's controller button" }).click();
    await expect(page.getByRole('status')).toHaveText(
      "Press Jump's button on the controller. Esc cancels.",
    );
    expect(await seriousViolations(page)).toEqual([]);
    // Tab moves on while the controller is waited for: the wait stays, and every stop shows.
    const stops = await walkTabOrder(page);
    expect(stops.map((s) => s.label)).toEqual(
      expect.arrayContaining(['Press a button for Jump', 'Controller buttons', 'Cancel']),
    );
    expect(unseen(stops)).toEqual([]);
    await expect(page.getByRole('status')).toHaveText(
      "Press Jump's button on the controller. Esc cancels.",
    );
  });
});
