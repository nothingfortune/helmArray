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
import { applyInDrawer, countInput, drawer, editorApply, seriousViolations } from './screens';

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

  test('Xbox controller from its tile opens the editor on the sticks: Everspace 2 needs them to send keys, two fixes, then Apply', async ({
    helm,
  }) => {
    const { page } = helm;
    const counted = await countInput(page);
    await expect(
      page.getByRole('button', { name: /^Set up (EVERSPACE™ 2|Everspace 2)$/ }),
    ).toHaveCount(0);
    await tile(page).click();
    await page.getByRole('button', { name: 'Xbox controller' }).click();
    // Something to fix, so the drawer stays shut: an Xbox stick makes Everspace 2 stutter.
    await expect(
      page.getByText(/stick must send keys: Everspace 2 stutters with an Xbox stick/).first(),
    ).toBeVisible();
    await expect(drawer(page)).toHaveCount(0);
    expect(await counted()).toEqual({ clicks: 2, drags: 0 });
    // Each stick's fix gives it the game's keys for its directions; the stutter rule is met.
    for (const hand of ['left', 'right']) {
      await page
        .locator('.ed-check', { hasText: `The ${hand} stick` })
        .getByRole('button', { name: 'Give it the movement keys' })
        .click();
    }
    await expect(page.locator('.ed-check', { hasText: /stick must send keys/ })).toHaveCount(0);
    // What stays is a warning, not an error: keys from the sticks beside Xbox buttons.
    await expect(
      page.locator('.ed-check', {
        hasText: 'This stick sends keys while the buttons are an Xbox controller.',
      }),
    ).toHaveCount(2);
    await editorApply(page).click();
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel('Result')).toContainText('Both units now run the layout.');
    expect(await counted()).toEqual({ clicks: 6, drags: 0 });
    // Saved by making the scheme, a moment later as every edit is, with the rule kept in it.
    await expect
      .poll(async () => {
        const saved = JSON.parse(
          await readFile(savedGame(helm.dataDir), 'utf8').catch(() => '{}'),
        ) as {
          steamAppId?: number;
          file?: { format: string };
          actions?: unknown[];
          needsKeyStick?: boolean;
        };
        return [
          saved.steamAppId,
          saved.file,
          (saved.actions?.length ?? 0) > 50,
          saved.needsKeyStick,
        ];
      })
      .toEqual([1128920, { format: 'unreal-ini' }, true, true]);
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
    // The list open: nothing serious for axe, and the window itself doesn't scroll.
    expect(await seriousViolations(page)).toEqual([]);
    expect(
      await page.evaluate(() => {
        const doc = document.scrollingElement ?? document.documentElement;
        return doc.scrollHeight > window.innerHeight || doc.scrollWidth > window.innerWidth;
      }),
    ).toBe(false);
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

const ELITE_BINDS = new URL(
  '../../../reference/game-files/elite-Custom.4.1.binds',
  import.meta.url,
);
const ELITE_APP_ID = '359320';

/** Steam lists Elite, and the player's own bindings are where the game keeps them. */
const elite: Seed = {
  files: async (dataDir) => {
    const bindings = join(
      dataDir,
      'local',
      'Frontier Developments',
      'Elite Dangerous',
      'Options',
      'Bindings',
    );
    await mkdir(bindings, { recursive: true });
    await writeFile(join(bindings, 'Custom.4.1.binds'), await readFile(ELITE_BINDS));
    await writeFile(join(bindings, 'StartPreset.4.start'), 'Custom\r\nCustom\r\nCustom\r\nCustom');
    await writeFile(
      join(dataDir, 'steam', 'steamapps', `appmanifest_${ELITE_APP_ID}.acf`),
      `"AppState"\n{\n\t"appid"\t\t"${ELITE_APP_ID}"\n\t"name"\t\t"Elite Dangerous"\n\t"installdir"\t\t"Elite Dangerous"\n}\n`,
    );
  },
};

test.describe("Elite's file as the head start", () => {
  test.use({ helmSeed: elite });

  for (const preset of ['Xbox controller', "Game's own keys"]) {
    test(`J1 by ${preset} from its tile is 3 clicks`, async ({ helm }) => {
      const { page } = helm;
      const counted = await countInput(page);
      await page.getByRole('button', { name: /^Elite Dangerous\. / }).click();
      await page.getByRole('button', { name: preset }).click();
      await expect(drawer(page)).toBeVisible();
      await expect(drawer(page).getByLabel('Game file')).toContainText('Custom.4.1.binds');
      await applyInDrawer(page).click();
      await expect(drawer(page).getByLabel('Result')).toContainText(
        'Both units now run the layout.',
      );
      expect(await counted()).toEqual({ clicks: 3, drags: 0 });
    });
  }
});

const NOTHING = "Everspace 2's controls file has nothing helmArray can read.";
const HARVEST = new URL('../../games/src/__fixtures__/everspace2.harvest.json', import.meta.url);

/** Steam lists Everspace 2, whose Input.ini holds comments and another section only. */
const unreadable: Seed = {
  files: async (dataDir) => {
    await everspace2.files(dataDir);
    await writeFile(
      iniOf(dataDir),
      '; nothing\r\n[/Script/Engine.InputSettings]\r\nbAltEnterTogglesFullscreen=True\r\n',
    );
  },
};

test.describe('Everspace 2 with a file helmArray can read nothing from', () => {
  test.use({ helmSeed: unreadable });

  test('its tile says Set up, and the Game screen says why in one sentence', async ({ helm }) => {
    const { page } = helm;
    // Steam's own name, as for any game helmArray has no data for.
    await page.getByRole('button', { name: 'Set up EVERSPACE™ 2' }).click();
    await expect(page.getByRole('textbox', { name: 'Game name' })).toHaveValue('EVERSPACE™ 2');
    await expect(page.getByText(NOTHING)).toBeVisible();
  });
});

/** Everspace 2's data in the app, and then its file emptied by the game. */
const emptiedLater: Seed = {
  files: async (dataDir) => {
    await everspace2.files(dataDir);
    const { game } = JSON.parse(await readFile(HARVEST, 'utf8')) as { game: object };
    await mkdir(join(dataDir, 'games'), { recursive: true });
    await writeFile(
      join(dataDir, 'games', 'everspace2.json'),
      JSON.stringify({ schemaVersion: 1, ...game, steamAppId: 1128920 }),
    );
    await writeFile(iniOf(dataDir), '');
  },
};

test.describe('Everspace 2 read again once its file is empty', () => {
  test.use({ helmSeed: emptiedLater });

  test('says the file has nothing it can read, and saves nothing', async ({ helm }) => {
    const { page } = helm;
    const before = await readFile(savedGame(helm.dataDir), 'utf8');
    await page.getByRole('button', { name: 'Edit actions: Everspace 2' }).click();
    await page.getByRole('button', { name: "Read from the game's file" }).click();
    const found = page.getByRole('alert', { name: "From the game's file" });
    await expect(found).toContainText(NOTHING);
    await expect(found.getByRole('button', { name: 'Save these changes' })).toHaveCount(0);
    expect(await readFile(savedGame(helm.dataDir), 'utf8')).toBe(before);
  });
});

/** Everspace 2's data in the app, read from its file and used, a name of yours on it. */
const usedOnce: Seed = {
  files: async (dataDir) => {
    await everspace2.files(dataDir);
    const { game } = JSON.parse(await readFile(HARVEST, 'utf8')) as { game: object };
    await mkdir(join(dataDir, 'games'), { recursive: true });
    await writeFile(
      join(dataDir, 'games', 'everspace2.json'),
      JSON.stringify({ schemaVersion: 1, ...game, name: 'My Everspace', steamAppId: 1128920 }),
    );
  },
};

test.describe('Everspace 2 read from its file, then deleted', () => {
  test.use({ helmSeed: usedOnce });

  test('stays deleted, and Set up on its tile reads the file afresh: 3 clicks to apply from there', async ({
    helm,
  }) => {
    const { page } = helm;
    await page.getByRole('button', { name: 'Edit actions: My Everspace' }).click();
    await page.getByRole('button', { name: 'Delete game' }).click();
    await page
      .getByRole('group', { name: 'Are you sure?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    // Back in the Library: the game isn't found from its file again, its tile is Steam's Set up.
    const setUp = page.getByRole('button', { name: 'Set up EVERSPACE™ 2' });
    await expect(setUp).toBeVisible();
    await expect(tile(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^My Everspace\. / })).toHaveCount(0);
    await expect
      .poll(async () => {
        const settings = JSON.parse(
          await readFile(join(helm.dataDir, 'settings.json'), 'utf8').catch(() => '{}'),
        ) as { dismissed?: string[] };
        return settings.dismissed;
      })
      .toEqual(['everspace2']);

    const counted = await countInput(page);
    await setUp.click();
    // The file read afresh: helmArray's name for the game, not yours, and every action in it.
    await expect(page.getByRole('textbox', { name: 'Game name' })).toHaveValue('Everspace 2');
    await page.getByRole('button', { name: "Game's own keys" }).click();
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).getByLabel('Game file')).toContainText('Input.ini');
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel('Result')).toContainText(
      'Everspace 2 already has these controls.',
    );
    expect(await counted()).toEqual({ clicks: 3, drags: 0 });
    await expect
      .poll(async () => {
        const saved = JSON.parse(
          await readFile(savedGame(helm.dataDir), 'utf8').catch(() => '{}'),
        ) as { name?: string; needsKeyStick?: boolean };
        return [saved.name, saved.needsKeyStick];
      })
      .toEqual(['Everspace 2', true]);
  });
});

