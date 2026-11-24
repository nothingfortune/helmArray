// What the specs share: the places on the M4 screens, and the steps that get to them.
import AxeBuilder from '@axe-core/playwright';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect } from './helm';
import type { Helm } from './helm';

export const AZERON_APP = 'Azeron Software.exe';
export const CLOSE_AZERON_FIRST = 'Close the Azeron app first: it talks to the units too.';

export const pill = (page: Page): Locator => page.locator('.pill');
export const drawer = (page: Page): Locator => page.getByRole('dialog', { name: /^Apply/ });
export const applyInDrawer = (page: Page): Locator =>
  drawer(page).getByRole('button', { name: 'Apply' });
export const helldivers = (page: Page): Locator =>
  page.getByRole('button', { name: /^HELLDIVERS/ });
/** Helldivers 2's cover: the tile's own button, also once the game has schemes beside it. */
export const helldiversTile = (page: Page): Locator =>
  page.locator('.tile', { hasText: /HELLDIVERS|Helldivers 2/ }).locator('.tile-button');

/**
 * J1 on Helldivers 2: the game, then what to start from. Both presets leave nothing to fix there,
 * so the Apply drawer opens on the new scheme by itself (the owner's decision, 2026-11-24).
 */
export async function openFrom(page: Page, preset: 'Xbox controller' | "Game's own keys") {
  await helldivers(page).click();
  await page.getByRole('button', { name: preset }).click();
  await expect(drawer(page)).toBeVisible();
}

/**
 * Opens Helldivers 2 from the Library in the Editor: the game, then what to start from. The drawer
 * that opens on it (`openFrom`) is cancelled, so the test starts in the Editor as the player would
 * after looking at it.
 */
export async function startFrom(page: Page, preset: 'Xbox controller' | "Game's own keys") {
  await openFrom(page, preset);
  await drawer(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Helldivers 2' })).toBeVisible();
}

/**
 * Opens Helldivers 2 in the Editor on a "Game's own keys" scheme as a test needs it, made through
 * `window.helm` as the store keeps it: the preset, then saved again with `blank` (nothing placed,
 * the sticks not set) and the sticks in `behaviour` over it. Made the game's active scheme, and
 * opened from its tile after *Look again* reads the Library afresh: not made from a preset in the
 * Library, so no drawer opens on it.
 */
export async function startKeysScheme(
  page: Page,
  change: { blank: boolean; behaviour?: Record<string, unknown> },
) {
  await page.evaluate(async ({ blank, behaviour }) => {
    const helm = (
      window as unknown as {
        helm: {
          createScheme(gameId: string, preset: string): Promise<Record<string, unknown>>;
          saveScheme(scheme: unknown): Promise<void>;
          setActive(gameId: string, schemeId: string): Promise<void>;
        };
      }
    ).helm;
    const made = await helm.createScheme('helldivers2', 'keys');
    await helm.saveScheme({
      ...made,
      ...(blank ? { map: { default: {} }, behaviour: {} } : {}),
      behaviour: {
        ...(blank ? {} : (made['behaviour'] as Record<string, unknown>)),
        ...behaviour,
      },
    });
    await helm.setActive('helldivers2', made['id'] as string);
  }, change);
  await page.getByRole('button', { name: 'Look again' }).click();
  await expect(helldiversTile(page)).toHaveAttribute('aria-label', /Not applied/);
  await helldiversTile(page).click();
  await expect(page.getByRole('heading', { name: 'Helldivers 2' })).toBeVisible();
}

/**
 * Opens Helldivers 2 in the Editor on a "Game's own keys" scheme with nothing placed: what that
 * preset made before it placed the game's actions, and what a scheme saved then still holds.
 */
export const startBlankKeys = (page: Page) => startKeysScheme(page, { blank: true });

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
 * Opens Helldivers 2 on a setup with checks the player can keep: a game's own keys scheme with
 * nothing placed yet (`startBlankKeys`) flags the required actions (and the sticks, which send no
 * keys). Neither preset has any now: the game is rebound, and both place every required action.
 */
export async function startWithChecks(page: Page) {
  await startBlankKeys(page);
  await expect(page.getByRole('button', { name: 'Keep, I know' }).first()).toBeVisible();
}

/**
 * Counts the clicks and drags a test makes from here on, as the page sees them: every trusted
 * pointer press (a click, or the start of a drag), and every drop. A drag is one press and one
 * drop, so clicks are the presses that didn't end in a drop. Listened for in the capture phase on
 * the window, so a click a helper makes counts too.
 */
export async function countInput(
  page: Page,
): Promise<() => Promise<{ clicks: number; drags: number }>> {
  await page.evaluate(() => {
    const w = window as unknown as { e2eInput?: { presses: number; drops: number } };
    const counts = { presses: 0, drops: 0 };
    w.e2eInput = counts;
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.isTrusted) counts.presses++;
      },
      { capture: true },
    );
    window.addEventListener(
      'drop',
      (e) => {
        if (e.isTrusted) counts.drops++;
      },
      { capture: true },
    );
  });
  return async () => {
    const { presses, drops } = await page.evaluate(
      () => (window as unknown as { e2eInput: { presses: number; drops: number } }).e2eInput,
    );
    return { clicks: presses - drops, drags: drops };
  };
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
          ((el instanceof HTMLInputElement && el.labels?.[0]?.textContent?.trim()) ||
            el.textContent?.trim().slice(0, 40) ||
            el.tagName.toLowerCase()),
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

/**
 * Sets the main window's content to `width` x `height` (the audit's sizes: 1440 x 900, the Editor
 * board's, and 1280 x 900, the window's minimum width) and waits until the page has that size.
 */
export async function contentSize(helm: Helm, width: number, height: number) {
  await helm.app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const win = BrowserWindow.getAllWindows().find((b) => b.getTitle() === 'helmArray');
      win?.setContentSize(w ?? 0, h ?? 0);
    },
    [width, height],
  );
  await expect
    .poll(() => helm.page.evaluate(() => [window.innerWidth, window.innerHeight]))
    .toEqual([width, height]);
}

/** What the width probe read for one family, in a page. */
export interface FontProbe {
  /** The probe string's width with the family named first, then the fallback. */
  named: number;
  /** The same string in the fallback alone. */
  fallback: number;
  /** A face of that family, from the app's own files, has loaded. */
  loaded: boolean;
}

/**
 * The audit's width probe: one string, measured with the family named and without it. Equal widths
 * mean the family isn't drawn. The face is loaded first, so the fallback a `swap` face shows while
 * it loads is not what is measured; the fallback is a generic with clearly different metrics.
 */
export function fontProbe(page: Page, family: string, weight: number): Promise<FontProbe> {
  return page.evaluate(
    async ([family, weight]) => {
      const fallback = family === 'JetBrains Mono' ? 'serif' : 'monospace';
      await document.fonts.load(`${weight} 40px "${family}"`).catch(() => []);
      const width = (stack: string) => {
        const span = document.createElement('span');
        span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${weight} 40px ${stack}`;
        span.textContent = 'Hamburgefonstiv 0123 WMil';
        document.body.append(span);
        const w = span.getBoundingClientRect().width;
        span.remove();
        return w;
      };
      const loaded = [...document.fonts].some(
        (face) => face.family.replace(/["']/g, '') === family && face.status === 'loaded',
      );
      return { named: width(`"${family}", ${fallback}`), fallback: width(fallback), loaded };
    },
    [family, weight] as const,
  );
}
