// The checks' fix buttons and their groups (the UI audit, summary item 5), in the real window over
// the fake units: each fix is clicked and its finding is gone. Then the keyboard and axe on the
// grouped checks and on the recent games. Input is Playwright's own, into the page.
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './helm';
import {
  contentSize,
  drawer,
  helldiversTile,
  leftUnit,
  seriousViolations,
  startBlankKeys,
  startFrom,
  startKeysScheme,
  unseen,
  walkTabOrder,
} from './screens';

const checks = (page: Page): Locator => page.getByRole('region', { name: 'Checks' });
/** The check row that says `text`. */
const row = (page: Page, text: string | RegExp): Locator =>
  checks(page).locator('.ed-check', { hasText: text });

test.describe('the checks’ fixes', () => {
  test('a blank game’s own keys scheme: every fix clicked, every finding gone', async ({
    helm,
  }) => {
    const { page } = helm;
    await startBlankKeys(page);
    // Six required actions on no button, four of them movement, and both sticks sending nothing.
    const movement = row(page, "4 movement actions aren't on a button.");
    await expect(movement).toBeVisible();
    await expect(checks(page).locator('.ed-check-each')).toHaveCount(1);

    // One finding of the group, opened under "Show each", fixed on its own.
    await checks(page).getByText('Show each').click();
    const forward = row(page, /^Move forward/);
    await forward.getByRole('button', { name: 'Put it on a button' }).click();
    await expect(forward).toHaveCount(0);
    await expect(row(page, "3 movement actions aren't on a button.")).toBeVisible();

    // The group's fix: the other three at once.
    await row(page, '3 movement actions')
      .getByRole('button', { name: 'Put them on buttons' })
      .click();
    await expect(checks(page).getByText(/movement actions/)).toHaveCount(0);

    // Fire: put on the button the presets give it, and that button is selected.
    await row(page, /^Fire/).getByRole('button', { name: 'Put it on a button' }).click();
    await expect(row(page, /^Fire/)).toHaveCount(0);
    await expect(page.locator('.ed-panel-title')).toHaveText('Fire');
    await expect(leftUnit(page).getByRole('button', { name: 'Fire, index 2' })).toBeVisible();

    await row(page, /^Stratagem/)
      .getByRole('button', { name: 'Put it on a button' })
      .click();
    await expect(row(page, /^Stratagem/)).toHaveCount(0);

    // The sticks: the left one gets the movement keys, the right one moves the mouse.
    await row(page, /left stick/)
      .getByRole('button', { name: 'Give it the movement keys' })
      .click();
    await expect(row(page, /left stick/)).toHaveCount(0);
    await row(page, /right stick/)
      .getByRole('button', { name: 'Use it as the mouse' })
      .click();
    await expect(row(page, /right stick/)).toHaveCount(0);

    await expect(checks(page).getByText('Nothing to fix.')).toBeVisible();
  });

  test('a stick sending Xbox among buttons sending keys follows the buttons', async ({ helm }) => {
    const { page } = helm;
    await startKeysScheme(page, {
      blank: false,
      behaviour: { 'L.stick': { stick: { mode: 'pad-left' } } },
    });
    const mixed = row(page, /Xbox stick while the buttons send keys/);
    await mixed.getByRole('button', { name: 'Give it the movement keys' }).click();
    await expect(mixed).toHaveCount(0);
    await expect(checks(page).getByText('Nothing to fix.')).toBeVisible();
  });

  test('a stick set to keys with none, among buttons sending Xbox, becomes a controller stick', async ({
    helm,
  }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    // Its keys turned off another way: the Azerons sent keys, then Controller, and the stick kept
    // keys mode with no keys (a scheme saved by hand, or by an older helmArray).
    await page.evaluate(async () => {
      const helm = (
        window as unknown as {
          helm: {
            listSchemes(gameId: string): Promise<Record<string, unknown>[]>;
            saveScheme(scheme: unknown): Promise<void>;
          };
        }
      ).helm;
      const [scheme] = await helm.listSchemes('helldivers2');
      await helm.saveScheme({
        ...scheme,
        behaviour: {
          ...(scheme?.['behaviour'] as Record<string, unknown>),
          'L.stick': { stick: { mode: 'keys' } },
        },
      });
    });
    await page.getByRole('button', { name: 'Library' }).click();
    await page.getByRole('button', { name: 'Look again' }).click();
    await helldiversTile(page).click();
    const stick = row(page, /left stick/);
    await stick.getByRole('button', { name: 'Use as controller stick' }).click();
    await expect(stick).toHaveCount(0);
    await expect(checks(page).getByText('Nothing to fix.')).toBeVisible();
  });

  test('an action deleted from the game is taken off its button', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await page.getByRole('button', { name: 'Library' }).click();
    // Reload goes from the game (your copy of Helldivers 2).
    await page.getByRole('button', { name: /^Edit actions: / }).click();
    await page.getByRole('button', { name: 'More for Reload' }).click();
    await page.getByRole('button', { name: 'Delete Reload' }).click();
    await page.getByRole('button', { name: 'Library' }).click();
    await helldiversTile(page).click();
    const deleted = row(page, /deleted from/);
    await deleted.getByRole('button', { name: 'Take it off the button' }).click();
    await expect(deleted).toHaveCount(0);
    await expect(leftUnit(page).getByRole('button', { name: 'Empty, middle 1' })).toBeVisible();
  });
});

