// The fix offers of the scheme open, worked out after the Editor has drawn (each re-resolves a
// scheme: too slow for a draw on a game of hundreds of actions), a slice at a time between frames.
// Kept per scheme: an undo back to a scheme already worked out finds them at once.
import { useEffect, useState } from 'react';
import type { Game, Plan, Scheme } from '@helmarray/core';
import { editorView, offerSteps } from './editor-view';
import type { OfferBook, OfferEntry } from './editor-view';

/** How long one slice works before it lets the window draw, in ms. */
const SLICE_MS = 12;

interface Kept {
  book: Map<string, OfferEntry>;
  done: boolean;
}
/** The offers worked out per scheme: schemes are never changed in place, so each is one version. */
const KEPT = new WeakMap<Scheme, Kept>();
const NONE: OfferBook = new Map();

export function useOffers(scheme: Scheme, game: Game, plan: Plan | null): OfferBook {
  const [shown, setShown] = useState<{ scheme: Scheme; book: OfferBook } | null>(null);
  useEffect(() => {
    if (plan === null) return;
    // Worked out before (an undo back to it): the draw already reads it from KEPT.
    if (KEPT.get(scheme)?.done === true) return;
    const entry: Kept = { book: new Map(), done: false };
    KEPT.set(scheme, entry);
    const { findings } = editorView({
      scheme,
      game,
      plan,
      mode: game.modes[0]?.id ?? 'default',
      offers: NONE,
    });
    const steps = offerSteps({ findings }, scheme, game, plan);
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slice = () => {
      const start = performance.now();
      let step = steps.next();
      while (!step.done) {
        entry.book.set(step.value[0], step.value[1]);
        if (performance.now() - start > SLICE_MS) break;
        step = steps.next();
      }
      if (!live) return;
      entry.done = step.done === true;
      setShown({ scheme, book: new Map(entry.book) });
      if (!entry.done) timer = setTimeout(slice, 0);
    };
    timer = setTimeout(slice, 0);
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
      // Cut short: worked out again from the start next time.
      if (!entry.done) KEPT.delete(scheme);
    };
  }, [scheme, game, plan]);
  if (shown?.scheme === scheme) return shown.book;
  return KEPT.get(scheme)?.book ?? NONE;
}
