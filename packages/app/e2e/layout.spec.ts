// The Editor's layout and legibility, in the real window at the Editor board's size (1440 x 900) and
// at the window's minimum width (1280 x 900): the window never scrolls, the two units stay side by
// side and in view, the Inspector button shuts the side panel, the keyboard keeps its size, and no
// label is drawn under the 10 px floor or out of its key; and the same with Elite's 14 mode tabs
// above the units. Measured in the page, as the UI audit did.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './helm';
import {
  AZERON_APP,
  chooseDevice,
  contentSize,
  deviceTab,
  eliteSeed,
  leftUnit,
  modeTabs,
  schemeFiles,
  startElite,
  startFrom,
  startWithChecks,
} from './screens';

const SIZES = [
  [1440, 900],
  [1280, 900],
] as const;

/** The canvas's floor for a label, in CSS px. */
const FLOOR = 10;
/** The smallest scale each device is drawn at (editor-layout.ts): the floor on screen is this much. */
const MIN_SCALE = { unit: 0.65, keyboard: 0.8 } as const;
/** The units' scale with the side panel open, as measured: the canvas's 0.78 at 1440, 0.70 at 1280. */
const UNIT_SCALE_AT: Record<number, number> = { 1440: 0.78, 1280: 0.69 };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const units = (page: Page) =>
  page.locator('.unit').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }),
  );

/** The scale a unit is drawn at, from its transform. */
const unitScales = (page: Page) =>
  page
    .locator('.unit')
    .evaluateAll((els) => els.map((el) => new DOMMatrix(getComputedStyle(el).transform).a));

const keyboardScale = (page: Page) =>
  page
    .locator('.dv-fit > div')
    .first()
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);

/** Whether the window itself scrolls: the document taller or wider than the window. */
const windowScrolls = (page: Page) =>
  page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    return {
      scrollHeight: doc.scrollHeight,
      innerHeight: window.innerHeight,
      scrolls: doc.scrollHeight > window.innerHeight || doc.scrollWidth > window.innerWidth,
    };
  });

/**
 * Every unit and keyboard label drawn: its CSS size, the size it is on screen (CSS times the
 * device's scale), and whether it stays inside its key. Faults, one line each.
 */
function labelFaults(page: Page, minScale: { unit: number; keyboard: number }, floor: number) {
  return page.evaluate(
    ([min, floor]) => {
      const faults: string[] = [];
      const scaleOf = (el: Element, host: string) => {
        const h = el.closest(host);
        return h === null ? 1 : new DOMMatrix(getComputedStyle(h).transform).a;
      };
      const groups = [
        ['.unit .ul', '.unit', 'button', min.unit],
        ['.unit .sl-t', '.unit', '.sl', min.unit],
        ['.kb-a', '.dv-fit > div', 'button', min.keyboard],
      ] as const;
      for (const [selector, host, keySel, smallest] of groups) {
        for (const el of document.querySelectorAll(selector)) {
          const css = parseFloat(getComputedStyle(el).fontSize);
          const eff = css * scaleOf(el, host);
          const text = el.textContent?.trim() ?? '';
          if (css < floor) faults.push(`${selector} "${text}" is ${css} px`);
          if (eff < floor * smallest - 0.05)
            faults.push(`${selector} "${text}" is ${eff.toFixed(1)} px on screen`);
          const key = el.closest(keySel);
          if (key === null) continue;
          const a = el.getBoundingClientRect();
          const k = key.getBoundingClientRect();
          if (
            a.left < k.left - 1 ||
            a.right > k.right + 1 ||
            a.top < k.top - 1 ||
            a.bottom > k.bottom + 1
          )
            faults.push(
              `${selector} "${text}" spills out of its key (${Math.round(a.width)}x${Math.round(a.height)} in ${Math.round(k.width)}x${Math.round(k.height)})`,
            );
        }
      }
      return faults;
    },
    [minScale, floor] as const,
  );
}

