// The fix offers of each scheme the Editor opens, worked out after it draws (offer-slices.ts),
// and kept per scheme: schemes are never changed in place, so each is one version, and an undo
// back to one finds its offers done. Pure but for the clock and scheduler it is handed.
import type { Game, Plan, Scheme } from '@helmarray/core';
import { editorView, offerSteps } from './editor-view';
import type { OfferBook, OfferEntry } from './editor-view';
import { runInSlices } from './offer-slices';
import type { Slicing } from './offer-slices';

interface Kept {
  book: Map<string, OfferEntry>;
  done: boolean;
}

const NONE: OfferBook = new Map();

export class OfferWork {
  private readonly kept = new WeakMap<Scheme, Kept>();
  constructor(private readonly slicing: Slicing) {}

  /** The offers of a scheme worked out so far: all of them once its work is done. */
  book(scheme: Scheme): OfferBook {
    return this.kept.get(scheme)?.book ?? NONE;
  }

  /**
   * Works out a scheme's offers, slice by slice, calling `changed` after each. Nothing to do for a
   * scheme already done. Returns how to stop: a scheme cut short starts again the next time.
   */
  start(scheme: Scheme, game: Game, plan: Plan, changed: () => void): () => void {
    if (this.kept.get(scheme)?.done === true) return () => undefined;
    const entry: Kept = { book: new Map(), done: false };
    this.kept.set(scheme, entry);
    // The rows' keys don't depend on the mode shown: any mode gives them.
    const { findings } = editorView({
      scheme,
      game,
      plan,
      mode: game.modes[0]?.id ?? 'default',
      offers: NONE,
    });
    const stop = runInSlices(
      offerSteps({ findings }, scheme, game, plan),
      this.slicing,
      (taken, done) => {
        for (const [key, offer] of taken) entry.book.set(key, offer);
        entry.done = done;
        changed();
      },
    );
    return () => {
      stop();
      if (!entry.done) this.kept.delete(scheme);
    };
  }
}
