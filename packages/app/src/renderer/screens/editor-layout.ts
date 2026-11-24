// How the Editor lays its middle out at a width: the side panel's width, the two units side by
// side (or stacked) and their scale, and the keyboard with the mouse beside it or under it. Pure:
// the Editor measures, these decide (docs/plans/03-ui-system.md: units stack "only when there is
// no room for two at a readable size").

import { KEYBOARD_WIDTH } from '../devices/layouts';
import { UNIT_WIDTH } from '../unit/layout';

/** The side panel as the canvas draws it, from a 1440 px window up; narrower below. */
export const SIDE_WIDE = 340;
export const SIDE_NARROW = 300;
export const WIDE_WINDOW = 1440;

/** The gap between the two units, as drawn. */
export const UNIT_GAP = 20;
/**
 * The smallest a unit is drawn beside another: under it the two stack. A label at the 10 px floor
 * is then 6.5 px on screen, as the canvas's own 0.70 makes it 7 px.
 */
export const MIN_UNIT_SCALE = 0.65;

/** The mouse as drawn beside a unit or the keyboard, and the gap before it. */
export const MOUSE_WIDTH = 220;
export const MOUSE_GAP = 24;
/** The keyboard is never drawn smaller than the canvas's EditorKeys (0.8): the mouse moves under. */
export const MIN_KEYBOARD_SCALE = 0.8;

/** The side panel's width for a window (or editor) this wide. */
export const sidePanelWidth = (width: number): number =>
  width >= WIDE_WINDOW ? SIDE_WIDE : SIDE_NARROW;

export interface UnitRow {
  /** One under the other (and the mouse under the unit) instead of side by side. */
  stacked: boolean;
  /** The scale each unit is drawn at; undefined before the width is known (full width). */
  scale: number | undefined;
}

/**
 * The units of a tab in `width`: `count` units side by side, with something `beside` them (the
 * mouse beside the left unit) as wide as given. Side by side while each unit keeps at least
 * MIN_UNIT_SCALE; else stacked, each as wide as the width. Never past full size.
 */
export function unitRow(width: number | undefined, count: number, beside = 0): UnitRow {
  if (width === undefined) return { stacked: false, scale: undefined };
  const gaps = (count - 1 + (beside > 0 ? 1 : 0)) * UNIT_GAP;
  const side = (width - gaps - beside) / count / UNIT_WIDTH;
  if (side >= MIN_UNIT_SCALE) return { stacked: false, scale: Math.min(1, side) };
  return { stacked: true, scale: Math.min(1, width / UNIT_WIDTH) };
}

export interface KeyboardRow {
  /** The mouse under the keyboard, so the keyboard keeps its size. */
  mouseBelow: boolean;
  /** The keyboard's scale; undefined before the width is known. */
  scale: number | undefined;
}

/**
 * The keyboard in `width`, with the mouse beside it while the keyboard keeps MIN_KEYBOARD_SCALE
 * there, else under it. Never past full size.
 */
export function keyboardRow(width: number | undefined, mouse = true): KeyboardRow {
  if (width === undefined) return { mouseBelow: false, scale: undefined };
  if (!mouse) return { mouseBelow: false, scale: Math.min(1, width / KEYBOARD_WIDTH) };
  const beside = (width - MOUSE_GAP - MOUSE_WIDTH) / KEYBOARD_WIDTH;
  if (beside >= MIN_KEYBOARD_SCALE) return { mouseBelow: false, scale: Math.min(1, beside) };
  return { mouseBelow: true, scale: Math.min(1, width / KEYBOARD_WIDTH) };
}
