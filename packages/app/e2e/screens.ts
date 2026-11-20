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
  /** A non-none outline with a width, or a box-shadow. */
  visible: boolean;
  outline: string;
  shadow: string;
}

/**
 * Presses Tab, in the page, until the focus comes round to a stop already visited (or leaves the
 * page), and says what each stop looked like. The key press is Playwright's, into the page.
 */
export async function walkTabOrder(page: Page, limit = 300): Promise<FocusStop[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const stops: FocusStop[] = [];
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate((): FocusStop | 'wrapped' | 'left' => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body) return 'left';
      if (el.dataset['e2eStop'] !== undefined) return 'wrapped';
      el.dataset['e2eStop'] = '1';
      const style = getComputedStyle(el);
      const ringed = (node: Element): boolean => {
        const s = getComputedStyle(node);
        return (
          (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'
        );
      };
      // The ring may be on the control, or on the field that holds it (`:focus-within`).
      let holder: Element | null = el;
      let drawn = false;
      for (let depth = 0; holder && depth < 3 && !drawn; depth++) {
        drawn = ringed(holder);
        holder = holder.parentElement?.matches(':focus-within') ? holder.parentElement : null;
      }
      return {
        label:
          el.getAttribute('aria-label') ??
          (el.textContent?.trim().slice(0, 40) || el.tagName.toLowerCase()),
        inDialog: el.closest('[role="dialog"]') !== null,
        visible: drawn,
        outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
        shadow: style.boxShadow,
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
    .map((s) => `${s.label} (outline: ${s.outline}; shadow: ${s.shadow})`);
