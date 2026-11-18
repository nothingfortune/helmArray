import { describe, expect, it } from 'vitest';
import { trayIconBitmap } from './tray-icon';

// BGRA at (x, y).
function pixel(size: number, pixels: Buffer, x: number, y: number): number[] {
  const at = (y * size + x) * 4;
  return [...pixels.subarray(at, at + 4)];
}

describe('trayIconBitmap', () => {
  it.each([16, 32, 64])('is %i x %i BGRA', (size) => {
    const icon = trayIconBitmap(size);
    expect([icon.width, icon.height]).toEqual([size, size]);
    expect(icon.pixels.length).toBe(size * size * 4);
  });

  it('fills the top-left square with the accent and leaves the others hollow', () => {
    const { pixels } = trayIconBitmap(28);
    expect(pixel(28, pixels, 7, 7)).toEqual([0x24, 0xb2, 0xff, 255]); // accent #FFB224 as BGRA
    expect(pixel(28, pixels, 21, 7)).toEqual([0, 0, 0, 0]); // inside the top-right square
    expect(pixel(28, pixels, 16, 7)).toEqual([0xf4, 0xf0, 0xed, 255]); // its left edge, text #EDF0F4
    expect(pixel(28, pixels, 21, 21)).toEqual([0, 0, 0, 0]);
  });

  it('leaves the gutter between squares transparent', () => {
    const { pixels } = trayIconBitmap(28);
    expect(pixel(28, pixels, 14, 14)).toEqual([0, 0, 0, 0]);
    expect(pixel(28, pixels, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it.each([0, 7, 12.5, -16])('refuses size %s', (size) => {
    expect(() => trayIconBitmap(size)).toThrow('Icon size must be an integer of 8 or more');
  });
});
