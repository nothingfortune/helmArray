// The devices service while something else is writing to the units: it must not list, open,
// close or read any of them, and must catch up when the hold ends.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeUnit } from '@helmarray/azeron';
import type { ClosableTransport } from './devices';
import { Devices, POLL_MS } from './devices';

const LEFT = 49229;
const RIGHT = 29993;

class Bench {
  plugged = new Map<string, FakeUnit>();
  opened: string[] = [];
  closed: string[] = [];
  listed = 0;
  /** Reports that went to any unit, to see that nothing is sent during a hold. */
  reports = 0;
  listing: Promise<void> | null = null;
  failSends = false;

  findUnits = async () => {
    this.listed++;
    await this.listing;
    return [...this.plugged.keys()].map((path) => ({ path }));
  };
  openUnit = async (path: string): Promise<ClosableTransport> => {
    this.opened.push(path);
    const unit = this.plugged.get(path);
    if (!unit) throw new Error('nothing there');
    return {
      send: async (report) => {
        if (this.failSends) throw new Error('the unit went quiet');
        this.reports++;
        await unit.send(report);
      },
      receive: () => unit.receive(),
      close: async () => void this.closed.push(path),
    };
  };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
};

describe('the devices service held by a job', () => {
  let bench: Bench;
  let devices: Devices;
  let clock: number;

  beforeEach(() => {
    vi.useFakeTimers();
    bench = new Bench();
    clock = 1000;
    devices = new Devices({
      findUnits: () => bench.findUnits(),
      openUnit: (path) => bench.openUnit(path),
      now: () => clock,
    });
    bench.plugged.set('left-path', new FakeUnit({ deviceId: LEFT }));
    bench.plugged.set('right-path', new FakeUnit({ deviceId: RIGHT }));
  });
  afterEach(async () => {
    await devices.stop();
    vi.useRealTimers();
  });

  async function connected() {
    devices.start();
    await settle();
    expect(devices.snapshot().units.map((u) => u.state)).toEqual(['ready', 'ready']);
  }

  it('does not list, open, close or send a report while held, whatever changes on the bus', async () => {
    await connected();
    const hold = deferred();
    const job = devices.exclusive(() => hold.promise);
    const listed = bench.listed;
    const reports = bench.reports;
    // A unit appears and one goes, as a replug would show.
    bench.plugged.delete('right-path');
    bench.plugged.set('third-path', new FakeUnit({ deviceId: 1234 }));
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);

    expect(bench.listed).toBe(listed);
    expect(bench.opened).toEqual(['left-path', 'right-path']);
    expect(bench.closed).toEqual([]);
    expect(bench.reports).toBe(reports);
    expect(devices.snapshot().units.map((u) => u.path)).toEqual(['left-path', 'right-path']);

    hold.release();
    await job;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    // The poll that was held off now runs: the new unit is opened, the missing one closed.
    expect(bench.listed).toBeGreaterThan(listed);
    expect(bench.opened).toEqual(['left-path', 'right-path', 'third-path']);
    expect(bench.closed).toEqual(['right-path']);
  });

  it('drops a listing that was out when the hold began, opening and closing nothing', async () => {
    await connected();
    const slow = deferred();
    bench.listing = slow.promise;
    await vi.advanceTimersByTimeAsync(POLL_MS); // a poll starts and waits on the listing
    bench.plugged.delete('right-path');
    bench.plugged.set('third-path', new FakeUnit({ deviceId: 1234 }));
    const hold = deferred();
    const job = devices.exclusive(() => hold.promise);
    bench.listing = null;
    slow.release();
    await settle();
    expect(bench.opened).toEqual(['left-path', 'right-path']);
    expect(bench.closed).toEqual([]);
    hold.release();
    await job;
  });

  it('makes stop wait for the hold, then let the units go', async () => {
    await connected();
    const hold = deferred();
    const job = devices.exclusive(() => hold.promise);
    let stopped = false;
    const stopping = devices.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(stopped).toBe(false);
    expect(bench.closed).toEqual([]);
    hold.release();
    await job;
    await stopping;
    expect(bench.closed.sort()).toEqual(['left-path', 'right-path']);
  });

  it('lets go of the hold when the job throws, and runs jobs one at a time in order', async () => {
    await connected();
    const order: string[] = [];
    const first = devices.exclusive(async () => {
      order.push('first starts');
      await Promise.resolve();
      throw new Error('boom');
    });
    const second = devices.exclusive(async () => {
      order.push('second');
    });
    await expect(first).rejects.toThrow('boom');
    await second;
    expect(order).toEqual(['first starts', 'second']);
    const listed = bench.listed;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(bench.listed).toBeGreaterThan(listed); // polling is back
  });

  describe('reading the units again', () => {
    it('re-reads the slots and the slot each unit runs, and tells the listeners once', async () => {
      await connected();
      const left = bench.plugged.get('left-path');
      left?.slots.set(3, { name: 'New', records: new Map() });
      if (left) left.running = 3;
      const seen: number[] = [];
      devices.onChange((s) => seen.push(s.units.length));
      await devices.refresh();
      const unit = devices.snapshot().units[0];
      expect(unit?.slots?.map((s) => s.slot)).toEqual([0, 3]);
      expect(unit?.identity?.runningSlot).toBe(3);
      expect(seen).toHaveLength(1);
    });

    it('skips a unit read within the age asked for, and reads one that is older', async () => {
      await connected();
      const reports = bench.reports;
      clock += 1000;
      await devices.refresh({ olderThanMs: 3000 });
      expect(bench.reports).toBe(reports);
      clock += 3000;
      await devices.refresh({ olderThanMs: 3000 });
      expect(bench.reports).toBeGreaterThan(reports);
    });

    it('marks a unit that can no longer be read as failed, not ready, and lets it go', async () => {
      await connected();
      bench.failSends = true;
      await devices.refresh();
      const units = devices.snapshot().units;
      expect(units.map((u) => u.state)).toEqual(['failed', 'failed']);
      expect(units[0]?.slots).toBeUndefined();
      expect(devices.session(LEFT)).toBeUndefined();
      expect(bench.closed.sort()).toEqual(['left-path', 'right-path']);
    });
  });
});
