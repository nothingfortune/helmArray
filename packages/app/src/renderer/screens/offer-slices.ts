// Works out a run of steps a slice at a time, so a long piece of work (the fix offers of a large
// scheme) never holds the window for more than about one frame. Pure but for what it is handed:
// the clock and the scheduler, so a test drives both.

export interface Slicing {
  /** The time now, in ms. */
  now(): number;
  /** Runs `next` later, after the window has had a turn; returns how to cancel it. */
  later(next: () => void): () => void;
  /** How long one slice may work, in ms. */
  sliceMs: number;
}

/**
 * Takes steps until the slice's time is up, hands what it took to `onSlice` (with whether the run
 * is done), and goes on in the next slice. A step started is always finished, so one slow step
 * makes one long slice. The first slice also runs later. Returns how to stop it.
 */
export function runInSlices<T>(
  steps: Iterator<T>,
  slicing: Slicing,
  onSlice: (taken: T[], done: boolean) => void,
): () => void {
  let cancel = slicing.later(slice);
  let stopped = false;
  function slice() {
    const start = slicing.now();
    const taken: T[] = [];
    let step = steps.next();
    while (step.done !== true) {
      taken.push(step.value);
      if (slicing.now() - start >= slicing.sliceMs) break;
      step = steps.next();
    }
    if (stopped) return;
    const done = step.done === true;
    onSlice(taken, done);
    if (!done) cancel = slicing.later(slice);
  }
  return () => {
    stopped = true;
    cancel();
  };
}
