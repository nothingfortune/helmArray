import { describe, expect, it } from 'vitest';
import { KEYBOARD_WIDTH } from '../devices/layouts';
import { UNIT_WIDTH } from '../unit/layout';
import {
  MIN_KEYBOARD_SCALE,
  MIN_UNIT_SCALE,
  MOUSE_GAP,
  MOUSE_WIDTH,
  SIDE_NARROW,
  SIDE_WIDE,
  UNIT_GAP,
  WIDE_WINDOW,
  keyboardRow,
  sidePanelWidth,
  unitRow,
} from './editor-layout';

/** What `.ed-main` gives the devices at a window width: its padding and a scrollbar's gutter. */
const mainWidth = (window: number, inspector: boolean) =>
  window - (inspector ? sidePanelWidth(window) : 0) - 48 - 17;

describe('sidePanelWidth', () => {
  it('is the canvas’s 340 px from 1440 px up, and 300 px below', () => {
    expect([
      sidePanelWidth(1920),
      sidePanelWidth(WIDE_WINDOW),
      sidePanelWidth(WIDE_WINDOW - 1),
      sidePanelWidth(1280),
    ]).toEqual([SIDE_WIDE, SIDE_WIDE, SIDE_NARROW, SIDE_NARROW]);
  });
});

describe('unitRow: the two units side by side', () => {
  it('splits the width between the two, less the gap', () => {
    expect(unitRow(1037, 2)).toEqual({
      stacked: false,
      scale: (1037 - UNIT_GAP) / 2 / UNIT_WIDTH,
    });
  });

  it('never draws a unit past full size', () => {
    expect(unitRow(2400, 2)).toEqual({ stacked: false, scale: 1 });
  });

  it('keeps both side by side at the smallest window, 1280 px, with the side panel open', () => {
    const row = unitRow(mainWidth(1280, true), 2);
    expect([row.stacked, (row.scale ?? 0) >= MIN_UNIT_SCALE, (row.scale ?? 0) > 0.69]).toEqual([
      false,
      true,
      true,
    ]);
  });

  it('draws them bigger with the side panel shut', () => {
    expect(unitRow(mainWidth(1280, false), 2).scale).toBeGreaterThan(
      (unitRow(mainWidth(1280, true), 2).scale ?? 1) + 0.2,
    );
  });

  it('stacks them only when two would be under the readable size, and then fills the width', () => {
    const narrow = 2 * MIN_UNIT_SCALE * UNIT_WIDTH + UNIT_GAP - 1;
    expect([unitRow(narrow + 1, 2).stacked, unitRow(narrow, 2)]).toEqual([
      false,
      { stacked: true, scale: 1 },
    ]);
    expect(unitRow(500, 2)).toEqual({ stacked: true, scale: 500 / UNIT_WIDTH });
  });

  it('puts one unit beside the mouse, the same way', () => {
    const beside = unitRow(1037, 1, MOUSE_WIDTH);
    expect(beside).toEqual({ stacked: false, scale: 1 });
    expect(unitRow(500, 1, MOUSE_WIDTH)).toEqual({ stacked: true, scale: 500 / UNIT_WIDTH });
  });

  it('draws at full size before it has been measured', () => {
    expect(unitRow(undefined, 2)).toEqual({ stacked: false, scale: undefined });
  });
});

describe('keyboardRow: the keyboard with the mouse', () => {
  it('keeps the mouse beside the keyboard at 1440 px, the keyboard at 0.8 or more', () => {
    const row = keyboardRow(mainWidth(1440, true));
    expect([row.mouseBelow, (row.scale ?? 0) >= MIN_KEYBOARD_SCALE]).toEqual([false, true]);
  });

  it('puts the mouse under the keyboard below about 1400 px, so the keyboard stays big', () => {
    const at = (w: number) => keyboardRow(mainWidth(w, true));
    expect([at(1420).mouseBelow, at(1360).mouseBelow, at(1280)]).toEqual([
      false,
      true,
      { mouseBelow: true, scale: mainWidth(1280, true) / KEYBOARD_WIDTH },
    ]);
    expect(at(1280).scale ?? 0).toBeGreaterThanOrEqual(MIN_KEYBOARD_SCALE);
  });

  it('draws the keyboard at full size, the mouse beside it, at 1280 px with the side panel shut', () => {
    expect(keyboardRow(mainWidth(1280, false))).toEqual({ mouseBelow: false, scale: 1 });
  });

  it('puts the mouse beside only when the keyboard keeps 0.8 there', () => {
    const edge = MIN_KEYBOARD_SCALE * KEYBOARD_WIDTH + MOUSE_GAP + MOUSE_WIDTH;
    expect([keyboardRow(edge).mouseBelow, keyboardRow(edge - 1).mouseBelow]).toEqual([false, true]);
  });

  it('draws the keyboard alone at its width, never past full size', () => {
    expect([keyboardRow(700, false), keyboardRow(2000, false)]).toEqual([
      { mouseBelow: false, scale: 700 / KEYBOARD_WIDTH },
      { mouseBelow: false, scale: 1 },
    ]);
  });

  it('draws at full size before it has been measured', () => {
    expect(keyboardRow(undefined)).toEqual({ mouseBelow: false, scale: undefined });
  });
});
