// The keyboard, screen by screen: Tab goes through every control, in the page's own order, and
// each stop shows where the focus is (an outline or a box-shadow on the focused element). The
// keys are Playwright's, sent into the page.
import { expect, test } from './helm';
import { applyInDrawer, drawer, keepEveryCheck, startFrom, unseen, walkTabOrder } from './screens';

test.describe('keyboard: Tab order and visible focus', () => {
  test('the Library', async ({ helm }) => {
    const { page } = helm;
    await expect(page.getByRole('heading', { name: 'Games' })).toBeVisible();
    const stops = await walkTabOrder(page);
    const labels = stops.map((s) => s.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Settings',
        'Look again',
        'Find a game',
        expect.stringMatching(/^HELLDIVERS/),
      ]),
    );
    expect(unseen(stops)).toEqual([]);
  });

  test('the Editor', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    const stops = await walkTabOrder(page);
    const labels = stops.map((s) => s.label);
    expect(labels).toEqual(
      expect.arrayContaining(['Library', 'Apply', 'Keep, I know', 'Move forward']),
    );
    // Both units' buttons are in the walk.
    expect(labels.filter((l) => /, index 1$/.test(l)).length).toBeGreaterThanOrEqual(2);
    expect(unseen(stops)).toEqual([]);
  });

  test('the Apply drawer keeps the focus inside it and shows it', async ({ helm }) => {
    const { page } = helm;
    await startFrom(page, 'Xbox controller');
    await keepEveryCheck(page);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(applyInDrawer(page)).toBeEnabled();
    const stops = await walkTabOrder(page);
    expect(stops.map((s) => s.label)).toEqual(expect.arrayContaining(['Cancel', 'Apply']));
    expect(stops.every((s) => s.inDialog)).toBe(true);
    expect(unseen(stops)).toEqual([]);
    await expect(drawer(page)).toBeVisible();
  });
});
