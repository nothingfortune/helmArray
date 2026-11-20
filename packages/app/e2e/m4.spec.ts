// The M4 screens, driven in the real window over the fake units (docs/plans/04-roadmap.md, M4
// "Done when": J1 takes 2 clicks, J2 is a drag plus Apply on Helldivers 2). Input is Playwright's
// own, into the page: no OS-level keyboard or mouse input is ever sent.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './helm';
import {
  AZERON_APP,
  CLOSE_AZERON_FIRST,
  applyInDrawer,
  drawer,
  helldivers,
  keepEveryCheck,
  pill,
  schemeFiles,
  startFrom,
} from './screens';

/** The unit's code for the W key: 0xF000 | its HID usage (packages/azeron `UNIT_KEY_CODES`). */
const KEY_W = 0xf01a;

test.describe('the M4 screens', () => {
  test('the Library lists the Steam games from the temp folder, with a cover that loads', async ({
    helm,
  }) => {
    const { page } = helm;
    await expect(page.getByRole('heading', { name: 'Games' })).toBeVisible();
    await expect(page.getByLabel('Left, ready')).toBeVisible();
    await expect(page.getByLabel('Right, ready')).toBeVisible();
    // The only devices ever opened are the two fake units' (the fake paths end in e2e-left / -right).
    expect((await helm.opened()).map((path) => path.split('#').pop()).sort()).toEqual([
      'e2e-left',
      'e2e-right',
    ]);
    await expect(helldivers(page)).toHaveAttribute('aria-label', /Not set up/);
    await expect(page.getByText('A Game Nobody Wrote Yet')).toBeVisible();
    await expect(page.getByText('Not supported yet')).toBeVisible();
    // The helm-cover:// protocol served the file the Steam read found.
    const cover = page.locator('.tile', { hasText: 'HELLDIVERS' }).locator('img.art');
    await expect(cover).toBeVisible();
    await expect
      .poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
  });

  test('J1: Helldivers 2, then Xbox controller, then Apply, with nothing to keep first', async ({
    helm,
  }) => {
    // Helldivers 2 ships its Xbox defaults (packages/core/src/games/helldivers2.ts), so the
    // preset puts all six required actions on buttons and the left stick: nothing is flagged.
    // J1 is two clicks, the game and the preset, then Apply.
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await expect(page.getByRole('button', { name: 'Keep, I know' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(applyInDrawer(page)).toBeEnabled({ timeout: 3000 });
  });

  test('J1: Helldivers 2, Xbox controller, Apply: both units hold it and the pill says In sync', async ({
    helm,
  }) => {
    const { page } = helm;
    expect(await helm.units()).toMatchObject([
      { slots: [{ name: 'Default' }] },
      { slots: [{ name: 'Default' }, { name: 'Old layout' }] },
    ]);
    await expect(pill(page)).toHaveText('Not checked yet');

    await startFrom(page, 'Xbox controller');
    // Nothing is flagged, so nothing is kept (see the test above).
    await expect(page.getByRole('button', { name: 'Keep, I know' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();

    await expect(drawer(page)).toBeVisible();
    await expect(applyInDrawer(page)).toBeEnabled();
    await expect(drawer(page).getByLabel('What is ready')).toContainText(
      'The Azeron app is closed.',
    );
    await expect(drawer(page).getByLabel('Left Azeron')).toContainText('"Xbox controller"');
    await expect(drawer(page).getByLabel('Right Azeron')).toContainText('"Xbox controller"');
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel('Result')).toContainText('Both units now run the layout.');
    await drawer(page).getByRole('button', { name: 'Close' }).click();

    // What the fake units hold: the scheme as the only slot, and it is the one they run.
    await expect
      .poll(async () => (await helm.units()).map((u) => u.slots.map((s) => s.name)))
      .toEqual([['Xbox controller'], ['Xbox controller']]);
    for (const unit of await helm.units()) {
      expect(unit.slots).toHaveLength(1);
      expect(unit.running).toBe(unit.slots[0]?.slot);
      expect(unit.slots[0]?.inputs).toBeGreaterThan(0);
    }
    await expect(pill(page)).toHaveText('In sync');
    await expect(pill(page)).toHaveClass(/tone-ok/);

    // Back in the Library the card says what is on the Azerons now; the data folder has it too.
    await page.getByRole('button', { name: 'Library' }).click();
    const card = page.getByLabel('On your Azerons now');
    await expect(card).toContainText('HELLDIVERS™ 2 · Xbox controller');
    await expect(card).toContainText('Applied · Controller');
    expect(await schemeFiles(helm.dataDir)).toHaveLength(1);
    expect(await readdir(join(helm.dataDir, 'applied'))).toHaveLength(1);
  });

  test('J2: drag an action onto a button, Apply, and the unit holds that key', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, "Game's own keys");
    const left = page.locator('.unit[data-hand="left"]');
    const button = left.getByRole('button', { name: 'Empty, index 1' });
    const action = page.locator('.ed-actions').getByRole('button', { name: 'Move forward' });

    await action.dragTo(button);
    await expect(left.getByRole('button', { name: 'Move forward, index 1' })).toBeVisible();
    await expect(pill(page)).toHaveText('1 change not applied');
    // The edit is saved to the data folder a moment later, without a click.
    await expect
      .poll(async () => {
        const [file] = await schemeFiles(helm.dataDir);
        return file === undefined
          ? ''
          : await readFile(join(helm.dataDir, 'schemes', file), 'utf8');
      })
      .toContain('move_forward');

    // The rest of what Helldivers 2 needs is kept, as the owner would in the real app.
    expect(await keepEveryCheck(page)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(applyInDrawer(page)).toBeEnabled();
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel('Result')).toContainText('Both units now run the layout.');
    await drawer(page).getByRole('button', { name: 'Close' }).click();

    await expect(pill(page)).toHaveText('In sync');
    const [leftUnit, rightUnit] = await helm.units();
    const written = leftUnit?.slots.find((s) => s.slot === leftUnit.running);
    expect(written?.name).toBe("Game's own keys");
    // W is Move forward's key in Helldivers 2, and it is the only button that sends anything.
    expect(written?.taps).toEqual([{ input: expect.any(Number), keys: [KEY_W] }]);
    expect(rightUnit?.slots.find((s) => s.slot === rightUnit.running)?.taps).toEqual([]);
  });

  test('Apply is refused while the Azeron app is running, and written when it is closed', async ({
    helm,
  }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await keepEveryCheck(page);
    const [schemeFile] = await schemeFiles(helm.dataDir);
    const schemeId = (schemeFile ?? '').replace(/\.json$/, '');
    const before = await helm.units();

    await helm.setProcesses([AZERON_APP]);
    await expect(page.getByText(CLOSE_AZERON_FIRST).first()).toBeVisible();

    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(drawer(page).getByLabel('What is ready')).toContainText(CLOSE_AZERON_FIRST);
    await expect(applyInDrawer(page)).toBeDisabled();

    // The disabled button is not the guard: the main process refuses the same request.
    const refused = await page.evaluate(async (id) => {
      const helmApi = (
        window as unknown as {
          helm: {
            previewApply(id: string): Promise<{ fingerprint: string }>;
            apply(id: string, fingerprint: string): Promise<{ ok: boolean; message: string }>;
          };
        }
      ).helm;
      const preview = await helmApi.previewApply(id);
      return helmApi.apply(id, preview.fingerprint);
    }, schemeId);
    expect(refused).toMatchObject({ ok: false, message: CLOSE_AZERON_FIRST });

    // Nothing was sent to either unit while the Azeron app was open, and they hold what they did.
    const during = await helm.units();
    expect(during.map((u) => u.slots)).toEqual(before.map((u) => u.slots));
    expect(during.map((u) => u.reportsReceived)).toEqual(before.map((u) => u.reportsReceived));

    // Closing the Azeron app makes the same drawer ready again, and Apply then writes.
    await helm.setProcesses([]);
    await expect(applyInDrawer(page)).toBeEnabled({ timeout: 15_000 });
    await applyInDrawer(page).click();
    await expect(drawer(page).getByLabel('Result')).toContainText('Both units now run the layout.');
    expect((await helm.units()).map((u) => u.slots.map((s) => s.name))).toEqual([
      ['Xbox controller'],
      ['Xbox controller'],
    ]);
  });
});