/** Everspace 2 typed in by hand under its Steam id before its file was read: two actions of yours. */
const typedByHand: Seed = {
  files: async (dataDir) => {
    await everspace2.files(dataDir);
    await mkdir(join(dataDir, 'games'), { recursive: true });
    const action = (id: string, name: string) => ({ id, name, mode: 'flight', required: false });
    await writeFile(
      join(dataDir, 'games', 'everspace_2.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'everspace_2',
        name: 'Everspace 2',
        steamAppId: 1128920,
        modes: [{ id: 'flight', name: 'Flight' }],
        actions: [action('boost_hold', 'boost [hold]'), action('wave', 'Wave')],
      }),
    );
  },
};

test.describe('Everspace 2 typed in by hand, then read from its file', () => {
  test.use({ helmSeed: typedByHand });

  test("reads the file into that game, and an action of yours the file has too isn't shown twice", async ({
    helm,
  }) => {
    const { page } = helm;
    // One tile for the game: the file isn't found as a second one.
    await expect(page.getByRole('button', { name: /^Everspace 2\. / })).toHaveCount(1);
    await page.getByRole('button', { name: 'Edit actions: Everspace 2' }).click();
    await page.getByRole('button', { name: "Read from the game's file" }).click();
    const found = page.getByRole('region', { name: "From the game's file" });
    await expect(found).toContainText(
      "boost [hold] is in the file too: yours stays, and the file's isn't added beside it.",
    );
    await found.getByRole('button', { name: 'Save these changes' }).click();
    await expect(found).toHaveCount(0);
    await expect
      .poll(async () => {
        const saved = JSON.parse(
          await readFile(join(helm.dataDir, 'games', 'everspace_2.json'), 'utf8').catch(() => '{}'),
        ) as { actions?: { id: string; name: string }[] };
        const ids = (saved.actions ?? []).map((a) => a.id);
        return [
          ids.includes('boost_hold'),
          ids.includes('Boost'),
          ids.includes('wave'),
          ids.length > 50,
        ];
      })
      .toEqual([true, false, true, true]);
    // On the screen: yours, once, and no row for the file's of the same name.
    await expect(
      page.getByRole('textbox', { name: 'boost [hold], name', exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole('textbox', { name: 'Boost [HOLD], name', exact: true }),
    ).toHaveCount(0);
  });
});

/** Steam lists Everspace 2, which hasn't saved an Input.ini yet: no control changed in its menu. */
const noIniYet: Seed = {
  files: async (dataDir) => {
    await writeFile(
      join(dataDir, 'steam', 'steamapps', `appmanifest_${ES2_APP_ID}.acf`),
      `"AppState"
{
	"appid"		"${ES2_APP_ID}"
	"name"		"EVERSPACE™ 2"
	"installdir"		"EVERSPACE 2"
}
`,
    );
  },
};

test.describe('Everspace 2 with no Input.ini yet', () => {
  test.use({ helmSeed: noIniYet });

  test('its tile says Set up, and the Game screen says why in one sentence', async ({ helm }) => {
    const { page } = helm;
    await page.getByRole('button', { name: 'Set up EVERSPACE™ 2' }).click();
    await expect(page.getByRole('textbox', { name: 'Game name' })).toHaveValue('EVERSPACE™ 2');
    await expect(
      page.getByText(
        "helmArray can't find Everspace 2's controls file yet: changing any control in the game's own menu makes the game save one.",
      ),
    ).toBeVisible();
  });
});
