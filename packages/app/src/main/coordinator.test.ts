import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../shared/api';
import { createCoordinator } from './coordinator';
import type { DevicesSnapshot, UnitSnapshot } from './devices';
import type { FindableUnit } from './hand-finder';
import { openHandStore } from './hands';
import type { HandsStorage } from './hands';
import { processState } from './processes';

const LEFT = 49229;
const RIGHT = 29993;
const BLOCK = 'Close the Azeron app first: it talks to the units too.';

class FakeUnitSet implements FindableUnit {
  switched: number[] = [];
  asked = 0;
  constructor(public running: number) {}
  runningSlot() {
    this.asked++;
    return Promise.resolve(this.running);
  }
  switchTo(slot: number) {
    this.switched.push(slot);
    this.running = slot;
    return Promise.resolve();
  }
}

async function bench(saved: Record<string, 'left' | 'right'> = {}) {
  const stored: { value: unknown } = { value: Object.keys(saved).length ? saved : undefined };
  const storage: HandsStorage = {
    load: () => Promise.resolve(stored.value),
    save: (value) => {
      stored.value = value;
      return Promise.resolve();
    },
  };
  const hands = await openHandStore(storage);
  const units: UnitSnapshot[] = [];
  const sessions = new Map<number, FakeUnitSet>();
  const listeners = new Set<() => void>();
  const gateCalls: boolean[] = [];
  const states: AppState[] = [];
  const traces: string[] = [];
  const helm = createCoordinator({
    devices: {
      snapshot: (): DevicesSnapshot => ({ units: structuredClone(units) }),
      onChange: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      session: (id) => sessions.get(id),
    },
    hands,
    gate: {
      azeronRunning: (running) => {
        gateCalls.push(running);
        return Promise.resolve();
      },
      shutdown: () => Promise.resolve(),
    },
    readLog: (lines) => Promise.resolve([`last ${lines}`]),
    trace: (unit, line) => traces.push(`${unit} ${line}`),
  });
  helm.onState((state) => states.push(state));

  const plug = (path: string, id: number, running = 1, state: UnitSnapshot['state'] = 'ready') => {
    units.push({
      path,
      state,
      identity: { firmware: 112, deviceId: id, slotLimit: 8, runningSlot: running },
    });
    if (state === 'ready') sessions.set(id, new FakeUnitSet(running));
    for (const listener of listeners) listener();
  };
  const unplug = (path: string) => {
    const index = units.findIndex((u) => u.path === path);
    const [gone] = units.splice(index, 1);
    if (gone?.identity) sessions.delete(gone.identity.deviceId);
    for (const listener of listeners) listener();
  };
  const unit = (id: number): FakeUnitSet => {
    const found = sessions.get(id);
    if (!found) throw new Error(`no unit ${id}`);
    return found;
  };
  return { helm, hands, stored, units, sessions, unit, gateCalls, states, traces, plug, unplug };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const AZERON_CLOSED = processState(['explorer.exe']);
const AZERON_OPEN = processState(['explorer.exe', 'Azeron Software.exe']);

describe('the coordinator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts out with no units and no question', async () => {
    const b = await bench();
    expect(b.helm.state()).toMatchObject({ devices: [], writeBlock: null, question: null });
  });

  it('tells its listeners when the units change, and only when the state does', async () => {
    const b = await bench({ [LEFT]: 'left', [RIGHT]: 'right' });
    b.helm.start();
    await settle();
    expect(b.states).toEqual([]); // nothing changed yet
    b.plug('a', LEFT);
    await settle();
    expect(b.states).toHaveLength(1);
    expect(b.helm.state().devices.map((chip) => chip.hand)).toEqual(['left']);
    b.helm.azeronChanged(AZERON_CLOSED);
    await settle();
    // The Azeron app being closed changes nothing the windows show.
    expect(b.states).toHaveLength(1);
    b.plug('b', RIGHT);
    await settle();
    expect(b.states).toHaveLength(2);
    expect(b.helm.state().devices.map((chip) => chip.hand)).toEqual(['left', 'right']);
  });

  it('stops listening to the units once stopped', async () => {
    const b = await bench({ [LEFT]: 'left' });
    b.helm.start();
    await settle();
    b.helm.stop();
    b.plug('a', LEFT);
    await settle();
    expect(b.states).toEqual([]);
  });

  it('settles a hand worked out from the other unit, and remembers it', async () => {
    const b = await bench({ [LEFT]: 'left' });
    b.helm.start();
    b.plug('a', LEFT);
    b.plug('b', RIGHT);
    await settle();
    expect(b.stored.value).toEqual({ [LEFT]: 'left', [RIGHT]: 'right' });
    expect(b.helm.state().question).toBeNull();
  });

  it('blocks writes and stops the units when the Azeron app opens, and says why', async () => {
    const b = await bench({ [LEFT]: 'left', [RIGHT]: 'right' });
    b.helm.start();
    b.helm.azeronChanged(AZERON_OPEN);
    await settle();
    expect(b.gateCalls).toEqual([true]);
    expect(b.helm.state().writeBlock).toBe(BLOCK);
    b.helm.azeronChanged(AZERON_CLOSED);
    await settle();
    expect(b.gateCalls).toEqual([true, false]);
    expect(b.helm.state().writeBlock).toBeNull();
  });

  it('asks for the profile button with two new units', async () => {
    const b = await bench();
    b.helm.start();
    b.helm.azeronChanged(AZERON_CLOSED);
    b.plug('a', LEFT);
    b.plug('b', RIGHT);
    await settle();
    expect(b.helm.state().question).toEqual({
      kind: 'press',
      prompt: 'Press the profile button on your left Azeron.',
    });
  });

  it('asks nothing while the first look at the running programs is still to come', async () => {
    const b = await bench();
    b.helm.start();
    b.plug('a', LEFT);
    b.plug('b', RIGHT);
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.sessions.get(LEFT)?.asked).toBe(0);
    expect(b.sessions.get(RIGHT)?.asked).toBe(0);
  });

  it('works out which is the left from a press of the profile button, then settles both', async () => {
    const b = await bench();
    b.helm.start();
    b.helm.azeronChanged(AZERON_CLOSED);
    b.plug('a', LEFT, 1);
    b.plug('b', RIGHT, 2);
    await vi.advanceTimersByTimeAsync(700);
    expect(b.helm.state().question?.kind).toBe('press');

    const right = b.unit(RIGHT);
    right.running = 3; // the button, pressed on the unit that is the left one by the person's word
    await vi.advanceTimersByTimeAsync(300);

    // The pressed unit (RIGHT's id) is the left hand; the other follows without a question.
    expect(b.stored.value).toEqual({ [RIGHT]: 'left', [LEFT]: 'right' });
    expect(right.switched).toEqual([2]);
    expect(b.sessions.get(LEFT)?.switched).toEqual([]);
    expect(b.helm.state().question).toBeNull();
    expect(b.helm.state().devices.map((chip) => [chip.hand, chip.unitId])).toEqual([
      ['left', RIGHT],
      ['right', LEFT],
    ]);

    // And the looking has stopped.
    const asked = right.asked;
    await vi.advanceTimersByTimeAsync(2000);
    expect(right.asked).toBe(asked);
  });

  it('stops looking for a press when the Azeron app opens', async () => {
    const b = await bench();
    b.helm.start();
    b.helm.azeronChanged(AZERON_CLOSED);
    b.plug('a', LEFT);
    b.plug('b', RIGHT);
    await vi.advanceTimersByTimeAsync(700);
    b.helm.azeronChanged(AZERON_OPEN);
    const before = [b.unit(LEFT).asked, b.unit(RIGHT).asked];
    await vi.advanceTimersByTimeAsync(3000);
    expect([b.unit(LEFT).asked, b.unit(RIGHT).asked]).toEqual(before);
  });

  it('stops looking when a unit is unplugged, and asks outright about the one left', async () => {
    const b = await bench();
    b.helm.start();
    b.helm.azeronChanged(AZERON_CLOSED);
    b.plug('a', LEFT);
    b.plug('b', RIGHT);
    await vi.advanceTimersByTimeAsync(700);
    const kept = b.unit(LEFT);
    b.unplug('b');
    await vi.advanceTimersByTimeAsync(300);
    expect(b.helm.state().question).toEqual({
      kind: 'choose',
      unitId: LEFT,
      prompt: 'Is this your left or right Azeron?',
    });
    const asked = kept.asked;
    await vi.advanceTimersByTimeAsync(3000);
    expect(kept.asked).toBe(asked);
  });

  describe('chooseHand', () => {
    it('remembers the answer to a question that stands', async () => {
      const b = await bench();
      b.helm.start();
      b.plug('a', LEFT);
      await settle();
      await b.helm.chooseHand(LEFT, 'right');
      expect(b.stored.value).toEqual({ [LEFT]: 'right' });
      expect(b.helm.state().devices[0]?.hand).toBe('right');
      expect(b.helm.state().question).toBeNull();
    });

    it('refuses a unit nobody asked about', async () => {
      const b = await bench({ [LEFT]: 'left' });
      b.helm.start();
      b.plug('a', LEFT);
      await settle();
      await expect(b.helm.chooseHand(LEFT, 'right')).rejects.toThrow(/not waiting/);
      await expect(b.helm.chooseHand(12345, 'right')).rejects.toThrow(/not waiting/);
      expect(b.stored.value).toEqual({ [LEFT]: 'left' });
    });

    it('refuses something that is not a hand', async () => {
      const b = await bench();
      b.helm.start();
      b.plug('a', LEFT);
      await settle();
      await expect(b.helm.chooseHand(LEFT, 'middle' as 'left')).rejects.toThrow(/hand/);
      expect(b.stored.value).toBeUndefined();
    });
  });

  it('still shows a hand when it could not be saved, and says so in the log', async () => {
    const b = await bench({ [LEFT]: 'left' });
    vi.spyOn(b.hands, 'assign').mockRejectedValue(new Error('disk full'));
    b.helm.start();
    b.plug('a', LEFT);
    b.plug('b', RIGHT);
    await settle();
    expect(b.helm.state().devices.map((chip) => chip.hand)).toEqual(['left', 'right']);
    expect(b.traces.some((line) => line.includes('disk full'))).toBe(true);
  });

  it('reads the log for the windows', async () => {
    const b = await bench();
    expect(await b.helm.recentLog(5)).toEqual(['last 5']);
  });
});
