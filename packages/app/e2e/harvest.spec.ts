// A game's own file read into its data, in the real window: Everspace 2's Input.ini (a copy of
// reference/game-files, in the run folder standing for %LOCALAPPDATA%), Steam listing the game,
// and no data for it in the app. Its tile is a game helmArray knows, J1 from it takes the clicks a
// game that ships with helmArray takes, and the Game screen reads the file again, showing what
// changes before it saves. The game "runs" only when the fake process list says so; it never does
// here. Input is Playwright's own.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './helm';
import type { Seed } from './helm';
import { applyInDrawer, countInput, drawer } from './screens';

const REFERENCE = new URL(
  '../../../reference/game-files/everspace2-Input.before.ini',
  import.meta.url,
);
const ES2_APP_ID = '1128920';

const iniOf = (dataDir: string) =>
  join(dataDir, 'local', 'ES2', 'Saved', 'Config', 'Windows', 'Input.ini');
const savedGame = (dataDir: string) => join(dataDir, 'games', 'everspace2.json');

/** Steam lists Everspace 2, and its file is where the game keeps it. No game data in the app. */
const everspace2: Seed = {
  files: async (dataDir) => {
    const ini = iniOf(dataDir);
    await mkdir(join(ini, '..'), { recursive: true });
    await writeFile(ini, await readFile(REFERENCE));
    await writeFile(
      join(dataDir, 'steam', 'steamapps', `appmanifest_${ES2_APP_ID}.acf`),
      `"AppState"\n{\n\t"appid"\t\t"${ES2_APP_ID}"\n\t"name"\t\t"EVERSPACE™ 2"\n\t"installdir"\t\t"EVERSPACE 2"\n}\n`,
    );
  },
};

const tile = (page: Page) => page.getByRole('button', { name: /^Everspace 2\. / });

test.describe("Everspace 2's file as the head start", () => {
  test.use({ helmSeed: everspace2 });

  test('J1 from its tile is 3 clicks, as for a game that ships with helmArray', async ({
    helm,
  }) => {
    const { page } = helm;
    const counted = await countInput(page);
    await expect(page.getByRole('button', { name: 'Set up Everspace 2' })).toHaveCount(0);
    await tile(page).click();
    await page.getByRole('button', { name: 'Xbox controller' }).click();
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).getByLabel('Game file')).toContainText('Input.ini');
    await applyInDrawer(page).click();
    const result = drawer(page).getByLabel('Result');
    await expect(result).toContainText('Both units now run the layout.');
    await expect(result).toContainText('Everspace 2 already has these controls.');
    expect(await counted()).toEqual({ clicks: 3, drags: 0 });
    // Saved by making the scheme, a moment later as every edit is.
    await expect
      .poll(async () => {
        const saved = JSON.parse(
          await readFile(savedGame(helm.dataDir), 'utf8').catch(() => '{}'),
        ) as { steamAppId?: number; file?: { format: string }; actions?: unknown[] };
        return [saved.steamAppId, saved.file, (saved.actions?.length ?? 0) > 50];
      })
      .toEqual([1128920, { format: 'unreal-ini' }, true]);
  });

  test("Game's own keys from its tile is 3 clicks too: the units send the file's own keys", async ({
    helm,
  }) => {
    const { page } = helm;
    const counted = await countInput(page);
    await tile(page).click();
    await page.getByRole('button', { name: "Game's own keys" }).click();
    await expect(drawer(page)).toBeVisible();
    // Boost goes on a button with the key the file has for it, so the file already holds it.
    await expect(drawer(page)).toContainText('Boost [HOLD]');
    await expect(drawer(page).getByLabel('Game file')).toContainText('No change');
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel('Result')).toContainText(
      'Everspace 2 already has these controls.',
    );
    expect(await counted()).toEqual({ clicks: 3, drags: 0 });
  });

  test('the Game screen reads the file again, shows what changes, and saves it with one button', async ({
    helm,
  }) => {
    const { page } = helm;
    await page.getByRole('button', { name: 'Edit actions: Everspace 2' }).click();
    await expect(
      page.getByText("Read from the game's file", { exact: true }).first(),
    ).toBeVisible();
    const read = page.getByRole('button', { name: "Read from the game's file" });

    await read.click();
    const found = page.getByRole('region', { name: "From the game's file" });
    await expect(found).toContainText("Nothing to change from Everspace 2's file.");
    await found.getByRole('button', { name: 'Close' }).click();

    // The game rebinds Photo mode in its own menu: its line in the file names another key.
    const ini = iniOf(helm.dataDir);
    const text = await readFile(ini, 'utf8');
    const photo = text
      .split('\n')
      .find((l) => l.includes('Action=ActionFreeze,') && l.includes('GroupName="Keyboard"'));
    expect(photo).toBeDefined();
    await writeFile(ini, text.replace(photo ?? '', (photo ?? '').replace('Key1=Z,', 'Key1=J,')));

    await read.click();
    await expect(found).toContainText('Photo mode: default key Z → J.');
    const counted = await countInput(page);
    await found.getByRole('button', { name: 'Save these changes' }).click();
    await expect(found).toHaveCount(0);
    expect(await counted()).toEqual({ clicks: 1, drags: 0 });
    await expect
      .poll(async () => {
        const saved = JSON.parse(
          await readFile(savedGame(helm.dataDir), 'utf8').catch(() => '{}'),
        ) as {
          actions?: { id: string; native?: { key?: { code: string } } }[];
        };
        return saved.actions?.find((a) => a.id === 'ActionFreeze')?.native?.key?.code ?? null;
      })
      .toBe('J');
    // Reading never wrote the game's file, and kept no copy of it.
    expect(await readdir(join(helm.dataDir, 'backups')).catch(() => [])).toEqual([]);
  });
});