for (const [width, height] of SIZES) {
  test.describe(`the Editor at ${width} x ${height}`, () => {
    test('the window never scrolls: a button selected, the side panel scrolled, the units stay put', async ({
      helm,
    }) => {
      const { page } = helm;
      await contentSize(helm, width, height);
      await startFrom(page, 'Xbox controller');
      const before = await units(page);
      await leftUnit(page).getByRole('button', { name: 'Reload, middle 1' }).click();
      await expect(page.locator('.ed-panel')).toBeVisible();
      // The side panel scrolls in its own column, to the end of the action list.
      const side = page.getByRole('complementary', { name: 'Button and actions' });
      // Nothing in it is wider than it: it scrolls down, never across.
      expect(await side.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      await side.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      const scroll = await windowScrolls(page);
      expect(scroll.scrolls, JSON.stringify(scroll)).toBe(false);
      expect(await units(page)).toEqual(before);
      await expect(page.locator('header.header')).toBeInViewport({ ratio: 1 });
    });

    test('the window never scrolls with a check for every required action', async ({ helm }) => {
      const { page } = helm;
      await contentSize(helm, width, height);
      await startWithChecks(page);
      const before = await units(page);
      await leftUnit(page).getByRole('button', { name: 'Empty, index 1' }).click();
      const scroll = await windowScrolls(page);
      expect(scroll.scrolls, JSON.stringify(scroll)).toBe(false);
      expect(await units(page)).toEqual(before);
    });

    test('the window never scrolls while the Azeron app is open', async ({ helm }) => {
      const { page } = helm;
      await contentSize(helm, width, height);
      await startFrom(page, 'Xbox controller');
      await helm.setProcesses([AZERON_APP]);
      await expect(page.getByText(/Azeron app/).first()).toBeVisible();
      await leftUnit(page).getByRole('button', { name: 'Reload, middle 1' }).click();
      const scroll = await windowScrolls(page);
      expect(scroll.scrolls, JSON.stringify(scroll)).toBe(false);
    });

    test('both units are side by side and wholly in view', async ({ helm }) => {
      const { page } = helm;
      await contentSize(helm, width, height);
      await startFrom(page, 'Xbox controller');
      await leftUnit(page).getByRole('button', { name: 'Reload, middle 1' }).click();
      const [left, right] = (await units(page)) as [Box, Box];
      const scales = await unitScales(page);
      expect({
        sameRow: left.y === right.y,
        leftOfRight: left.x + left.w <= right.x,
        inView: right.x + right.w <= width && right.y + right.h <= height,
        readable: scales.every((s) => s >= (UNIT_SCALE_AT[width] ?? MIN_SCALE.unit)),
      }).toEqual({ sameRow: true, leftOfRight: true, inView: true, readable: true });
    });

    test('the Inspector button shuts the side panel, keeps the selection, and the units grow', async ({
      helm,
    }) => {
      const { page } = helm;
      await contentSize(helm, width, height);
      await startFrom(page, 'Xbox controller');
      const reload = leftUnit(page).getByRole('button', { name: 'Reload, middle 1' });
      await reload.click();
      const inspector = page.getByRole('button', { name: 'Inspector' });
      await expect(inspector).toHaveAttribute('aria-pressed', 'true');
      const [open] = await unitScales(page);

      await inspector.click();
      await expect(inspector).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByRole('complementary', { name: 'Button and actions' })).toHaveCount(0);
      await expect(reload).toHaveAttribute('aria-current', 'true');
      const [shut] = await unitScales(page);
      expect((shut ?? 0) - (open ?? 0)).toBeGreaterThan(0.15);
      const right = (await units(page))[1] as Box;
      expect(right.x + right.w).toBeLessThanOrEqual(width);

      await inspector.click();
      await expect(page.getByRole('complementary', { name: 'Button and actions' })).toContainText(
        'Reload',
      );
    });

    test('the Keyboard tab keeps the keyboard at 0.8 or more, and at full size with the panel shut', async ({
      helm,
    }) => {
      const { page } = helm;
      await contentSize(helm, width, height);
      await startFrom(page, 'Xbox controller');
      await chooseDevice(page, 'Keyboard and mouse');
      await deviceTab(page, 'Keyboard').click();
      await expect(page.getByRole('group', { name: 'Keyboard' })).toBeVisible();
      expect(await keyboardScale(page)).toBeGreaterThanOrEqual(MIN_SCALE.keyboard);
      const scroll = await windowScrolls(page);
      expect(scroll.scrolls, JSON.stringify(scroll)).toBe(false);
      await page.getByRole('button', { name: 'Inspector' }).click();
      await expect.poll(() => keyboardScale(page)).toBe(1);
    });

    test('no unit or keyboard label is under the floor, or out of its key', async ({ helm }) => {
      const { page } = helm;
      await contentSize(helm, width, height);
      await startFrom(page, 'Xbox controller');
      expect(await labelFaults(page, MIN_SCALE, FLOOR)).toEqual([]);
      await page
        .getByRole('group', { name: 'Azerons send' })
        .getByRole('button', { name: 'Keys' })
        .click();
      expect(await labelFaults(page, MIN_SCALE, FLOOR)).toEqual([]);
      await chooseDevice(page, 'Keyboard and mouse');
      await deviceTab(page, 'Keyboard').click();
      await expect(page.locator('.kb-a').first()).toBeVisible();
      expect(await labelFaults(page, MIN_SCALE, FLOOR)).toEqual([]);
    });
  });
}

