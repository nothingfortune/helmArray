// What the specs share: the places on the M4 screens, and the steps that get to them.
import AxeBuilder from '@axe-core/playwright';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect } from './helm';

export const AZERON_APP = 'Azeron Software.exe';
export const CLOSE_AZERON_FIRST = 'Close the Azeron app first: it talks to the units too.';

export const pill = (page: Page): Locator => page.locator('.pill');
export const drawer = (page: Page): Locator => page.getByRole('dialog', { name: /^Apply/ });
export const applyInDrawer = (page: Page): Locator =>
  drawer(page).getByRole('button', { name: 'Apply' });
export const helldivers = (page: Page): Locator =>
  page.getByRole('button', { name: /^HELLDIVERS/ });

/** Opens Helldivers 2 from the Library: the game, then what to start from. */
export async function startFrom(page: Page, preset: 'Xbox controller' | "Game's own keys") {
  await helldivers(page).click();
  await page.getByRole('button', { name: preset }).click();
  await expect(page.getByRole('heading', { name: 'Helldivers 2' })).toBeVisible();
}

/** A device tab of the Editor: Azerons, Keyboard, Controller. */
export const deviceTab = (page: Page, name: string): Locator =>
  page.getByRole('group', { name: 'Device' }).getByRole('button', { name, exact: true });
/** "Azerons send: Keys | Controller". */
export const azeronsSend = (page: Page): Locator =>
  page.getByRole('group', { name: 'Azerons send' });
/** "Scheme: Main ▾", which opens the Scheme picker. */
export const schemePicker = (page: Page): Locator =>
  page.getByRole('button', { name: /^Scheme: / });
/** The Apply drawer's game half, before Apply. */
export const gameHalf = (page: Page): Locator => drawer(page).getByLabel("In the game's controls");

/** Opens the device chooser and picks one thing in it (two clicks), then closes it. */
export async function chooseDevice(page: Page, label: string) {
  await page.getByRole('button', { name: 'Devices' }).click();
  await page.getByRole('dialog', { name: 'Devices' }).getByLabel(label, { exact: true }).click();
  await page.keyboard.press('Escape');
}

/** The left unit's board in the Editor. */
export const leftUnit = (page: Page) => page.locator('.unit[data-hand="left"]');

/**
 * Opens Helldivers 2 on a setup with checks the player can keep: the game's own keys with nothing
 * placed yet flags the required actions (and the sticks, which send no keys). The Xbox controller
 * preset has none, and putting an action on a button no longer raises one: the game is rebound.
 */
export async function startWithChecks(page: Page) {
  await startFrom(page, "Game's own keys");
  await expect(page.getByRole('button', { name: 'Keep, I know' }).first()).toBeVisible();
}

/** "Keep, I know" on every check that is still flagged. Returns how many were kept. */
export async function keepEveryCheck(page: Page): Promise<number> {
  const keep = page.getByRole('button', { name: 'Keep, I know' });
  let kept = 0;
  while ((await keep.count()) > 0) {
    await keep.first().click();
    kept++;
  }
  return kept;
}

export async function schemeFiles(dataDir: string): Promise<string[]> {
  return (await readdir(join(dataDir, 'schemes'))).filter((name) => name.endsWith('.json'));
}

/** One stop of a Tab walk: what has the focus, and whether the focus can be seen on it. */
export interface FocusStop {
  /** The accessible name, else the text, else the tag: enough to find it in a failure. */
  label: string;
  /** Inside an open dialog. */
  inDialog: boolean;
  /**
   * The look of the control (or of a field around it that styles `:focus-within`) changes when
   * it gets the focus: its outline, box-shadow, border or background is not what it was blurred.
   */
  visible: boolean;
  /** What was compared, blurred then focused, for a failure message. */
  blurred: string;
  focused: string;
}

/**
 * Presses Tab, in the page, until the focus comes round to a stop already visited (or leaves the
 * page). For each stop it reads the look of the focused element and of the fields around it that
 * match `:focus-within`, then blurs the element, reads them again, and gives it the focus back.
 * A ring that is there either way (an inset shadow that is part of the design) does not count:
 * only a change does. Transitions and animations are switched off for the walk, so a change that
 * is only starting is still read. The key presses are Playwright's, into the page.
 */
export async function walkTabOrder(page: Page, limit = 300): Promise<FocusStop[]> {
  await page.evaluate(() => {
    const still = document.createElement('style');
    still.textContent =
      '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.append(still);
    (document.activeElement as HTMLElement | null)?.blur();
  });
  const stops: FocusStop[] = [];
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate((): FocusStop | 'wrapped' | 'left' => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body) return 'left';
      if (el.dataset['e2eStop'] !== undefined) return 'wrapped';
      el.dataset['e2eStop'] = '1';
      const look = (node: Element): string => {
        const s = getComputedStyle(node);
        return [
          `outline ${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}`,
          `shadow ${s.boxShadow}`,
          `border ${s.borderTopStyle} ${s.borderTopWidth} ${s.borderTopColor} ${s.borderRightColor} ${s.borderBottomColor} ${s.borderLeftColor}`,
          `background ${s.backgroundColor} ${s.backgroundImage}`,
        ].join('; ');
      };
      // The element, and up to three fields round it that show the focus being inside them.
      const nodes: Element[] = [el];
      for (let up = el.parentElement; up && nodes.length < 4 && up.matches(':focus-within');) {
        nodes.push(up);
        up = up.parentElement;
      }
      const focused = nodes.map(look);
      el.blur();
      const blurred = nodes.map(look);
      el.focus();
      return {
        label:
          el.getAttribute('aria-label') ??
          (el.textContent?.trim().slice(0, 40) || el.tagName.toLowerCase()),
        inDialog: el.closest('[role="dialog"]') !== null,
        visible: focused.some((look, n) => look !== blurred[n]),
        blurred: blurred.join(' | '),
        focused: focused.join(' | '),
      };
    });
    if (stop === 'wrapped' || stop === 'left') break;
    stops.push(stop);
  }
  return stops;
}

/** The stops whose focus can't be seen, in a form a failure message can show. */
export const unseen = (stops: readonly FocusStop[]): string[] =>
  stops
    .filter((s) => !s.visible)
    .map((s) => `${s.label} (blurred: ${s.blurred}; focused: ${s.focused})`);

/**
 * An axe scan of the page: its serious and critical violations, one line each (rule, impact, how
 * many elements, the first one's selector). Legacy mode runs axe inside the page itself: the
 * default opens a second page, which an Electron window can't give.
 */
export async function seriousViolations(page: Page, leaveOut?: string): Promise<string[]> {
  const builder = new AxeBuilder({ page }).setLegacyMode(true);
  if (leaveOut !== undefined) builder.exclude(leaveOut);
  const { violations } = await builder.analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id} (${v.impact}, ${v.nodes.length}): ${v.nodes[0]?.target.join(' ') ?? ''} - ${v.help}`,
    );
}
