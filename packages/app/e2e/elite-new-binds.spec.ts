// Elite with no file of its own, in the real window: StartPreset (in the run folder standing for
// %LOCALAPPDATA%) names the keyboard and mouse preset the game ships, and the game's install
// folder (under the fake Steam folder) holds that preset, a copy of reference/game-files. Elite's
// tile is a game helmArray knows from the preset; the drawer says in one sentence that Apply makes
// the player's file from it; Apply makes Custom.4.1.binds and points StartPreset at it. The game
// "runs" only when the fake process list says so; it never does here. Input is Playwright's own.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './helm';
import type { Seed } from './helm';
import { ELITE_APP_ID, applyInDrawer, countInput, drawer, eliteBinds } from './screens';

const SHIPPED = new URL(
  '../../../reference/game-files/elite-KeyboardMouseOnly.binds',
  import.meta.url,
);
const START =
  'KeyboardMouseOnly\r\nKeyboardMouseOnly\r\nKeyboardMouseOnly\r\nKeyboardMouseOnly\r\n';
const NOTE =
  "Elite Dangerous has no controls file of its own yet, so helmArray makes one from the game's keyboard and mouse preset and sets the game to use it.";
const DONE =
  "Elite Dangerous now has the scheme's controls, in a controls file of its own made from the game's keyboard and mouse preset.";

const schemesOf = (dataDir: string) =>
  join(
    dataDir,
    'steam',
    'steamapps',
    'common',
    'Elite Dangerous',
    'Products',
    'elite-dangerous-odyssey-64',
    'ControlSchemes',
  );

/** Steam lists Elite in its install folder with the preset it ships; the player has no file. */
const shippedOnly: Seed = {
  files: async (dataDir) => {
    const bindings = eliteBinds(dataDir);
    await mkdir(bindings, { recursive: true });
    await writeFile(join(bindings, 'StartPreset.4.start'), START);
    await mkdir(schemesOf(dataDir), { recursive: true });
    await writeFile(join(schemesOf(dataDir), 'KeyboardMouseOnly.binds'), await readFile(SHIPPED));
    await writeFile(
      join(dataDir, 'steam', 'steamapps', `appmanifest_${ELITE_APP_ID}.acf`),
      `"AppState"\n{\n\t"appid"\t\t"${ELITE_APP_ID}"\n\t"name"\t\t"Elite Dangerous"\n\t"installdir"\t\t"Elite Dangerous"\n}\n`,
    );
  },
};

test.describe('Elite with no file of its own', () => {
  test.use({ helmSeed: shippedOnly });

  test("J1 by Game's own keys from its tile: the drawer says the file is made from the shipped preset, and Apply makes it", async ({
    helm,
  }) => {
    const { page, dataDir } = helm;
    const counted = await countInput(page);
    await page.getByRole('button', { name: /^Elite Dangerous\. / }).click();
    await page.getByRole('button', { name: "Game's own keys" }).click();
    await expect(drawer(page)).toBeVisible();

    const gameFile = drawer(page).getByLabel('Game file');
    await expect(gameFile).toContainText('Custom.4.1.binds');
    // The preset's own keys: nothing in it changes, but the file is new.
    await expect(gameFile).toContainText('New file');
    await expect(gameFile).toContainText(NOTE);
    await expect(gameFile).not.toContainText('A copy of the old file is kept.');
    await expect(drawer(page).getByLabel('What is ready')).toContainText(
      'Elite Dangerous is closed.',
    );

    await expect(applyInDrawer(page)).toBeEnabled();
    await applyInDrawer(page).click();
    const result = drawer(page).getByLabel('Result');
    await expect(result).toContainText('Both units now run the layout.');
    await expect(result).toContainText(DONE);
    expect(await counted()).toEqual({ clicks: 3, drags: 0 });

    const bindings = eliteBinds(dataDir);
    const made = await readFile(join(bindings, 'Custom.4.1.binds'));
    const copies = await readdir(join(dataDir, 'backups', 'elite-dangerous'));
    expect({
      folder: (await readdir(bindings)).sort(),
      root: made.toString('utf8').split('\r\n')[1],
      bom: [...made.subarray(0, 3)],
      start: await readFile(join(bindings, 'StartPreset.4.start'), 'utf8'),
      copies: copies.map((c) => c.endsWith(' StartPreset.4.start')),
      shipped: (await readFile(join(schemesOf(dataDir), 'KeyboardMouseOnly.binds'))).equals(
        await readFile(SHIPPED),
      ),
    }).toEqual({
      folder: ['Custom.4.1.binds', 'StartPreset.4.start'],
      root: '<Root PresetName="Custom" MajorVersion="4" MinorVersion="1">',
      bom: [0xef, 0xbb, 0xbf],
      start: 'Custom\r\nCustom\r\nCustom\r\nCustom\r\n',
      copies: [true],
      shipped: true,
    });
  });
});
