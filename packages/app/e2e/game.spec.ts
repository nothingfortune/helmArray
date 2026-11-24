// The Game screen, in the real window over the fake units: a game's data added in the app, its
// defaults set by pressing them (docs/plans/04-roadmap.md, M4.5, *Game data in the app*). Keys are
// Playwright's own, into the page; the controller is a fake `navigator.getGamepads`, put into the
// page by this test only. No OS-level input is ever sent.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './helm';
import {
  AZERON_APP,
  CLOSE_AZERON_FIRST,
  applyInDrawer,
  drawer,
  keepEveryCheck,
  leftUnit,
  pill,
  schemePicker,
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
/** The checks "Game's own keys" leaves to keep before Apply: each a click. */
const KEYS_ROUTE_KEEPS = 2;

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

/**
 * The Gamepad API with no controller connected: four empty places, as Chromium gives them. Not the
 * machine's own: a real controller plugged in never reaches the test. `window.connectFakePad()`
 * plugs the fake one in mid-test, pressing `button` with it if given: Chromium shows a pad only
 * once a button on it is pressed.
 */
async function noPadYet(page: Page) {
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
    let plugged = false;
    const w = window as unknown as { fakePad: typeof pad; connectFakePad(button?: number): void };
    w.fakePad = pad;
    w.connectFakePad = (button) => {
      if (button !== undefined) pad.buttons[button] = { pressed: true, touched: true, value: 1 };
      plugged = true;
    };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => (plugged ? [pad, null, null, null] : [null, null, null, null]),
    });
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.getGamepads().filter((p) => p !== null).length))
    .toBe(0);
}

const connectFakePad = (page: Page, button?: number) =>
  page.evaluate(
    (b) => (window as unknown as { connectFakePad(b?: number): void }).connectFakePad(b),
    button,
  );

/** Opens your copy of Helldivers 2: its 28 actions, more than the window holds. */
async function editHelldivers(page: Page) {
  await page.getByRole('button', { name: /^Edit game: HELLDIVERS/ }).click();
  await expect(gameName(page)).toHaveValue('Helldivers 2');
}

/** The window's content at the app's narrowest. */
async function narrowest(helm: { app: ElectronApplication }) {
  await helm.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 900);
  });
}

