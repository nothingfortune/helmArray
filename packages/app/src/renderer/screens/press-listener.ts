// What the Game screen listens to while it waits for a press, and for undo: key and mouse events
// on the window, and the pads read through the Gamepad API once a frame, only while a controller
// button is waited for. Pure of the DOM: the window, the pads and the frames are handed in, so
// tests drive it with Node's own EventTarget. Nothing listens outside the window.

import type { PadControl, Signal } from '@helmarray/core';
import { newPadPress, padsHeld, whileWaitingForKey, whileWaitingForPad } from './capture';
import type { PadSnapshot } from './capture';
import { historyAction } from './editor-model';

export interface PressEnv {
  /** Where key and mouse events are heard: the window. */
  target: EventTarget;
  /** The pads now, as the Gamepad API has them. */
  pads(): readonly (PadSnapshot | null)[];
  /** `requestAnimationFrame` and its cancel. */
  frame(fn: () => void): number;
  cancelFrame(id: number): void;
  /** The event landed on the waiting field or its list: a mouse press there doesn't cancel. */
  inZone(e: Event): boolean;
  /** The event landed in the list of keys a press can't set, which takes its own keys. */
  inList(e: Event): boolean;
  /** Moves the focus to that list. Whether there was one. */
  focusList(): boolean;
}

export interface PressHandlers {
  press(value: Signal | PadControl): void;
  cancel(): void;
  /**
   * While a controller button is waited for: whether a controller that can be read is connected.
   * Said at once, then each time it changes.
   */
  controller(connected: boolean): void;
}

type KeyEvent = Event & { code: string; repeat: boolean; shiftKey: boolean };

/** The object form: Node's EventTarget, which the tests use, removes only that one by it. */
const CAPTURE = { capture: true } as const;

/** A pad with the standard layout is there: the only kind whose buttons can be named. */
const hasController = (pads: readonly (PadSnapshot | null)[]) =>
  pads.some((pad) => pad !== null && pad.mapping === 'standard');

/**
 * Listens while a press is waited for. A key: the next key pressed (Esc cancels, Tab goes to the
 * list of keys a press can't set). A controller button: the first pressed since the wait began
 * (Esc cancels; every other key works as usual), saying whether a controller is connected at all.
 * A mouse press outside the waiting field and its list cancels either. Returns the way to stop.
 */
export function listenForPress(part: 'key' | 'pad', env: PressEnv, on: PressHandlers): () => void {
  const onKey = (event: Event) => {
    const e = event as KeyEvent;
    if (part === 'pad') {
      if (whileWaitingForPad(e) === 'cancel') {
        e.preventDefault();
        on.cancel();
      }
      return;
    }
    const outcome = whileWaitingForKey(e);
    if (outcome.kind === 'cancel') {
      e.preventDefault();
      e.stopPropagation();
      on.cancel();
      return;
    }
    if (env.inList(e)) return;
    if (outcome.kind === 'pass') {
      if (!e.shiftKey && env.focusList()) e.preventDefault();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (outcome.kind === 'set') on.press(outcome.signal);
  };
  const onDown = (e: Event) => {
    if (!env.inZone(e)) on.cancel();
  };
  // In the capture phase, so a key waited for never reaches the page's own handlers (Delete on
  // another field, Alt+Up on a row) as well as being set.
  env.target.addEventListener('keydown', onKey, CAPTURE);
  env.target.addEventListener('mousedown', onDown, CAPTURE);

  let frame: number | null = null;
  if (part === 'pad') {
    // Each frame is compared with the one before it: only a hold unbroken since the wait began is
    // ignored, so a button held then, let go and pressed again counts.
    // With none connected the pads are still read every frame: one plugged in is noticed, and the
    // press it is found by (the Gamepad API shows a pad only once a button on it is pressed) counts.
    const first = env.pads();
    let before = padsHeld(first);
    let connected = hasController(first);
    on.controller(connected);
    const poll = () => {
      const pads = env.pads();
      if (hasController(pads) !== connected) {
        connected = !connected;
        on.controller(connected);
      }
      const now = padsHeld(pads);
      const pressed = newPadPress(before, now);
      before = now;
      if (pressed !== null) {
        frame = null;
        on.press(pressed);
      } else frame = env.frame(poll);
    };
    frame = env.frame(poll);
  }
  return () => {
    env.target.removeEventListener('keydown', onKey, CAPTURE);
    env.target.removeEventListener('mousedown', onDown, CAPTURE);
    if (frame !== null) env.cancelFrame(frame);
  };
}

export interface UndoHandlers {
  /** Off while a press is waited for: Ctrl+Z is then a key to set. */
  enabled(): boolean;
  /** The event landed where typing means something: Ctrl+Z belongs to the field. */
  inText(e: Event): boolean;
  undo(): void;
  redo(): void;
}

/** Ctrl+Z and Ctrl+Y (or Ctrl+Shift+Z) on the window, outside text fields. Returns the way to stop. */
export function listenForUndo(target: EventTarget, on: UndoHandlers): () => void {
  const onKey = (event: Event) => {
    if (on.inText(event)) return;
    const wanted = historyAction(
      event as unknown as Parameters<typeof historyAction>[0],
      on.enabled(),
    );
    if (wanted === null) return;
    event.preventDefault();
    if (wanted === 'undo') on.undo();
    else on.redo();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
