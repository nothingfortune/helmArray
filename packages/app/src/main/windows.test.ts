import { describe, expect, it } from 'vitest';
import { color } from '../shared/tokens';
import { mainWindowOptions, playWindowOptions } from './windows';

const PRELOAD = 'C:/app/out/preload/index.cjs';

describe.each([
  ['main', mainWindowOptions],
  ['play', playWindowOptions],
])('%s window', (_name, options) => {
  it('runs its page sandboxed, isolated and without Node, behind the preload', () => {
    expect(options(PRELOAD).webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD,
    });
  });

  it('paints the ground colour before the page loads, and shows once ready', () => {
    expect(options(PRELOAD).backgroundColor).toBe(color.bg);
    expect(options(PRELOAD).show).toBe(false);
  });
});

describe('main window', () => {
  it('opens at the drawn size and keeps the width the screens were drawn for', () => {
    const o = mainWindowOptions(PRELOAD);
    expect([o.width, o.height]).toEqual([1440, 900]);
    expect(o.minWidth).toBe(1280);
    expect(o.frame).toBeUndefined();
  });
});

describe('Play view window', () => {
  it('is frameless and kept on top', () => {
    const o = playWindowOptions(PRELOAD);
    expect(o.frame).toBe(false);
    expect(o.alwaysOnTop).toBe(true);
    expect([o.width, o.height]).toEqual([1344, 660]);
  });
});
