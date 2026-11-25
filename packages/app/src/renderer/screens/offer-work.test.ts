import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES, blankKeysScheme, helldivers2, resolve } from '@helmarray/core';
import { editorView } from './editor-view';
import { OfferWork } from './offer-work';

/** A scheduler run by hand, and a clock that moves 1 ms each time it is read: one step a slice. */
function work() {
  const queue: (() => void)[] = [];
  let time = 0;
  const w = new OfferWork({
    now: () => time++,
    later: (next) => {
      queue.push(next);
      return () => queue.splice(queue.indexOf(next), 1);
    },
    sliceMs: 1,
  });
  const drain = () => {
    while (queue.length > 0) queue.shift()?.();
  };
  return { w, queue, drain };
}

const scheme = blankKeysScheme(helldivers2);
const plan = resolve(scheme, helldivers2, BUILT_IN_DEVICES);

describe('OfferWork', () => {
  it('has nothing for a scheme before its work runs, then every offer the draw would work out now', () => {
    const { w, drain } = work();
    let changes = 0;
    w.start(scheme, helldivers2, plan, () => changes++);
    const before = w.book(scheme).size;
    drain();
    const now = editorView({ scheme, game: helldivers2, plan, mode: 'default' });
    const later = editorView({
      scheme,
      game: helldivers2,
      plan,
      mode: 'default',
      offers: w.book(scheme),
    });
    expect({
      before,
      changed: changes > 0,
      fixes: later.findings.map((r) => r.fix?.label ?? r.why),
      groupFix: later.checks.map((c) => (c.kind === 'group' ? c.fix?.label : c.row.key)),
    }).toEqual({
      before: 0,
      changed: true,
      fixes: now.findings.map((r) => r.fix?.label ?? r.why),
      groupFix: now.checks.map((c) => (c.kind === 'group' ? c.fix?.label : c.row.key)),
    });
  });

  it('does nothing again for a scheme done, and starts over for one cut short', () => {
    const { w, queue, drain } = work();
    const stop = w.start(scheme, helldivers2, plan, () => undefined);
    queue.shift()?.();
    stop();
    const cut = w.book(scheme).size;
    w.start(scheme, helldivers2, plan, () => undefined);
    drain();
    const done = w.book(scheme).size;
    w.start(scheme, helldivers2, plan, () => undefined);
    expect([cut, done > 1, queue.length]).toEqual([0, true, 0]);
  });

  it('gives a new book after each slice, so a draw memoised on it draws again', () => {
    const { w, queue } = work();
    w.start(scheme, helldivers2, plan, () => undefined);
    queue.shift()?.();
    const first = w.book(scheme);
    queue.shift()?.();
    expect([first === w.book(scheme), w.book(scheme).size]).toEqual([false, 2]);
  });
});
