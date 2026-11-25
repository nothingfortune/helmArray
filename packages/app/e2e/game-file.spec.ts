// M5's game-file target in the real window: Everspace 2's Input.ini (a copy of
// reference/game-files, in the run folder standing for %LOCALAPPDATA%) written by Apply after the
// units. The game's data is the reviewed harvest of that file
// (packages/games/src/__fixtures__/everspace2.harvest.json), saved where the app keeps games:
// putting a harvest into the app is a later part of M5. The game "runs" when the fake list of
// running programs says its test program does (E2E_GAME_PROGRAMS). Input is Playwright's own.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { E2E_GAME_PROGRAMS } from '../src/main/e2e-seam';
import { expect, test } from './helm';
import type { Seed } from './helm';
import { applyInDrawer, countInput, drawer, editorApply, leftUnit } from './screens';

const REFERENCE = new URL(
  '../../../reference/game-files/everspace2-Input.before.ini',
  import.meta.url,
);
const HARVEST = new URL('../../games/src/__fixtures__/everspace2.harvest.json', import.meta.url);
const PROGRAM = E2E_GAME_PROGRAMS['unreal-ini'];

const iniOf = (dataDir: string) =>
  join(dataDir, 'local', 'ES2', 'Saved', 'Config', 'Windows', 'Input.ini');

/** Everspace 2's file where the game keeps it, and its data where the app keeps games. */
const everspace2: Seed = {
  files: async (dataDir) => {
    const ini = iniOf(dataDir);
    await mkdir(join(ini, '..'), { recursive: true });
    await writeFile(ini, await readFile(REFERENCE));
    const { game } = JSON.parse(await readFile(HARVEST, 'utf8')) as { game: object };
    await mkdir(join(dataDir, 'games'), { recursive: true });
    await writeFile(
      join(dataDir, 'games', 'everspace2.json'),
      JSON.stringify({ schemaVersion: 1, ...game }),
    );
  },
};

const gameFile = (page: Page) => drawer(page).getByLabel('Game file');

/** J1 on Everspace 2: its tile, then the preset; the drawer opens by itself. */
async function openEverspace2(page: Page) {
  await page.getByRole('button', { name: /^Everspace 2\. / }).click();
  await page.getByRole('button', { name: 'Xbox controller' }).click();
  await expect(drawer(page)).toBeVisible();
}

test.describe("the game's file in Apply", () => {
  test.use({ helmSeed: everspace2 });

  test('J1 on Everspace 2 is still 3 clicks; the file holds the preset already, so is left as it is', async ({
    helm,
  }) => {
    const { page } = helm;
    const before = await readFile(iniOf(helm.dataDir));
    const counted = await countInput(page);
    await openEverspace2(page);

    // The file is its own target, and the game closed is said beside the Azeron app. The preset
    // puts each action on the Xbox control the game ships it on: the file has them all already.
    await expect(gameFile(page)).toContainText('Input.ini');
    await expect(gameFile(page)).toContainText('No change');
    await expect(gameFile(page)).toContainText('It already holds these bindings.');
    await expect(drawer(page).getByLabel('What is ready')).toContainText(
      'The Azeron app is closed.',
    );
    await expect(drawer(page).getByLabel('What is ready')).toContainText('Everspace 2 is closed.');
    await expect(drawer(page).getByLabel("In the game's controls")).toHaveCount(0);

    await expect(applyInDrawer(page)).toBeEnabled();
    await applyInDrawer(page).click();
    const result = drawer(page).getByLabel('Result');
    await expect(result).toContainText('Both units now run the layout.');
    await expect(result).toContainText('Everspace 2 already has these controls.');
    expect(await counted()).toEqual({ clicks: 3, drags: 0 });
    expect({
      same: (await readFile(iniOf(helm.dataDir))).equals(before),
      copies: await readdir(join(helm.dataDir, 'backups')).catch(() => []),
    }).toEqual({ same: true, copies: [] });
  });

  test('an action dragged onto a button, then Apply: the file gets its new controller binding', async ({
    helm,
  }) => {
    const { page } = helm;
    const before = await readFile(iniOf(helm.dataDir));
    await openEverspace2(page);
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel('Result')).toContainText('Both units now run the layout.');
    await drawer(page).getByRole('button', { name: 'Close' }).click();

    // Photo mode is on a key only. Dropped on the button carrying Hover up, it takes that button's
    // Xbox control: the game's controller bindings for both change.
    await page
      .locator('.ed-actions')
      .getByRole('button', { name: /^Photo mode/ })
      .dragTo(leftUnit(page).getByRole('button', { name: /^Hover up/ }));
    await editorApply(page).click();
    await expect(gameFile(page)).toContainText(/\d bindings?/);
    await expect(gameFile(page)).toContainText(/Photo mode · /);
    await expect(gameFile(page)).toContainText('A copy of the old file is kept.');
    await expect(applyInDrawer(page)).toBeEnabled();
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel('Result')).toContainText(
      "Everspace 2 now has the scheme's controls, and a copy of its old file is kept.",
    );

    const copies = await readdir(join(helm.dataDir, 'backups', 'everspace2'));
    expect({
      changed: !(await readFile(iniOf(helm.dataDir))).equals(before),
      copies: copies.length,
      copy: (await readFile(join(helm.dataDir, 'backups', 'everspace2', copies[0] ?? ''))).equals(
        before,
      ),
    }).toEqual({ changed: true, copies: 1, copy: true });
  });

  test('waits for the game to close, then applies: closing it is all it takes', async ({
    helm,
  }) => {
    const { page } = helm;
    await helm.setProcesses([PROGRAM]);
    const counted = await countInput(page);
    await openEverspace2(page);

    const ready = drawer(page).getByLabel('What is ready');
    await expect(ready).toContainText('Close Everspace 2 to apply.');
    await expect(applyInDrawer(page)).toBeDisabled();
    expect((await helm.units()).map((u) => u.writesReceived)).toEqual([0, 0]);

    await helm.setProcesses([]);
    await expect(ready).toContainText('Everspace 2 is closed.');
    await expect(applyInDrawer(page)).toBeEnabled();
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel('Result')).toContainText('Both units now run the layout.');
    expect(await counted()).toEqual({ clicks: 3, drags: 0 });
  });

  test("says how to make the file when the game hasn't saved one yet, and writes no unit", async ({
    helm,
  }) => {
    const { page } = helm;
    await rm(iniOf(helm.dataDir));
    await openEverspace2(page);
    await expect(drawer(page).getByLabel('What is ready')).toContainText(
      "helmArray can't find Everspace 2's controls file: change any control in the game's own menu once, then apply.",
    );
    await expect(applyInDrawer(page)).toBeDisabled();
    expect((await helm.units()).map((u) => u.writesReceived)).toEqual([0, 0]);
  });
});