/**
 * The units' scale with the side panel open and the mode tabs showing: the tabs take height, never
 * the units' width, so it is the scale they have without them (0.701 at 1280, the canvas's 0.78).
 */
const ELITE_SCALE_AT: Record<number, number> = { 1440: 0.78, 1280: 0.7 };

for (const [width, height] of SIZES) {
  test.describe(`the Editor on Elite, its 14 mode tabs showing, at ${width} x ${height}`, () => {
    test.use({ helmSeed: eliteSeed });

    test('the window never scrolls, every tab is in view, the units side by side at their scale', async ({
      helm,
    }) => {
      const { page } = helm;
      await contentSize(helm, width, height);
      await startElite(page, "Game's own keys");
      await page.getByRole('tab', { name: 'On foot' }).click();
      await leftUnit(page).getByRole('button', { name: 'Empty, index 5' }).click();
      await expect(page.locator('.ed-panel')).toBeVisible();
      const side = page.getByRole('complementary', { name: 'Button and actions' });
      await side.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      const scroll = await windowScrolls(page);
      expect(scroll.scrolls, JSON.stringify(scroll)).toBe(false);

      const strip = await modeTabs(page).evaluate((el) => ({
        across: el.scrollWidth - el.clientWidth,
        out: [...el.querySelectorAll('[role="tab"]')]
          .filter((t) => {
            const r = t.getBoundingClientRect();
            return (
              r.left < 0 ||
              r.right > window.innerWidth ||
              r.top < 0 ||
              r.bottom > window.innerHeight
            );
          })
          .map((t) => t.textContent),
      }));
      const [left, right] = (await units(page)) as [Box, Box];
      const scales = await unitScales(page);
      expect(
        {
          strip,
          sameRow: left.y === right.y,
          leftOfRight: left.x + left.w <= right.x,
          inView: right.x + right.w <= width && right.y + right.h <= height,
          readable: scales.every((s) => s >= (ELITE_SCALE_AT[width] ?? MIN_SCALE.unit)),
        },
        `scales ${scales.join(', ')}`,
      ).toEqual({
        strip: { across: 0, out: [] },
        sameRow: true,
        leftOfRight: true,
        inView: true,
        readable: true,
      });
      await expect(page.locator('header.header')).toBeInViewport({ ratio: 1 });
    });

    test('no unit label is under the floor, or out of its key, in the ship and on foot', async ({
      helm,
    }) => {
      const { page } = helm;
      await contentSize(helm, width, height);
      await startElite(page, "Game's own keys");
      const ship = await labelFaults(page, MIN_SCALE, FLOOR);
      await page.getByRole('tab', { name: 'On foot' }).click();
      await page
        .locator('.ed-actions')
        .getByRole('button', { name: 'Utility wheel cycle mode', exact: true })
        .dragTo(leftUnit(page).getByRole('button', { name: 'Empty, ring 1' }));
      expect({ ship, foot: await labelFaults(page, MIN_SCALE, FLOOR) }).toEqual({
        ship: [],
        foot: [],
      });
    });
  });
}