test.describe('the grouped checks and the recent games: keyboard and axe', () => {
  test('the grouped checks, opened: every stop shows, and axe finds nothing serious', async ({
    helm,
  }) => {
    const { page } = helm;
    await startBlankKeys(page);
    await checks(page).getByText('Show each').click();
    expect(await seriousViolations(page)).toEqual([]);
    const stops = await walkTabOrder(page);
    expect(stops.map((s) => s.label)).toEqual(
      expect.arrayContaining([
        'Show each',
        'Put them on buttons',
        'Put it on a button',
        'Give it the movement keys',
        'Keep, I know',
      ]),
    );
    expect(unseen(stops)).toEqual([]);
  });

  test('the recent games: every stop shows, and axe finds nothing serious', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await page.getByRole('button', { name: 'Library' }).click();
    await page.getByRole('button', { name: /^Set up / }).click();
    const field = page.getByRole('textbox', { name: 'New action' });
    await field.fill('Jump');
    await field.press('Enter');
    await page.keyboard.press('Space');
    await page
      .getByRole('group', { name: 'New scheme from' })
      .getByRole('button', { name: 'Xbox controller' })
      .click();
    await drawer(page).getByRole('button', { name: 'Cancel' }).click();
    const recent = page.getByRole('navigation', { name: 'Recent games' });
    await expect(recent.getByRole('button')).toHaveCount(1);
    expect(await seriousViolations(page)).toEqual([]);
    const stops = await walkTabOrder(page);
    expect(stops.map((s) => s.label)).toEqual(
      expect.arrayContaining([expect.stringMatching(/HELLDIVERS|Helldivers 2/)]),
    );
    expect(unseen(stops)).toEqual([]);
  });
});

/** Helldivers 2's Editor with the other game, set up and given a scheme, in its recent games. */
async function withARecentGame(page: Page) {
  await startFrom(page, 'Xbox controller');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: /^Set up / }).click();
  const field = page.getByRole('textbox', { name: 'New action' });
  await field.fill('Jump');
  await field.press('Enter');
  await page.keyboard.press('Space');
  await page
    .getByRole('group', { name: 'New scheme from' })
    .getByRole('button', { name: 'Xbox controller' })
    .click();
  await drawer(page).getByRole('button', { name: 'Cancel' }).click();
  await page
    .getByRole('navigation', { name: 'Recent games' })
    .getByRole('button', { name: /HELLDIVERS|Helldivers 2/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Helldivers 2' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Recent games' }).getByRole('button'),
  ).toHaveCount(1);
}

for (const [width, height] of [
  [1280, 900],
  [1280, 720],
] as const) {
  test(`the recent games fit the Editor's bar at ${width} x ${height}: one row, no scroll`, async ({
    helm,
  }) => {
    const { page } = helm;
    await contentSize(helm, width, height);
    await withARecentGame(page);
    const layout = await page.evaluate(() => {
      const bar = document.querySelector('.ed-bar') as HTMLElement;
      // One row: no child starts below where the first one ends.
      const boxes = [...bar.children]
        .map((c) => c.getBoundingClientRect())
        .filter((b) => b.height > 0);
      const firstBottom = Math.min(...boxes.map((b) => b.bottom));
      const units = [...document.querySelectorAll('.unit')].map((u) => {
        const r = u.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight + 1;
      });
      const root = document.scrollingElement as HTMLElement;
      return {
        rows: boxes.some((b) => b.top >= firstBottom) ? 2 : 1,
        scrolls: root.scrollHeight > root.clientHeight || root.scrollWidth > root.clientWidth,
        unitsInView: units,
      };
    });
    expect(layout).toEqual({ rows: 1, scrolls: false, unitsInView: [true, true] });
  });
}

