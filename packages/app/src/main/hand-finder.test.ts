import { describe, expect, it } from 'vitest';
import { FakeUnit } from '@helmarray/azeron';
import { createHandFinder } from './hand-finder';
import { PRESS_PROMPT } from './hands';
import type { HandQuestion } from './hands';

const A = 49229;
const B = 29993;

const press: HandQuestion = { kind: 'press', hand: 'left', ids: [A, B], prompt: PRESS_PROMPT };
const choose = (id: number): HandQuestion => ({ kind: 'choose', id, prompt: 'x' });

function setup(over: { decide?: (left: number, right: number) => Promise<void> } = {}) {
  const decided: [number, number][] = [];
  const traces: string[] = [];
  // Units behind the finder, counting what reaches them. The finder is never given a way to.
  const units = [A, B].map((deviceId) => new FakeUnit({ deviceId, slots: { 1: { name: 'One' } } }));
  const received = () => units.reduce((sum, unit) => sum + unit.received.length, 0);
  const finder = createHandFinder({
    decide:
      over.decide ??
      ((left, right) => {
        decided.push([left, right]);
        return Promise.resolve();
      }),
    trace: (line) => traces.push(line),
  });
  return { finder, decided, traces, received };
}

describe('the hand finder', () => {
  it('makes the first unit unplugged the left one, and the other the right', () => {
    const { finder, decided } = setup();
    expect(finder.update(press, false, [A, B])).toBe(false);
    // It is gone: the question has turned into one about the unit that is left.
    expect(finder.update(choose(B), false, [B])).toBe(true);
    expect(decided).toEqual([[A, B]]);
  });

  it('works whichever of the two goes', () => {
    const { finder, decided } = setup();
    finder.update(press, false, [A, B]);
    finder.update(choose(A), false, [A]);
    expect(decided).toEqual([[B, A]]);
  });

  it('decides nothing when both vanish at once', () => {
    const { finder, decided } = setup();
    finder.update(press, false, [A, B]);
    expect(finder.update(null, false, [])).toBe(false);
    expect(decided).toEqual([]);
  });

  it('decides nothing while the devices service is held off, which removes every unit', () => {
    const { finder, decided } = setup();
    finder.update(press, false, [A, B]);
    expect(finder.update(null, true, [])).toBe(false); // the Azeron app opened
    expect(finder.update(null, true, [])).toBe(false);
    expect(decided).toEqual([]);
  });

  it('decides nothing for a unit gone in the same update that blocks', () => {
    const { finder, decided } = setup();
    finder.update(press, false, [A, B]);
    expect(finder.update(choose(B), true, [B])).toBe(false);
    expect(decided).toEqual([]);
  });

  it('does not take a unit that left before the question for a press', () => {
    const { finder, decided } = setup();
    finder.update(null, false, [A]);
    finder.update(choose(A), false, []);
    expect(decided).toEqual([]);
  });

  it('is not fooled by a question that changes with both units still there', () => {
    const { finder, decided } = setup();
    finder.update(press, false, [A, B]);
    finder.update(null, false, [A, B]); // e.g. a unit began connecting again
    finder.update(choose(B), false, [B]);
    expect(decided).toEqual([]);
  });

  it('keeps watching through updates that change nothing', () => {
    const { finder, decided } = setup();
    for (let i = 0; i < 5; i++) finder.update(press, false, [A, B]);
    finder.update(choose(A), false, [A]);
    expect(decided).toEqual([[B, A]]);
  });

  it('decides once for one unplug', () => {
    const { finder, decided } = setup();
    finder.update(press, false, [A, B]);
    finder.update(choose(B), false, [B]);
    finder.update(choose(B), false, [B]);
    finder.update(null, false, [A, B]); // it was plugged back in
    expect(decided).toEqual([[A, B]]);
  });

  it('does nothing once stopped', () => {
    const { finder, decided } = setup();
    finder.update(press, false, [A, B]);
    finder.stop();
    finder.update(choose(B), false, [B]);
    expect(decided).toEqual([]);
  });

  it('traces a decision that could not be saved, and does not crash', async () => {
    const { finder, traces } = setup({ decide: () => Promise.reject(new Error('disk full')) });
    finder.update(press, false, [A, B]);
    expect(finder.update(choose(B), false, [B])).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(traces.some((line) => line.includes('disk full'))).toBe(true);
  });

  it('never sends a unit anything', () => {
    const { finder, received } = setup();
    finder.update(press, false, [A, B]);
    finder.update(choose(B), false, [B]);
    finder.update(null, true, []);
    expect(received()).toBe(0);
  });
});
