import { describe, expect, it } from 'vitest';
import { startupWindows } from './startup';

describe('startupWindows', () => {
  it('opens the main window', () => {
    expect(startupWindows(['electron.exe', '.'])).toEqual(['main']);
  });

  it('also opens Play view with --play', () => {
    expect(startupWindows(['helmArray.exe', '--play'])).toEqual(['main', 'play']);
  });
});
