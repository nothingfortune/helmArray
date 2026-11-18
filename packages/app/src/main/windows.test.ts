import { describe, expect, it } from 'vitest';
import { color } from '../shared/tokens';
import { mainWindowOptions, playWindowOptions } from './windows';

describe.each([
  ['main', mainWindowOptions],
  ['play', playWindowOptions],
])('%s window', (_name, options) => {
  it('runs its page sandboxed, isolated and without Node', () => {
    expect(options().webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });

  it('paints the ground colour before the page loads, and shows once ready', () => {
    expect(options().backgroundColor).toBe(color.bg);
    expect(options().show).toBe(false);
  });
});

describe('main window', () => {
  it('opens at the drawn size and keeps the width the screens were drawn for', () => {
    const o = mainWindowOptions();
    expect([o.width, o.height]).toEqual([1440, 900]);
    expect(o.minWidth).toBe(1280);
    expect(o.frame).toBeUndefined();
  });
});

describe('Play view window', () => {
  it('is frameless and kept on top', () => {
    const o = playWindowOptions();
    expect(o.frame).toBe(false);
    expect(o.alwaysOnTop).toBe(true);
    expect([o.width, o.height]).toEqual([1344, 660]);
  });
});
