// The three typefaces of the Main board ("Type") are drawn, in the main window and in Play view:
// they ship with the app, so no screen falls back to the system's sans-serif and monospace. The
// audit's width probe: one string measured with the family named and without it.
import type { Page } from '@playwright/test';
import { expect, test } from './helm';
import { fontProbe } from './screens';

const FAMILIES = [
  { family: 'Space Grotesk', weight: 700 },
  { family: 'Inter', weight: 600 },
  { family: 'JetBrains Mono', weight: 500 },
] as const;

/** Each family that isn't drawn, with what the probe read. */
async function notDrawn(page: Page): Promise<string[]> {
  const faults: string[] = [];
  for (const { family, weight } of FAMILIES) {
    const probe = await fontProbe(page, family, weight);
    if (probe.named === probe.fallback || !probe.loaded)
      faults.push(`${family} ${weight}: ${JSON.stringify(probe)}`);
  }
  return faults;
}

test.describe('fonts', () => {
  test('the main window draws Space Grotesk, Inter and JetBrains Mono', async ({ helm }) => {
    await expect(helm.page.getByRole('heading', { name: 'Games' })).toBeVisible();
    expect(await notDrawn(helm.page)).toEqual([]);
  });

  test.describe('Play view', () => {
    test.use({ helmArgs: ['--play'] });

    test('Play view draws the same three', async ({ helm }) => {
      const isPlay = (url: string) => url.includes('play.html');
      await expect.poll(() => helm.app.windows().some((w) => isPlay(w.url()))).toBe(true);
      const play = helm.app.windows().find((w) => isPlay(w.url()));
      if (play === undefined) throw new Error('Play view did not open');
      await expect(play.getByText('Play view')).toBeVisible();
      expect(await notDrawn(play)).toEqual([]);
    });
  });
});