test.describe('the Editor’s labels', () => {
  test('an empty d-pad key reads "D-pad ←" on one line', async ({ helm }) => {
    const { page } = helm;
    await startWithChecks(page);
    const label = leftUnit(page).getByRole('button', { name: 'Empty, d-pad ←' }).locator('.ul');
    const { lines } = await label.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const scale = new DOMMatrix(getComputedStyle(el.closest('.unit') as Element).transform).a;
      return { lines: Math.round(r.height / (parseFloat(s.lineHeight) * scale)) };
    });
    expect(lines).toBe(1);
  });

  test('a key label set in the side panel is drawn on a key the name does not fit, and kept', async ({
    helm,
  }) => {
    const { page } = helm;
    await startWithChecks(page);
    // The d-pad's keys are the shortest: "Ping / comms wheel" fits one only drawn narrower.
    await leftUnit(page).getByRole('button', { name: 'Empty, d-pad ↑' }).click();
    await page.getByRole('button', { name: 'Ping / comms wheel' }).click();
    const key = leftUnit(page).getByRole('button', { name: 'Ping / comms wheel, d-pad ↑' });
    await expect(key.locator('.ul')).toHaveText('Ping / comms wheel');
    await page.getByLabel('Key label').fill('Ping');
    await page.getByLabel('Key label').press('Enter');
    await expect(key.locator('.ul')).toHaveText('Ping');
    // Still named for the action, not the label.
    await expect(key).toHaveAccessibleName('Ping / comms wheel, d-pad ↑');
    await expect
      .poll(async () => {
        const [file] = await schemeFiles(helm.dataDir);
        return file === undefined ? '' : readFile(join(helm.dataDir, 'schemes', file), 'utf8');
      })
      .toMatch(/"keyLabels":\s*\{\s*"default":\s*\{\s*"L.dpad_up":\s*"Ping"/);
  });
});

test.describe('a key label on a button with only a long press', () => {
  for (const [width, height] of SIZES) {
    test(`keeps "Long:" before it, at ${width} x ${height}`, async ({ helm }) => {
      const { page } = helm;
      await contentSize(helm, width, height);
      await startWithChecks(page);
      // The d-pad's up key, its long press only: Ping / comms wheel.
      await leftUnit(page).getByRole('button', { name: 'Empty, d-pad ↑' }).click();
      await page.getByRole('button', { name: /^Long/ }).click();
      await page.getByRole('button', { name: 'Ping / comms wheel' }).click();
      const key = leftUnit(page).getByRole('button', { name: 'Long: Ping / comms wheel, d-pad ↑' });
      await expect(key.locator('.ul')).toHaveText(/^Long:/);
      await page.getByLabel('Key label').fill('Ping');
      await page.getByLabel('Key label').press('Enter');
      await expect(key.locator('.ul')).toHaveText('Long: Ping');
      expect(await labelFaults(page, MIN_SCALE, FLOOR)).toEqual([]);
    });
  }
});

test.describe('the Editor at the window’s smallest, 1280 x 720', () => {
  test('the Keyboard tab: the window never scrolls and a check stays in reach', async ({
    helm,
  }) => {
    const { page } = helm;
    await contentSize(helm, 1280, 720);
    await startFrom(page, 'Xbox controller');
    await chooseDevice(page, 'Keyboard and mouse');
    await deviceTab(page, 'Keyboard').click();
    const keep = page.getByRole('button', { name: 'Keep, I know' });
    await keep.scrollIntoViewIfNeeded();
    await expect(keep).toBeInViewport({ ratio: 1 });
    const scroll = await windowScrolls(page);
    expect(scroll.scrolls, JSON.stringify(scroll)).toBe(false);
    expect(await page.locator('.ed-checks').evaluate((el) => el.clientHeight)).toBeGreaterThan(40);
  });
});

test.describe('the other screens never scroll the window', () => {
  test('the Library', async ({ helm }) => {
    const { page } = helm;
    await contentSize(helm, 1280, 720);
    await expect(page.getByRole('heading', { name: 'Games' })).toBeVisible();
    const scroll = await windowScrolls(page);
    expect(scroll.scrolls, JSON.stringify(scroll)).toBe(false);
  });

  test('the Game screen with every Helldivers 2 action listed', async ({ helm }) => {
    const { page } = helm;
    await contentSize(helm, 1280, 900);
    await page.getByRole('button', { name: 'Edit actions: Helldivers 2' }).click();
    await expect(page.getByRole('textbox', { name: 'Reload, name' })).toBeVisible();
    const scroll = await windowScrolls(page);
    expect(scroll.scrolls, JSON.stringify(scroll)).toBe(false);
    await expect(page.locator('header.header')).toBeInViewport({ ratio: 1 });
  });
});
