import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnitsHeld } from '@helmarray/core';
import { AZERONS_ONLY } from '@helmarray/core';
import type { AppState } from '../shared/api';
import { createCoordinator } from './coordinator';
import type { DevicesSnapshot, UnitSnapshot } from './devices';
import { openHandStore } from './hands';
import type { HandsStorage } from './hands';
import { processState } from './processes';

const LEFT = 49229;
const RIGHT = 29993;
const BLOCK = 'Close the Azeron app first: it talks to the units too.';

async function bench(
  saved: Record<string, 'left' | 'right'> = {},
  unitsHeld?: () => Promise<UnitsHeld>,
) {
  const active = { gameId: null as string | null, schemeId: null as string | null };
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
    active: () => ({ ...active }),
    trace: (unit, line) => traces.push(`${unit} ${line}`),
    ...(unitsHeld === undefined ? {} : { unitsHeld }),
  });
  helm.onState((state) => states.push(state));

  const plug = (path: string, id: number, state: UnitSnapshot['state'] = 'ready') => {
    units.push({
      path,
      state,
      identity: { firmware: 112, deviceId: id, slotLimit: 8, runningSlot: 1 },
    });
    for (const listener of listeners) listener();
  };
  const unplug = (path: string) => {
    const index = units.findIndex((u) => u.path === path);
    units.splice(index, 1);
    for (const listener of listeners) listener();
  };
  return { helm, hands, stored, active, units, listeners, gateCalls, states, traces, plug, unplug };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const AZERON_CLOSED = processState(['explorer.exe']);
const AZERON_OPEN = processState(['explorer.exe', 'Azeron Software.exe']);

describe('the coordinator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('says what each unit holds, from the record read afresh each time', async () => {
    const write = {
      schemeId: 'hd2-xbox',
      gameId: 'helldivers2',
      schemeName: 'Xbox controller',
      devices: { ...AZERONS_ONLY },
      output: 'pad' as const,
      at: 5,
      profile: {
        deviceId: 'cyborg2',
        hand: 'left' as const,
        pins: [],
        stick: { mode: 'keys' as const, angle: 0, invertX: false },
      },
    };
    let held: UnitsHeld = { left: null, right: null };
    const b = await bench({}, () => Promise.resolve(held));
    b.helm.start();
    await settle();
    const before = b.helm.state().onUnits;
    held = { left: write, right: null };
    await b.helm.plansChanged();
    expect([
      before,
      b.helm.state().onUnits.left?.schemeId,
      b.helm.state().onUnits.left?.check,
    ]).toEqual([{ left: null, right: null }, 'hd2-xbox', 'unknown']);
    b.helm.stop();
  });

  it('says no unit holds anything, and why in the log, when the record can’t be read', async () => {
    const b = await bench({}, () => Promise.reject(new Error('disk gone')));
    b.helm.start();
    await settle();
    expect([b.helm.state().onUnits, b.traces.some((t) => t.includes('disk gone'))]).toEqual([
      { left: null, right: null },
      true,
    ]);
    b.helm.stop();
  });

  it('tells the listeners when the active game or scheme changes', async () => {
    const b = await bench();
    b.helm.start();
    await settle();
    const before = b.states.length;
    b.active.gameId = 'everspace2';
    b.active.schemeId = 'everspace2-xbox-1';
    await b.helm.activeChanged();
    expect(b.states).toHaveLength(before + 1);
    expect(b.helm.state()).toMatchObject({
      activeGameId: 'everspace2',
      activeSchemeId: 'everspace2-xbox-1',
    });
    await b.helm.activeChanged();
    expect(b.states).toHaveLength(before + 1);
  });

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

  it('asks for the left unit to be unplugged with two new units', async () => {
    const b = await bench();
    b.helm.start();
    b.helm.azeronChanged(AZERON_CLOSED);
    b.plug('a', LEFT);
    b.plug('b', RIGHT);
    await settle();
    expect(b.helm.state().question).toEqual({
      kind: 'press',
      prompt: 'Unplug your left Azeron for a moment, then plug it back in.',
    });
  });

  it('works out which is the left from the first unit unplugged, and settles both', async () => {
    const b = await bench();
    const seen: AppState[] = [];
    b.helm.start();
    b.helm.azeronChanged(AZERON_CLOSED);
    b.plug('a', LEFT);
    b.plug('b', RIGHT);
    await settle();
    expect(b.helm.state().question?.kind).toBe('press');
    b.helm.onState((state) => seen.push(state));

    b.unplug('b'); // RIGHT's id is the unit the person called their left one
    await settle();
    expect(b.stored.value).toEqual({ [RIGHT]: 'left', [LEFT]: 'right' });
    // The unit left behind is never put up as a question while the other is out.
    expect(seen.every((state) => state.question === null)).toBe(true);
    expect(b.helm.state().devices.map((chip) => [chip.hand, chip.unitId])).toEqual([
      ['right', LEFT],
    ]);

    // Plugged back in, it is identified afresh and shows the hand it was given.
    b.plug('b2', RIGHT);
    await settle();
    expect(b.helm.state().devices.map((chip) => [chip.hand, chip.unitId])).toEqual([
      ['left', RIGHT],
      ['right', LEFT],
    ]);
    expect(b.helm.state().question).toBeNull();
  });

  it('decides nothing when both units vanish at once', async () => {
    const b = await bench();
    b.helm.start();
    b.helm.azeronChanged(AZERON_CLOSED);
    b.plug('a', LEFT);
    b.plug('b', RIGHT);
    await settle();
    b.units.length = 0; // both gone in one snapshot
    for (const listener of b.listeners) listener();
    await settle();
    expect(b.stored.value).toBeUndefined();
  });

  it('decides nothing for units the Azeron app made the service let go', async () => {
    const b = await bench();
    b.helm.start();
    b.helm.azeronChanged(AZERON_CLOSED);
    b.plug('a', LEFT);
    b.plug('b', RIGHT);
    await settle();
    b.helm.azeronChanged(AZERON_OPEN);
    b.unplug('a');
    b.unplug('b');
    await settle();
    expect(b.stored.value).toBeUndefined();
    expect(b.helm.state().writeBlock).toBe(BLOCK);
  });

  it('decides nothing before the first look at the running programs', async () => {
    const b = await bench();
    b.helm.start();
    b.plug('a', LEFT);
    b.plug('b', RIGHT);
    await settle();
    b.unplug('b');
    await settle();
    expect(b.stored.value).toBeUndefined();
  });

  it('asks outright about a unit that is on its own', async () => {
    const b = await bench();
    b.helm.start();
    b.helm.azeronChanged(AZERON_CLOSED);
    b.plug('a', LEFT);
    await settle();
    expect(b.helm.state().question).toEqual({
      kind: 'choose',
      unitId: LEFT,
      prompt: 'Is this your left or right Azeron?',
    });
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
