import { describe, expect, it } from 'vitest';
import { runInSlices } from './offer-slices';

/** A clock each step moves on by `cost` ms, and a scheduler run by hand. */
function world(cost: number) {
  let time = 0;
  const queue: (() => void)[] = [];
  return {
    slicing: {
      now: () => time,
      later: (next: () => void) => {
        queue.push(next);
        return () => {
          const i = queue.indexOf(next);
          if (i >= 0) queue.splice(i, 1);
        };
      },
      sliceMs: 10,
    },
    steps: function* (count: number) {
      for (let i = 0; i < count; i++) {
        time += cost;
        yield i;
      }
    },
    turn: () => queue.shift()?.(),
    waiting: () => queue.length,
  };
}

describe('runInSlices', () => {
  it('waits for a turn before the first slice', () => {
    const w = world(4);
    const slices: number[][] = [];
    runInSlices(w.steps(5), w.slicing, (taken) => slices.push(taken));
    expect([slices, w.waiting()]).toEqual([[], 1]);
  });

  it('takes steps until the slice’s time is up, then goes on in the next', () => {
    const w = world(4);
    const slices: [number[], boolean][] = [];
    runInSlices(w.steps(5), w.slicing, (taken, done) => slices.push([taken, done]));
    w.turn();
    w.turn();
    expect(slices).toEqual([
      [[0, 1, 2], false],
      [[3, 4], true],
    ]);
  });

  it('stops: nothing more is handed over, and nothing is left waiting', () => {
    const w = world(4);
    const slices: number[][] = [];
    const stop = runInSlices(w.steps(9), w.slicing, (taken) => slices.push(taken));
    w.turn();
    stop();
    expect([slices.length, w.waiting()]).toEqual([1, 0]);
  });

  it('hands over an empty run as done at once', () => {
    const w = world(4);
    const slices: [number[], boolean][] = [];
    runInSlices(w.steps(0), w.slicing, (taken, done) => slices.push([taken, done]));
    w.turn();
    expect(slices).toEqual([[[], true]]);
  });
});