/** Where an element is, in the window. */
const box = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r === undefined
      ? null
      : { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
  }, selector);

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
    // Game's own keys leaves both sticks sending no keys: two checks to keep, as on Helldivers 2.
    expect(await keepEveryCheck(page)).toBe(KEYS_ROUTE_KEEPS);
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

  test('J1 by the Xbox controller: Set up, a key and a controller button pressed, the default, Apply', async ({
    helm,
  }) => {
    // Clicks, counted: Set up, the controller field, Xbox controller, Apply, Apply in the drawer.
    // Everything else is typing and pressing.
    const { page } = helm;
    await plugFakePad(page);
    await setUpUnknown(page); // click 1
    await addAction(page, 'Jump', 'Space', 'Space');
    await page.getByRole('button', { name: "Set Jump's controller button" }).click(); // click 2
    await pressPad(page, { button: 0 });
    await expect(page.getByRole('button', { name: 'Jump, controller button: A' })).toBeVisible();
    await page
      .getByRole('group', { name: 'New scheme from' })
      .getByRole('button', { name: 'Xbox controller' })
      .click(); // click 3
    await expect(page.getByRole('heading', { name: UNKNOWN })).toBeVisible();
    // The preset puts Jump where the game ships it: nothing to keep.
    await expect(page.getByRole('button', { name: 'Keep, I know' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Apply', exact: true }).click(); // click 4
    await expect(applyInDrawer(page)).toBeEnabled();
    await applyInDrawer(page).click(); // click 5
    await expect(drawer(page).getByLabel('Result')).toContainText('Both units now run the layout.');
    const names = (await helm.units()).map((u) => u.slots.find((s) => s.slot === u.running)?.name);
    expect(names).toEqual(['Xbox controller', 'Xbox controller']);
  });

  test('a mouse button is set by pressing it on the waiting field: left, then right', async ({
    helm,
  }) => {
    const { page } = helm;
    await setUpUnknown(page);
    await addAction(page, 'Fire', 'KeyF', 'F');
    await page.getByRole('button', { name: 'Fire, key: F' }).click();
    await page.getByRole('button', { name: 'Press a key for Fire' }).click();
    // The click that follows the press doesn't start another wait.
    await expect(page.getByRole('button', { name: 'Fire, key: Left mouse button' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);

    await page.getByRole('button', { name: 'Fire, key: Left mouse button' }).click();
    await page.getByRole('button', { name: 'Press a key for Fire' }).click({ button: 'right' });
    await expect(page.getByRole('button', { name: 'Fire, key: Right mouse button' })).toBeVisible();
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
    const list = page.getByRole('combobox', { name: "Keys a press can't set" });
    await expect(list).toBeFocused();
    // The list starts on Esc: Enter takes it, no change of the list needed.
    await expect(list).toHaveValue('Esc');
    await expect(page.getByText('Or pick a key:')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Menu, key: Esc' })).toBeVisible();
  });

  test('with no controller connected, the list is offered and has the focus: picking sets the button', async ({
    helm,
  }) => {
    const { page } = helm;
    await noPadYet(page);
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');
    await addAction(page, 'Reload', 'KeyR', 'R');

    await page.getByRole('button', { name: "Set Jump's controller button" }).click();
    await expect(page.getByRole('status')).toHaveText(
      "No controller connected. Pick Jump's button:",
    );
    const list = page.getByRole('combobox', { name: 'Controller buttons' });
    await expect(list).toBeFocused();
    await list.selectOption('B');
    await expect(page.getByRole('button', { name: 'Jump, controller button: B' })).toBeVisible();
    // The focus goes back to the field the wait began on.
    await expect(page.getByRole('button', { name: 'Jump, controller button: B' })).toBeFocused();

    // The list starts on A: Set takes it in one click.
    await page.getByRole('button', { name: "Set Reload's controller button" }).click();
    await expect(list).toHaveValue('A');
    await page.getByRole('button', { name: 'Set', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reload, controller button: A' })).toBeVisible();

    // Esc still cancels.
    await page.getByRole('button', { name: 'Reload, controller button: A' }).click();
    await expect(list).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('the arrows only move through the list: Enter sets what it shows', async ({ helm }) => {
    const { page } = helm;
    await noPadYet(page);
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');
    await page.getByRole('button', { name: "Set Jump's controller button" }).click();
    const list = page.getByRole('combobox', { name: 'Controller buttons' });
    await expect(list).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    // Still waiting: no arrow set a button.
    await expect(page.getByRole('status')).toHaveText(
      "No controller connected. Pick Jump's button:",
    );
    await expect(list).toHaveValue('X');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Jump, controller button: X' })).toBeVisible();
  });

  test('a new action at the end of a long list is scrolled into view, waiting for its key', async ({
    helm,
  }) => {
    const { page } = helm;
    await editHelldivers(page);
    const field = page.getByRole('textbox', { name: 'New action' });
    await field.fill('Wave');
    await field.press('Enter');
    await expect(page.getByRole('status')).toHaveText(
      "Press Wave's key or mouse button. Esc cancels.",
    );
    await expect(page.getByRole('status')).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Press a key for Wave' })).toBeInViewport();
  });

  test('a controller plugged in during the wait is listened to, and its press is taken', async ({
    helm,
  }) => {
    const { page } = helm;
    await noPadYet(page);
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');
    await page.getByRole('button', { name: "Set Jump's controller button" }).click();
    await expect(page.getByRole('status')).toHaveText(
      "No controller connected. Pick Jump's button:",
    );

    await connectFakePad(page);
    await expect(page.getByRole('status')).toHaveText(
      "Press Jump's button on the controller. Esc cancels.",
    );
    await expect(page.getByText('Or pick a button:')).toBeVisible();
    await pressPad(page, { button: 3 });
    await expect(page.getByRole('button', { name: 'Jump, controller button: Y' })).toBeVisible();
  });

  test('the press a controller is found by sets the button', async ({ helm }) => {
    const { page } = helm;
    await noPadYet(page);
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');
    await page.getByRole('button', { name: "Set Jump's controller button" }).click();
    await expect(page.getByRole('status')).toHaveText(
      "No controller connected. Pick Jump's button:",
    );
    // As Chromium does: the pad shows up with the button that woke it already down.
    await connectFakePad(page, 0);
    await expect(page.getByRole('button', { name: 'Jump, controller button: A' })).toBeVisible();
  });

  test('a new action has no role until one is chosen, and is saved without one', async ({
    helm,
  }) => {
    const { page } = helm;
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');
    const role = page.getByRole('combobox', { name: 'Jump, role' });
    await expect(role).toHaveValue('');
    await expect(role.locator('option:checked')).toHaveText('Role');
    await expect.poll(() => savedGame(helm.dataDir)).toContain('"jump"');
    const unrolled = JSON.parse(await savedGame(helm.dataDir)) as { actions: object[] };
    expect(unrolled.actions.map((a) => 'role' in a)).toEqual([false]);

    await role.selectOption('Movement');
    await expect.poll(() => savedGame(helm.dataDir)).toContain('"role": "movement"');
  });

  test('a game with one mode shows no mode tab until Add mode, which names both', async ({
    helm,
  }) => {
    const { page } = helm;
    await setUpUnknown(page);
    await expect(page.getByRole('tablist', { name: 'Modes' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Mode name' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Add mode' }).click();
    await expect(page.getByRole('tab')).toHaveText(['Mode 10', 'Mode 20']);
    await expect(page.getByRole('textbox', { name: 'Mode name' })).toBeFocused();
    await expect(page.getByRole('tabpanel', { name: 'Actions' })).toBeVisible();
  });

  test('a lone mode with no name keeps its field while a whole name is typed', async ({ helm }) => {
    const { page } = helm;
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');
    // Codex's sequence: two modes, the first one's name cleared, the other deleted.
    await page.getByRole('button', { name: 'Add mode' }).click();
    await page.getByRole('tab', { name: /^Mode 1/ }).click();
    const modeName = page.getByRole('textbox', { name: 'Mode name' });
    await modeName.fill('');
    await page.getByRole('tab', { name: /^Mode 2/ }).click();
    await page.getByRole('button', { name: 'Delete mode' }).click();
    await expect(page.getByRole('tab')).toHaveText(['Unnamed1']);

    await modeName.click();
    await page.keyboard.type('On foot');
    await expect(modeName).toHaveValue('On foot');
    await expect(modeName).toBeFocused();
    // Once the typing is done the lone mode has a name: nothing to tell apart, so no tab.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tablist', { name: 'Modes' })).toHaveCount(0);
    await expect.poll(() => savedGame(helm.dataDir)).toContain('"name": "On foot"');
  });

  test('the window doesn’t scroll with 28 actions: the rows do, and the bar stays', async ({
    helm,
  }) => {
    const { page } = helm;
    await editHelldivers(page);
    // The precondition: more rows than the panel holds.
    const rows = page.locator('.gm-rows');
    expect(await rows.evaluate((el) => el.scrollHeight > el.clientHeight + 100)).toBe(true);
    const fits = () =>
      page.evaluate(() => {
        const doc = document.scrollingElement ?? document.documentElement;
        return doc.scrollHeight <= window.innerHeight;
      });
    expect(await fits()).toBe(true);

    await rows.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.mouse.wheel(0, 2000);
    const startFrom = page.getByRole('group', { name: 'New scheme from' });
    await expect(startFrom).toBeInViewport();
    expect([await fits(), await page.evaluate(() => window.scrollY)]).toEqual([true, 0]);
    // The last action is reachable inside the rows' own scroll.
    await expect(page.getByRole('textbox', { name: /, name$/ }).last()).toBeInViewport();
    // At 1440 the table stops at about 1080 px.
    expect((await box(page, '.gm-panel'))?.width).toBeLessThanOrEqual(1080);
    // A line under the header (the Azeron app is open) takes its height from the panel, not the window.
    await helm.setProcesses([AZERON_APP]);
    await expect(page.getByText(CLOSE_AZERON_FIRST)).toBeVisible();
    expect(await fits()).toBe(true);
  });

  test('asking before a delete takes the place of Delete game: the bar and the table stay put', async ({
    helm,
  }) => {
    const { page } = helm;
    await narrowest(helm);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1280);
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');
    await expect(page.getByRole('button', { name: 'Delete game' })).toBeVisible();
    const before = [await box(page, '.gm-bar'), await box(page, '.gm-table')];

    await page.getByRole('button', { name: 'Delete game' }).click();
    const asking = page.getByRole('group', { name: 'Are you sure?' });
    await expect(asking).toHaveText(/Delete this game and its schemes\?/);
    await expect(asking).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('group', { name: 'New scheme from' })).toBeInViewport({ ratio: 1 });
    expect([await box(page, '.gm-bar'), await box(page, '.gm-table')]).toEqual(before);
  });

  test('one amber button: the first way on, once there is an action', async ({ helm }) => {
    const { page } = helm;
    await setUpUnknown(page);
    await expect(page.locator('.gm .btn.primary')).toHaveCount(0);
    await addAction(page, 'Jump', 'Space', 'Space');
    await expect(page.locator('.gm .btn.primary')).toHaveText(['Xbox controller']);
  });

  test('Redo puts back what Undo took', async ({ helm }) => {
    const { page } = helm;
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: "Set Jump's key" })).toBeVisible();
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(page.getByRole('button', { name: 'Jump, key: Space' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
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
    // Its file is named from the name typed, not from the empty one it opened with.
    await expect
      .poll(() =>
        readFile(join(helm.dataDir, 'games', 'ace_combat_7.json'), 'utf8').catch(() => ''),
      )
      .toContain('"name": "Ace Combat 7"');
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

test('Back to helmArray’s on a copy saved earlier shows helmArray’s game, and the next edit is saved on it alone', async ({
  helm,
}) => {
  const { page } = helm;
  const file = join(helm.dataDir, 'games', 'helldivers2.json');
  const saved = () => readFile(file, 'utf8').catch(() => '');
  // A copy saved in an earlier visit: the screen then opens on the copy.
  await page.getByRole('button', { name: /^Edit game: HELLDIVERS/ }).click();
  await page.getByRole('textbox', { name: 'Reload, name' }).fill('Reload weapon');
  await expect.poll(saved).toContain('Reload weapon');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: /^Edit game: HELLDIVERS/ }).click();
  await expect(page.getByRole('textbox', { name: 'Reload weapon, name' })).toBeVisible();

  await page.getByRole('button', { name: "Back to helmArray's" }).click();
  await page
    .getByRole('group', { name: 'Are you sure?' })
    .getByRole('button', { name: "Back to helmArray's" })
    .click();
  await expect.poll(saved).toBe('');
  await expect(page.getByRole('textbox', { name: 'Reload, name' })).toHaveValue('Reload');
  await expect(page.getByText("helmArray's game. Your edits are kept as your copy.")).toBeVisible();

  // One edit now: the copy saved is helmArray's game with that edit, and nothing from before.
  await page.getByRole('textbox', { name: 'Melee, name' }).fill('Punch');
  await expect.poll(saved).toContain('Punch');
  const copy = JSON.parse(await saved()) as { actions: { id: string; name: string }[] };
  expect(copy.actions.filter((a) => a.id === 'reload' || a.id === 'melee')).toEqual([
    expect.objectContaining({ id: 'reload', name: 'Reload' }),
    expect.objectContaining({ id: 'melee', name: 'Punch' }),
  ]);
});

test('a game whose last action is deleted keeps its scheme: opened, applied and deleted from the Library', async ({
  helm,
}) => {
  const { page } = helm;
  await setUpUnknown(page);
  await addAction(page, 'Jump', 'Space', 'Space');
  await page
    .getByRole('group', { name: 'New scheme from' })
    .getByRole('button', { name: "Game's own keys" })
    .click();
  await expect(page.getByRole('heading', { name: UNKNOWN })).toBeVisible();
  await page.getByRole('button', { name: 'Library' }).click();

  // The game's last action goes.
  await page.getByRole('button', { name: `Edit game: ${UNKNOWN}` }).click();
  await page.getByRole('button', { name: 'More for Jump' }).click();
  await page.getByRole('button', { name: 'Delete Jump' }).click();
  await expect(page.getByText('No actions yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Library' }).click();

  // Its scheme is still there to open, beside Edit game.
  await expect(page.getByRole('button', { name: `Edit game: ${UNKNOWN}` })).toBeVisible();
  await page.locator('.tile', { hasText: UNKNOWN }).locator('.tile-button').click();
  await expect(page.getByRole('heading', { name: UNKNOWN })).toBeVisible();
  await keepEveryCheck(page);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(applyInDrawer(page)).toBeEnabled();
  await applyInDrawer(page).click();
  await expect(drawer(page).getByLabel('Result')).toContainText('Both units now run the layout.');
  await drawer(page).getByRole('button', { name: 'Close' }).click();

  await schemePicker(page).click();
  await page.getByRole('button', { name: 'Delete this scheme' }).click();
  await page
    .getByRole('group', { name: "Delete Game's own keys?" })
    .getByRole('button', { name: 'Delete' })
    .click();
  // With no scheme and no action left, the game is set up again from its tile.
  await expect(page.getByRole('button', { name: `Set up ${UNKNOWN}` })).toBeVisible();
});

test.describe('the Game screen: axe and the keyboard in each state', () => {
  test('empty', async ({ helm }) => {
    const { page } = helm;
    await setUpUnknown(page);
    await expect(page.getByText('No actions yet.')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    const stops = await walkTabOrder(page);
    const labels = stops.map((s) => s.label);
    expect([labels.includes('Mode name'), labels]).toEqual([
      false,
      expect.arrayContaining(['Library', 'Game name', 'Add mode', 'New action']),
    ]);
    expect(unseen(stops)).toEqual([]);
  });

  test('two modes', async ({ helm }) => {
    const { page } = helm;
    await setUpUnknown(page);
    await page.getByRole('button', { name: 'Add mode' }).click();
    await expect(page.getByRole('tablist', { name: 'Modes' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    const stops = await walkTabOrder(page);
    expect(stops.map((s) => s.label)).toEqual(
      // A tab's text is its name and its count of actions.
      expect.arrayContaining(['Mode 10', 'Mode 20', 'Add mode', 'Mode name', 'Delete mode']),
    );
    expect(unseen(stops)).toEqual([]);
  });

  test('asking before a delete', async ({ helm }) => {
    const { page } = helm;
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');
    await page.getByRole('button', { name: 'Delete game' }).click();
    await expect(page.getByRole('group', { name: 'Are you sure?' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    const stops = await walkTabOrder(page);
    expect(stops.map((s) => s.label)).toEqual(
      expect.arrayContaining(['Delete', 'Keep it', 'Xbox controller']),
    );
    expect(unseen(stops)).toEqual([]);
  });

  test('a long list, scrolled inside the panel', async ({ helm }) => {
    const { page } = helm;
    await editHelldivers(page);
    expect(await seriousViolations(page)).toEqual([]);
    const stops = await walkTabOrder(page);
    // Every row is reached, and each stop shows where it is.
    expect(stops.filter((s) => s.label.endsWith(', name')).length).toBe(28);
    expect(unseen(stops)).toEqual([]);
  });

  test('while waiting for a controller with none connected', async ({ helm }) => {
    const { page } = helm;
    await noPadYet(page);
    await setUpUnknown(page);
    await addAction(page, 'Jump', 'Space', 'Space');
    await page.getByRole('button', { name: "Set Jump's controller button" }).click();
    await expect(page.getByRole('status')).toHaveText(
      "No controller connected. Pick Jump's button:",
    );
    expect(await seriousViolations(page)).toEqual([]);
    const stops = await walkTabOrder(page);
    expect(stops.map((s) => s.label)).toEqual(
      expect.arrayContaining(['Controller buttons', 'Set', 'Cancel']),
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
      expect.arrayContaining(['Press a button for Jump', 'Controller buttons', 'Set', 'Cancel']),
    );
    expect(unseen(stops)).toEqual([]);
    await expect(page.getByRole('status')).toHaveText(
      "Press Jump's button on the controller. Esc cancels.",
    );
  });
});
