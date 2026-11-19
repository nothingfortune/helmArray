import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command, FakeUnit, UnitSession, parseHostReport } from '@helmarray/azeron';
import { FINDER_POLL_MS, createHandFinder } from './hand-finder';
import type { FindableUnit } from './hand-finder';
import { PRESS_PROMPT } from './hands';
import type { HandQuestion } from './hands';

const A = 49229;
const B = 29993;

const press: HandQuestion = { kind: 'press', hand: 'left', ids: [A, B], prompt: PRESS_PROMPT };

/** Two units on slots 1 and 2, each behind a session that has read its slots. */
async function bench() {
  const fakes = new Map<number, FakeUnit>();
  const sessions = new Map<number, UnitSession>();
  const sent: { id: number; command: number }[] = [];
  for (const [id, running] of [
    [A, 1],
    [B, 2],
  ] as const) {
    const fake = new FakeUnit({
      deviceId: id,
      slots: { 1: { name: 'One' }, 2: { name: 'Two' }, 3: { name: 'Three' } },
      running,
    });
    fakes.set(id, fake);
    const session = new UnitSession({
      send: (report) => {
        sent.push({ id, command: parseHostReport(report).command });
        return fake.send(report);
      },
      receive: () => fake.receive(),
    });
    await session.identify();
    await session.readSlots();
    sessions.set(id, session);
  }
  const fake = (id: number): FakeUnit => {
    const found = fakes.get(id);
    if (!found) throw new Error(`no unit ${id}`);
    return found;
  };
  return { fakes, fake, sessions, sent };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const tickOver = () => vi.advanceTimersByTimeAsync(FINDER_POLL_MS);

describe('the hand finder', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(
    b: Awaited<ReturnType<typeof bench>>,
    over: {
      session?: (id: number) => FindableUnit | undefined;
      assign?: (id: number, hand: 'left') => Promise<void>;
    } = {},
  ) {
    const assigned: [number, string][] = [];
    const traces: string[] = [];
    const finder = createHandFinder({
      session: over.session ?? ((id) => b.sessions.get(id)),
      assign:
        over.assign ??
        ((id, hand) => {
          assigned.push([id, hand]);
          return Promise.resolve();
        }),
      trace: (line) => traces.push(line),
    });
    return { finder, assigned, traces };
  }

  it('makes the unit whose slot moved the left one, and puts it back where it was', async () => {
    const b = await bench();
    const { finder, assigned } = setup(b);
    finder.update(press, false);
    await settle();
    expect(b.fakes.get(A)?.running).toBe(1);

    b.fake(B).running = 3; // the profile button on B
    await tickOver();

    expect(assigned).toEqual([[B, 'left']]);
    expect(b.fakes.get(B)?.running).toBe(2); // back on the slot it ran
    expect(b.fakes.get(A)?.running).toBe(1); // the other was never touched
    finder.stop();
  });

  it('switches nothing when nobody presses', async () => {
    const b = await bench();
    const { finder, assigned } = setup(b);
    finder.update(press, false);
    await settle();
    await vi.advanceTimersByTimeAsync(FINDER_POLL_MS * 5);
    expect(assigned).toEqual([]);
    expect(b.sent.filter((s) => s.command === Command.SWITCH_PROFILE)).toEqual([]);
    // It did look: only the slot question is asked.
    expect(
      b.sent.filter((s) => s.command === Command.HARDWARE_PROFILE_INDEX).length,
    ).toBeGreaterThan(4);
    finder.stop();
  });

  it('asks only which slot a unit runs while it waits', async () => {
    const b = await bench();
    const { finder } = setup(b);
    b.sent.length = 0;
    finder.update(press, false);
    await vi.advanceTimersByTimeAsync(FINDER_POLL_MS * 3);
    expect(new Set(b.sent.map((s) => s.command))).toEqual(
      new Set([Command.HARDWARE_PROFILE_INDEX]),
    );
    finder.stop();
  });

  it('looks at both units every 300 ms', async () => {
    const b = await bench();
    const { finder } = setup(b);
    b.sent.length = 0;
    finder.update(press, false);
    await settle();
    expect(b.sent.map((s) => s.id).sort()).toEqual([B, A].sort());
    b.sent.length = 0;
    await vi.advanceTimersByTimeAsync(299);
    expect(b.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.sent.length).toBe(2);
    finder.stop();
  });

  it('never looks while the Azeron app is open', async () => {
    const b = await bench();
    const { finder } = setup(b);
    b.sent.length = 0;
    finder.update(press, true);
    await vi.advanceTimersByTimeAsync(FINDER_POLL_MS * 5);
    expect(b.sent).toEqual([]);
    // And once it closes, it looks.
    finder.update(press, false);
    await settle();
    expect(b.sent.length).toBe(2);
    finder.stop();
  });

  it('stops when the Azeron app opens, and puts nothing back after it', async () => {
    const b = await bench();
    const { finder } = setup(b);
    finder.update(press, false);
    await settle();
    b.sent.length = 0;
    finder.update(press, true);
    b.fake(A).running = 3;
    await vi.advanceTimersByTimeAsync(FINDER_POLL_MS * 5);
    expect(b.sent).toEqual([]);
    finder.stop();
  });

  it('stops when the question goes away', async () => {
    const b = await bench();
    const { finder } = setup(b);
    finder.update(press, false);
    await settle();
    finder.update(null, false);
    b.sent.length = 0;
    await vi.advanceTimersByTimeAsync(FINDER_POLL_MS * 5);
    expect(b.sent).toEqual([]);
  });

  it('does not poll for a question that is not a press', async () => {
    const b = await bench();
    const { finder } = setup(b);
    b.sent.length = 0;
    finder.update({ kind: 'choose', id: A, prompt: 'x' }, false);
    await vi.advanceTimersByTimeAsync(FINDER_POLL_MS * 3);
    expect(b.sent).toEqual([]);
    finder.stop();
  });

  it('stops when a unit is unplugged, and does not take its return for a press', async () => {
    const b = await bench();
    const gone = new Set<number>();
    const { finder, assigned } = setup(b, {
      session: (id) => (gone.has(id) ? undefined : b.sessions.get(id)),
    });
    finder.update(press, false);
    await settle();

    gone.add(B); // unplugged: the question turns into a `choose` for the one left
    finder.update({ kind: 'choose', id: A, prompt: 'x' }, false);
    b.sent.length = 0;
    await vi.advanceTimersByTimeAsync(FINDER_POLL_MS * 5);
    expect(b.sent).toEqual([]);

    // Even if the question stood on: a unit that comes back is looked at afresh.
    gone.delete(B);
    b.fake(B).running = 3;
    finder.update(press, false);
    await vi.advanceTimersByTimeAsync(FINDER_POLL_MS * 3);
    expect(assigned).toEqual([]);
    finder.stop();
  });

  it('skips a unit that has gone while the question still stands', async () => {
    const b = await bench();
    const gone = new Set<number>();
    const { finder, assigned } = setup(b, {
      session: (id) => (gone.has(id) ? undefined : b.sessions.get(id)),
    });
    finder.update(press, false);
    await settle();
    gone.add(B);
    b.fake(A).running = 2;
    await tickOver();
    // A still counts: only B is out of reach.
    expect(assigned).toEqual([[A, 'left']]);
    finder.stop();
  });

  it('is not undone by a poll that fails: it carries on and still finds the press', async () => {
    const b = await bench();
    let fail = true;
    const { finder, assigned, traces } = setup(b, {
      session: (id) => {
        const real = b.sessions.get(id);
        if (!real) return undefined;
        return {
          runningSlot: () =>
            fail ? Promise.reject(new Error('the unit went quiet')) : real.runningSlot(),
          switchTo: (slot) => real.switchTo(slot),
        };
      },
    });
    finder.update(press, false);
    await vi.advanceTimersByTimeAsync(FINDER_POLL_MS * 2);
    expect(traces.some((line) => line.includes('the unit went quiet'))).toBe(true);
    expect(assigned).toEqual([]);

    fail = false;
    await tickOver(); // baselines are taken now
    b.fake(A).running = 3;
    await tickOver();
    expect(assigned).toEqual([[A, 'left']]);
    expect(b.fakes.get(A)?.running).toBe(1);
    finder.stop();
  });

  it('still puts the unit back when remembering the hand fails', async () => {
    const b = await bench();
    const { finder, traces } = setup(b, {
      assign: () => Promise.reject(new Error('disk full')),
    });
    finder.update(press, false);
    await settle();
    b.fake(A).running = 3;
    await tickOver();
    expect(b.fakes.get(A)?.running).toBe(1);
    expect(traces.some((line) => line.includes('disk full'))).toBe(true);
    finder.stop();
  });

  it('does not crash when putting the unit back fails', async () => {
    const b = await bench();
    const { finder, assigned, traces } = setup(b, {
      session: (id) => {
        const real = b.sessions.get(id);
        if (!real) return undefined;
        return {
          runningSlot: () => real.runningSlot(),
          switchTo: () => Promise.reject(new Error('refused')),
        };
      },
    });
    finder.update(press, false);
    await settle();
    b.fake(A).running = 3;
    await tickOver();
    expect(assigned).toEqual([[A, 'left']]);
    expect(traces.some((line) => line.includes('refused'))).toBe(true);
    finder.stop();
  });

  it('puts both back and decides nothing when both units moved at once', async () => {
    const b = await bench();
    const { finder, assigned } = setup(b);
    finder.update(press, false);
    await settle();
    b.fake(A).running = 3;
    b.fake(B).running = 3;
    await tickOver();
    expect(assigned).toEqual([]);
    expect(b.fakes.get(A)?.running).toBe(1);
    expect(b.fakes.get(B)?.running).toBe(2);
    finder.stop();
  });

  it('asking again about the same two units does not restart the looking', async () => {
    const b = await bench();
    const { finder } = setup(b);
    finder.update(press, false);
    await settle();
    b.sent.length = 0;
    finder.update(press, false);
    finder.update(press, false);
    await settle();
    expect(b.sent).toEqual([]);
    finder.stop();
  });

  it('keeps looking after a press it could not remember, so the person can try again', async () => {
    const b = await bench();
    let fail = true;
    const assigned: number[] = [];
    const { finder } = setup(b, {
      assign: (id) => {
        if (fail) return Promise.reject(new Error('disk full'));
        assigned.push(id);
        return Promise.resolve();
      },
    });
    finder.update(press, false);
    await settle();
    b.fake(A).running = 3;
    await tickOver();
    fail = false;
    b.fake(A).running = 3;
    await tickOver();
    expect(assigned).toEqual([A]);
    finder.stop();
  });
});
