// The fix offers of the scheme open, worked out after the Editor has drawn (each re-resolves a
// scheme: too slow for a draw on a game of hundreds of actions), a slice at a time between frames
// (offer-work.ts).
import { useEffect, useState } from 'react';
import type { Game, Plan, Scheme } from '@helmarray/core';
import type { OfferBook } from './editor-view';
import { OfferWork } from './offer-work';

const WORK = new OfferWork({
  now: () => performance.now(),
  later: (next) => {
    const timer = setTimeout(next, 0);
    return () => clearTimeout(timer);
  },
  sliceMs: 12,
});

export function useOffers(scheme: Scheme, game: Game, plan: Plan | null): OfferBook {
  // Bumped after each slice, so the Editor draws what has been worked out so far.
  const [, setSlices] = useState(0);
  useEffect(() => {
    if (plan === null) return;
    return WORK.start(scheme, game, plan, () => setSlices((n) => n + 1));
  }, [scheme, game, plan]);
  return WORK.book(scheme);
}
