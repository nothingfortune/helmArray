// What the specs share: the places on the M4 screens, and the steps that get to them.
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

/**
 * Puts Throw grenade, an action Helldivers 2 has no Xbox default for, on the left unit's middle
 * 2 button (which sends Y, and which the Xbox controller preset leaves empty). That raises a
 * check the player can keep, for the tests that need one: the preset itself has none. The side
 * panel the drop opens is closed again, so the page is the Editor with one check and no button
 * selected (the panel's own press rows have an axe label-in-name problem, left for the owner).
 */
export async function flagAnAction(page: Page) {
  const left = page.locator('.unit[data-hand="left"]');
  const action = page.locator('.ed-actions').getByRole('button', { name: 'Throw grenade' });
  await action.dragTo(left.getByRole('button', { name: 'Empty, middle 2' }));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
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
