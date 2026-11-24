import type { PadControl, Signal } from '@helmarray/core';
import { describe, expect, it } from 'vitest';
import type { PadSnapshot } from './capture';
import { listenForPress, listenForUndo } from './press-listener';
import type { PressEnv } from './press-listener';

/** A key or mouse event as the window would dispatch it, with where it landed. */
function event(type: string, fields: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), fields);
}
const key = (code: string, more: Record<string, unknown> = {}) =>
  event('keydown', { code, repeat: false, shiftKey: false, ...more });

const pad = (pressed: number[] = []): PadSnapshot => ({
  mapping: 'standard',
  buttons: Array.from({ length: 17 }, (_, i) => ({
    pressed: pressed.includes(i),
    value: pressed.includes(i) ? 1 : 0,
  })),
  axes: [0, 0, 0, 0],
});

function world(part: 'key' | 'pad', start: (PadSnapshot | null)[] = [pad()]) {
  const target = new EventTarget();
  let pads = start;
  const frames = new Map<number, () => void>();
  let next = 1;
  let listFocused = 0;
  const env: PressEnv = {
    target,
    pads: () => pads,
    frame: (fn) => {
      frames.set(next, fn);
      return next++;
    },
    cancelFrame: (id) => void frames.delete(id),
    inZone: (e) => (e as { zone?: boolean }).zone === true,
    inList: (e) => (e as { list?: boolean }).list === true,
    focusList: () => {
      listFocused++;
      return true;
    },
  };
  const pressed: (Signal | PadControl)[] = [];
  let cancelled = 0;
  const stop = listenForPress(part, env, {
    press: (value) => pressed.push(value),
    cancel: () => cancelled++,
  });
  return {
    target,
    pressed,
    cancelled: () => cancelled,
    listFocused: () => listFocused,
    stop,
    setPads: (p: (PadSnapshot | null)[]) => {
      pads = p;
    },
    /** Runs the frames asked for, once each, as the browser would on its next paint. */
    tick: () => {
      const due = [...frames.entries()];
      frames.clear();
      for (const [, fn] of due) fn();
    },
    waitingFrames: () => frames.size,
  };
}

describe('waiting for a key', () => {
  it('takes the key pressed, and keeps it from the page', () => {
    const w = world('key');
    const e = key('KeyR');
    w.target.dispatchEvent(e);
    expect([w.pressed, e.defaultPrevented]).toEqual([[{ kind: 'key', code: 'R' }], true]);
  });

  it('cancels on Esc', () => {
    const w = world('key');
    w.target.dispatchEvent(key('Escape'));
    expect([w.pressed, w.cancelled()]).toEqual([[], 1]);
  });

  it('sends Tab to the list of keys a press can’t set, instead of setting it', () => {
    const w = world('key');
    const e = key('Tab');
    w.target.dispatchEvent(e);
    expect([w.pressed, w.listFocused(), e.defaultPrevented]).toEqual([[], 1, true]);
  });

  it('lets Shift+Tab move back as usual', () => {
    const w = world('key');
    const e = key('Tab', { shiftKey: true });
    w.target.dispatchEvent(e);
    expect([w.listFocused(), e.defaultPrevented]).toEqual([0, false]);
  });

  it('leaves the keys to that list while it has the focus, Esc apart', () => {
    const w = world('key');
    const arrow = key('ArrowDown', { list: true });
    w.target.dispatchEvent(arrow);
    w.target.dispatchEvent(key('Escape', { list: true }));
    expect([w.pressed, arrow.defaultPrevented, w.cancelled()]).toEqual([[], false, 1]);
  });

  it('swallows a key it has no name for, and goes on waiting', () => {
    const w = world('key');
    const e = key('Fn');
    w.target.dispatchEvent(e);
    w.target.dispatchEvent(key('KeyQ'));
    expect([e.defaultPrevented, w.pressed]).toEqual([true, [{ kind: 'key', code: 'Q' }]]);
  });

  it('keeps a key it takes from everything else in the page', () => {
    const w = world('key');
    const e = key('Delete');
    w.target.dispatchEvent(e);
    expect([e.cancelBubble, w.pressed]).toEqual([true, [{ kind: 'key', code: 'Del' }]]);
  });

  it('stops listening when stopped', () => {
    const w = world('key');
    w.stop();
    w.target.dispatchEvent(key('KeyR'));
    expect(w.pressed).toEqual([]);
  });

  it('never reads the pads', () => {
    const w = world('key');
    expect(w.waitingFrames()).toBe(0);
  });
});

