// The keyboard, screen by screen: Tab goes through every control, in the page's own order, and
// each stop shows where the focus is (an outline or a box-shadow on the focused element). The
// keys are Playwright's, sent into the page.
import { expect, test } from './helm';
import {
  applyInDrawer,
  drawer,
  keepEveryCheck,
  startFrom,
  startWithChecks,
  unseen,
  walkTabOrder,
} from './screens';

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
    await startWithChecks(page);
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

// The check itself, on a page made for it: loaded into the app's window, so it runs in the same
// browser as the screens. A ring that is always there is not a focus ring: only a change when the
// element (or the field that holds it) gets the focus counts.
test.describe('keyboard: what counts as a visible focus', () => {
  const PAGE = `
    <style>
      button, input { font: inherit; margin: 8px; }
      .always { box-shadow: inset 0 0 0 2px red; }
      .always:focus-visible, input:focus-visible { outline: none; }
      .outline:focus-visible { outline: 2px solid blue; }
      .glow { box-shadow: none; transition: box-shadow 2s; }
      .glow:focus-visible { outline: none; box-shadow: 0 0 0 3px blue; }
      .tint { background: white; outline: none; }
      .tint:focus-visible { background: yellow; outline: none; }
      .field { display: inline-block; padding: 4px; }
      .field.ringed:focus-within { box-shadow: 0 0 0 2px blue; }
      .field.fixed { box-shadow: 0 0 0 2px red; }
    </style>
    <button class="always">Permanent shadow</button>
    <button class="outline">Outline on focus</button>
    <button class="glow">Shadow on focus</button>
    <button class="tint">Tint on focus</button>
    <label class="field ringed"><input aria-label="Field with a ring on focus"></label>
    <label class="field fixed"><input aria-label="Field with a permanent shadow"></label>`;

  test('a ring that is always there is not a focus ring, one that appears on focus is', async ({
    helm,
  }) => {
    await helm.page.setContent(PAGE);
    const stops = await walkTabOrder(helm.page);
    expect(unseen(stops).map((line) => line.split(' (')[0])).toEqual([
      'Permanent shadow',
      'Field with a permanent shadow',
    ]);
  });
});