// Codex, on #106: with every Xbox control a button may send in use, "Put it on a button" did
// nothing. It is offered only when it works; until then the check says why.
test('a required action with every controller button in use says so, and is fixed once one is free', async ({
  helm,
}) => {
  const { page } = helm;
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
    const pads = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'BACK', 'START', 'LS', 'RS'];
    const all = [...pads, 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', null];
    await helm.saveGame({
      id: 'crowded',
      name: 'Crowded',
      modes: [{ id: 'default', name: 'Default' }],
      actions: all.map((pad, i) => ({
        id: `a${i}`,
        name: `Action ${i}`,
        mode: 'default',
        role: 'combat',
        required: true,
        ...(pad === null ? {} : { native: { pad } }),
      })),
    });
    const made = await helm.createScheme('crowded', 'xbox');
    await helm.setActive('crowded', made.id);
  });
  await page.getByRole('button', { name: 'Look again' }).click();
  await page.locator('.tile', { hasText: 'Crowded' }).locator('.tile-button').click();
  await expect(page.getByRole('heading', { name: 'Crowded' })).toBeVisible();

  const last = row(page, /^Action 16/);
  await expect(last).toContainText('Every controller button is in use; clear one first.');
  await expect(last.getByRole('button', { name: 'Put it on a button' })).toHaveCount(0);

  // One button cleared: its own action and Action 16 can each go on it, so each offers the fix.
  await leftUnit(page)
    .getByRole('button', { name: /, index 1$/ })
    .click();
  await page.getByRole('button', { name: 'Clear tap' }).click();
  // The two are one line now; its own fix isn't offered, as only one of them can go.
  const group = row(page, "2 combat actions aren't on a button.");
  await expect(group).toBeVisible();
  await expect(group.getByRole('button', { name: 'Put them on buttons' })).toHaveCount(0);
  await checks(page).getByText('Show each').click();
  await last.getByRole('button', { name: 'Put it on a button' }).click();
  await expect(last).toHaveCount(0);
  // On the first empty button that can send it, the freed Xbox control; that button is selected.
  await expect(page.locator('.ed-panel-title')).toHaveText('Action 16');
});

// Codex, on #109: a fix for a finding in another mode put the action on in that mode, but the
// Editor stayed where it was. It now goes there: the finding's mode, the control, its press.
test.describe('a fix in the other mode, on a two-mode game', () => {
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
      const act = (id: string, name: string, mode: string, required: boolean, pad?: string) => ({
        id,
        name,
        mode,
        role: 'movement',
        required,
        ...(pad === undefined ? {} : { native: { pad } }),
      });
      await helm.saveGame({
        id: 'two_modes',
        name: 'Two Modes',
        modes: [
          { id: 'ship', name: 'Ship' },
          { id: 'foot', name: 'On foot' },
        ],
        actions: [
          act('boost', 'Boost', 'ship', true, 'A'),
          act('jump', 'Jump', 'foot', true, 'A'),
          act('run', 'Run', 'foot', true),
          act('wave', 'Wave', 'foot', false),
        ],
      });
      const made = await helm.createScheme('two_modes', 'xbox');
      await helm.setActive('two_modes', made.id);
    });
    await page.getByRole('button', { name: 'Look again' }).click();
    await page.locator('.tile', { hasText: 'Two Modes' }).locator('.tile-button').click();
    await expect(page.getByRole('heading', { name: 'Two Modes' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Ship' })).toHaveAttribute('aria-selected', 'true');
  }

  test('the fix goes to On foot, selects the button, and the next edit lands there', async ({
    helm,
  }) => {
    const { page } = helm;
    await twoModes(page);
    await row(page, /^Run/).getByRole('button', { name: 'Put it on a button' }).click();
    await expect(page.getByRole('tab', { name: 'On foot' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('.ed-panel-title')).toHaveText('Run');
    const where = (await page.locator('.ed-panel .ed-lbl').first().textContent()) ?? '';
    const position = where.split(' · ')[1]?.toLowerCase() ?? '';

    // The next edit: Wave on that same button's tap, in On foot.
    await page.locator('.ed-actions').getByRole('button', { name: /^Wave/ }).click();
    await expect(page.locator('.ed-panel-title')).toHaveText('Wave');
    await page.getByRole('tab', { name: 'Ship' }).click();
    await expect(leftUnit(page).getByRole('button', { name: `Empty, ${position}` })).toBeVisible();
  });

  test('undo goes back to the mode of the edit it undoes', async ({ helm }) => {
    const { page } = helm;
    await twoModes(page);
    await row(page, /^Run/).getByRole('button', { name: 'Put it on a button' }).click();
    await page.getByRole('tab', { name: 'Ship' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('tab', { name: 'On foot' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('a finding’s sentence, clicked, shows its mode', async ({ helm }) => {
    const { page } = helm;
    await twoModes(page);
    await row(page, /^Run/).locator('.ed-check-go').click();
    await expect(page.getByRole('tab', { name: 'On foot' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