describe('a mouse press while waiting', () => {
  it('cancels when it is outside the waiting field and its list', () => {
    const w = world('key');
    w.target.dispatchEvent(event('mousedown', { button: 0 }));
    expect(w.cancelled()).toBe(1);
  });

  it('does not cancel inside them: the field takes a mouse button itself', () => {
    const w = world('key');
    w.target.dispatchEvent(event('mousedown', { button: 0, zone: true }));
    expect(w.cancelled()).toBe(0);
  });
});

describe('waiting for a controller button', () => {
  it('takes the first button pressed after the wait began', () => {
    const w = world('pad');
    w.tick();
    w.setPads([pad([2])]);
    w.tick();
    expect(w.pressed).toEqual(['X']);
  });

  it('does not take a button held since before the wait', () => {
    const w = world('pad', [pad([0])]);
    w.tick();
    w.setPads([pad([0, 1])]);
    w.tick();
    expect(w.pressed).toEqual(['B']);
  });

  it('takes a button held when the wait began once it is let go and pressed again', () => {
    const w = world('pad', [pad([0])]);
    w.tick();
    w.setPads([pad()]);
    w.tick();
    w.setPads([pad([0])]);
    w.tick();
    expect(w.pressed).toEqual(['A']);
  });

  it('never takes a button held all through the wait', () => {
    const w = world('pad', [pad([0])]);
    for (let i = 0; i < 5; i++) w.tick();
    expect(w.pressed).toEqual([]);
  });

  it('takes a stick held past halfway when the wait began once it is let back and pushed again', () => {
    const stick = (y: number): PadSnapshot => ({ ...pad(), axes: [0, y, 0, 0] });
    const w = world('pad', [stick(-1)]);
    w.tick();
    w.setPads([stick(-0.2)]);
    w.tick();
    w.setPads([stick(-0.9)]);
    w.tick();
    expect(w.pressed).toEqual(['LS_UP']);
  });

  it('reads the pads every frame until a press, then stops', () => {
    const w = world('pad');
    w.tick();
    const still = w.waitingFrames();
    w.setPads([pad([3])]);
    w.tick();
    expect([still, w.waitingFrames()]).toEqual([1, 0]);
  });

  it('stops reading the pads when stopped', () => {
    const w = world('pad');
    w.stop();
    expect(w.waitingFrames()).toBe(0);
  });

  it('cancels on Esc and lets Tab and every other key through', () => {
    const w = world('pad');
    const tab = key('Tab');
    const letter = key('KeyR');
    w.target.dispatchEvent(tab);
    w.target.dispatchEvent(letter);
    w.target.dispatchEvent(key('Escape'));
    expect([tab.defaultPrevented, letter.defaultPrevented, w.pressed, w.cancelled()]).toEqual([
      false,
      false,
      [],
      1,
    ]);
  });
});

describe('listenForUndo', () => {
  function undoWorld(on = true) {
    const target = new EventTarget();
    const did: string[] = [];
    const stop = listenForUndo(target, {
      enabled: () => on,
      inText: (e) => (e as { text?: boolean }).text === true,
      undo: () => did.push('undo'),
      redo: () => did.push('redo'),
    });
    return { target, did, stop };
  }
  const chord = (k: string, more: Record<string, unknown> = {}) =>
    event('keydown', {
      key: k,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...more,
    });

  it('undoes on Ctrl+Z and redoes on Ctrl+Y', () => {
    const w = undoWorld();
    w.target.dispatchEvent(chord('z'));
    w.target.dispatchEvent(chord('y'));
    expect(w.did).toEqual(['undo', 'redo']);
  });

  it('leaves Ctrl+Z to a text field', () => {
    const w = undoWorld();
    w.target.dispatchEvent(chord('z', { text: true }));
    expect(w.did).toEqual([]);
  });

  it('does nothing while turned off (a press is waited for)', () => {
    const w = undoWorld(false);
    w.target.dispatchEvent(chord('z'));
    expect(w.did).toEqual([]);
  });

  it('stops when stopped', () => {
    const w = undoWorld();
    w.stop();
    w.target.dispatchEvent(chord('z'));
    expect(w.did).toEqual([]);
  });
});
