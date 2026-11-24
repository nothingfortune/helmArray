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
}

type KeyEvent = Event & { code: string; repeat: boolean; shiftKey: boolean };

/**
 * Listens while a press is waited for. A key: the next key pressed (Esc cancels, Tab goes to the
 * list of keys a press can't set). A controller button: the first pressed since the wait began
 * (Esc cancels; every other key works as usual). A mouse press outside the waiting field and its
 * list cancels either. Returns the way to stop.
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
  env.target.addEventListener('keydown', onKey);
  env.target.addEventListener('mousedown', onDown);

  let frame: number | null = null;
  if (part === 'pad') {
    const before = padsHeld(env.pads());
    const poll = () => {
      const pressed = newPadPress(before, padsHeld(env.pads()));
      if (pressed !== null) {
        frame = null;
        on.press(pressed);
      } else frame = env.frame(poll);
    };
    frame = env.frame(poll);
  }
  return () => {
    env.target.removeEventListener('keydown', onKey);
    env.target.removeEventListener('mousedown', onDown);
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
