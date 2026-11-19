import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnitIdentity } from '@helmarray/azeron';
import { Command, FakeUnit } from '@helmarray/azeron';
import type { ClosableTransport, DevicesSnapshot } from './devices';
import { Devices, POLL_MS } from './devices';

const LEFT = 49229;
const RIGHT = 29993;

/** The units "plugged in": a path each, and the fake unit behind it. */
class Bench {
  plugged = new Map<string, FakeUnit>();
  opened: string[] = [];
  closed: string[] = [];
  listed = 0;
  traces: string[] = [];
  /** Held by a test to make the next listing or first report slow. */
  listing: Promise<void> | null = null;
  firstReply: Promise<void> | null = null;
  listingError: Error | null = null;

  plug(path: string, unit: FakeUnit) {
    this.plugged.set(path, unit);
  }
  unplug(path: string) {
    this.plugged.delete(path);
  }

  findUnits = async () => {
    this.listed++;
    await this.listing;
    if (this.listingError) throw this.listingError;
    return [...this.plugged.keys()].map((path) => ({ path }));
  };

  openUnit = async (path: string): Promise<ClosableTransport> => {
    this.opened.push(path);
    const unit = this.plugged.get(path);
    if (!unit) throw new Error('nothing there');
    return {
      send: async (report) => {
        await this.firstReply;
        await unit.send(report);
      },
      receive: () => unit.receive(),
      close: async () => void this.closed.push(path),
    };
  };

  devices(extra: { trace?: boolean } = {}) {
    return new Devices({
      findUnits: () => this.findUnits(),
      openUnit: (path) => this.openUnit(path),
      ...(extra.trace && {
        trace: (path: string, line: string) => this.traces.push(`${path} ${line}`),
      }),
    });
  }
}

/** Lets the pending work (a poll, a unit being identified) run to its end. */
const settle = () => vi.advanceTimersByTimeAsync(0);
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
};
const byPath = (snapshot: DevicesSnapshot, path: string) =>
  snapshot.units.find((u) => u.path === path);

describe('the devices service', () => {
  let bench: Bench;
  let devices: Devices;

  beforeEach(() => {
    vi.useFakeTimers();
    bench = new Bench();
    devices = bench.devices();
  });
  afterEach(async () => {
    await devices.stop();
    vi.useRealTimers();
  });

  it('lists nothing before it starts, and polls at once when it does', async () => {
    expect(devices.snapshot()).toEqual({ units: [] });
    expect(bench.listed).toBe(0);
    devices.start();
    await settle();
    expect(bench.listed).toBe(1);
  });

  it('connects two units: each ready with its id and the slots it holds', async () => {
    bench.plug('left-path', new FakeUnit({ deviceId: LEFT, slots: { 0: { name: 'Default' } } }));
    bench.plug(
      'right-path',
      new FakeUnit({ deviceId: RIGHT, slots: { 0: { name: 'Flight' }, 1: { name: 'Combat' } } }),
    );
    devices.start();
    await settle();

    const { units } = devices.snapshot();
    expect(units.map((u) => [u.path, u.state])).toEqual([
      ['left-path', 'ready'],
      ['right-path', 'ready'],
    ]);
    expect(units[0]?.identity).toEqual<UnitIdentity>({
      firmware: 112,
      deviceId: LEFT,
      slotLimit: 6,
      runningSlot: 0,
    });
    expect(units[1]?.identity?.deviceId).toBe(RIGHT);
    expect(units[0]?.slots?.map((s) => s.name)).toEqual(['Default']);
    expect(units[1]?.slots?.map((s) => s.name)).toEqual(['Flight', 'Combat']);
    expect(units[0]?.error).toBeUndefined();
    expect(bench.opened).toEqual(['left-path', 'right-path']);
  });

  it('hands out the session of a ready unit by its id, and none for an unknown one', async () => {
    bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
    devices.start();
    await settle();
    const session = devices.session(LEFT);
    expect(session).toBeDefined();
    expect(await session?.runningSlot()).toBe(0);
    expect(devices.session(RIGHT)).toBeUndefined();
  });

  it('keeps no unit open twice, however many polls pass', async () => {
    bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
    devices.start();
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(bench.listed).toBeGreaterThanOrEqual(5);
    expect(bench.opened).toEqual(['left-path']);
  });

  it('emits a snapshot when a unit appears, is identified and is read', async () => {
    const seen: DevicesSnapshot[] = [];
    devices.onChange((s) => seen.push(s));
    bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
    devices.start();
    await settle();
    expect(seen.map((s) => s.units.map((u) => u.state))).toEqual([
      ['connecting'],
      ['connecting'], // its identity is known
      ['ready'],
    ]);
    expect(seen[1]?.units[0]?.identity?.deviceId).toBe(LEFT);
    expect(seen[0]?.units[0]?.identity).toBeUndefined();
  });

  it('gives snapshots that are plain data: they survive a structured clone, as IPC sends them', async () => {
    bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
    let last: DevicesSnapshot | undefined;
    devices.onChange((s) => (last = s));
    devices.start();
    await settle();
    expect(structuredClone(last)).toEqual(last);
    // A change to a snapshot never reaches the service.
    last?.units[0]?.slots?.splice(0);
    expect(devices.snapshot().units[0]?.slots?.length).toBe(1);
  });

  it('stops telling a listener who has unsubscribed', async () => {
    const listener = vi.fn();
    const off = devices.onChange(listener);
    off();
    bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
    devices.start();
    await settle();
    expect(listener).not.toHaveBeenCalled();
  });

  it('survives a listener that throws', async () => {
    devices = bench.devices({ trace: true });
    devices.onChange(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    devices.onChange(good);
    bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
    devices.start();
    await settle();
    expect(good).toHaveBeenCalled();
    expect(devices.snapshot().units[0]?.state).toBe('ready');
    expect(bench.traces.some((t) => t.includes('a listener threw: boom'))).toBe(true);
  });

  describe('unplugging', () => {
    it('drops the unit and closes it on the next poll, within a second', async () => {
      bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
      bench.plug('right-path', new FakeUnit({ deviceId: RIGHT }));
      devices.start();
      await settle();
      const seen: DevicesSnapshot[] = [];
      devices.onChange((s) => seen.push(s));

      bench.unplug('right-path');
      await vi.advanceTimersByTimeAsync(POLL_MS);

      expect(devices.snapshot().units.map((u) => u.path)).toEqual(['left-path']);
      expect(bench.closed).toEqual(['right-path']);
      expect(devices.session(RIGHT)).toBeUndefined();
      expect(seen.at(-1)?.units.map((u) => u.path)).toEqual(['left-path']);
      expect(POLL_MS).toBeLessThanOrEqual(1000);
    });

    it('leaves the other unit alone', async () => {
      bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
      bench.plug('right-path', new FakeUnit({ deviceId: RIGHT }));
      devices.start();
      await settle();
      bench.unplug('left-path');
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
      expect(bench.opened).toEqual(['left-path', 'right-path']);
      expect(devices.snapshot().units[0]).toMatchObject({ path: 'right-path', state: 'ready' });
      expect(devices.session(RIGHT)).toBeDefined();
    });

    it('identifies a unit afresh when it is plugged back in, at the same path or another', async () => {
      bench.plug('left-path', new FakeUnit({ deviceId: LEFT, slots: { 0: { name: 'Before' } } }));
      devices.start();
      await settle();
      expect(devices.snapshot().units[0]?.slots?.[0]?.name).toBe('Before');

      bench.unplug('left-path');
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(devices.snapshot().units).toEqual([]);

      bench.plug('left-path', new FakeUnit({ deviceId: LEFT, slots: { 0: { name: 'After' } } }));
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(devices.snapshot().units[0]?.slots?.[0]?.name).toBe('After');
      expect(bench.opened).toEqual(['left-path', 'left-path']);
      expect(bench.closed).toEqual(['left-path']);

      bench.unplug('left-path');
      bench.plug('usb-2', new FakeUnit({ deviceId: LEFT }));
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(devices.snapshot().units.map((u) => [u.path, u.state])).toEqual([['usb-2', 'ready']]);
      expect(bench.opened).toEqual(['left-path', 'left-path', 'usb-2']);
    });

    it('closes a unit unplugged while it is still being identified, and lists it no more', async () => {
      const gate = deferred();
      bench.firstReply = gate.promise;
      bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
      devices.start();
      await settle();
      expect(devices.snapshot().units[0]?.state).toBe('connecting');

      bench.unplug('left-path');
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(devices.snapshot().units).toEqual([]);
      expect(bench.closed).toEqual(['left-path']);

      gate.release();
      await settle();
      expect(devices.snapshot().units).toEqual([]);
      expect(bench.closed).toEqual(['left-path']);
    });

    it('closes a transport that finishes opening after its unit was unplugged', async () => {
      const gate = deferred();
      const opened: string[] = [];
      const closed: string[] = [];
      let present = true;
      devices = new Devices({
        findUnits: async () => (present ? [{ path: 'slow' }] : []),
        openUnit: async (path) => {
          opened.push(path);
          await gate.promise;
          return {
            send: async () => undefined,
            receive: async () => null,
            close: async () => void closed.push(path),
          };
        },
      });
      devices.start();
      await settle();
      present = false;
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(devices.snapshot().units).toEqual([]);
      gate.release();
      await settle();
      expect(closed).toEqual(['slow']);
      expect(devices.snapshot().units).toEqual([]);
    });
  });

  describe('a unit that cannot be used', () => {
    it('is listed as failed with the reason, closed, and stays so until it is unplugged', async () => {
      bench.plug('old', new FakeUnit({ deviceId: LEFT, firmware: 113 }));
      bench.plug('good', new FakeUnit({ deviceId: RIGHT }));
      devices.start();
      await settle();

      const failed = byPath(devices.snapshot(), 'old');
      expect(failed?.state).toBe('failed');
      expect(failed?.error).toBe('This unit runs firmware 113; helmArray knows 111 and 112.');
      expect(failed?.slots).toBeUndefined();
      expect(bench.closed).toEqual(['old']);
      expect(devices.session(LEFT)).toBeUndefined();
      expect(byPath(devices.snapshot(), 'good')?.state).toBe('ready');

      // Not tried again while it stays plugged in.
      await vi.advanceTimersByTimeAsync(POLL_MS * 4);
      expect(bench.opened).toEqual(['old', 'good']);
      expect(byPath(devices.snapshot(), 'old')?.state).toBe('failed');

      bench.unplug('old');
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(byPath(devices.snapshot(), 'old')).toBeUndefined();
      expect(bench.closed).toEqual(['old']); // closed once, not again
    });

    it('is failed too when the keypad is not a Cyborg II', async () => {
      bench.plug('other', new FakeUnit({ keypadType: 7 }));
      devices.start();
      await settle();
      expect(devices.snapshot().units[0]).toMatchObject({
        state: 'failed',
        error: 'This keypad is not a Cyborg II.',
      });
    });

    it('is failed, with the unit session’s message, when the unit never answers', async () => {
      bench.plug('mute', new FakeUnit({ silentOn: [Command.FIRMWARE_VERSION] }));
      devices.start();
      await settle();
      expect(devices.snapshot().units[0]).toMatchObject({
        state: 'failed',
        error: 'The unit didn’t answer FIRMWARE_VERSION.',
      });
      expect(bench.closed).toEqual(['mute']);
    });

    it('fails when the slots cannot be read, keeping the identity it got', async () => {
      bench.plug('half', new FakeUnit({ deviceId: LEFT, silentOn: [Command.PROFILE_PAYLOAD_V2] }));
      devices.start();
      await settle();
      const [unit] = devices.snapshot().units;
      expect(unit).toMatchObject({
        state: 'failed',
        error: 'The unit didn’t answer PROFILE_PAYLOAD_V2.',
      });
      expect(unit?.identity?.deviceId).toBe(LEFT);
      expect(unit?.slots).toBeUndefined();
      expect(devices.session(LEFT)).toBeUndefined();
      expect(bench.closed).toEqual(['half']);
    });

    it('is failed, with a plain message, when it cannot be opened', async () => {
      bench.plug('busy', new FakeUnit({ deviceId: LEFT }));
      bench.openUnit = async () => {
        throw new Error('the Azeron app has it');
      };
      devices.start();
      await settle();
      expect(devices.snapshot().units[0]).toMatchObject({
        state: 'failed',
        error: 'The unit couldn’t be opened: the Azeron app has it',
      });
      expect(bench.closed).toEqual([]);
    });
  });

  describe('polling', () => {
    it('goes on after findUnits throws, and traces it', async () => {
      devices = bench.devices({ trace: true });
      bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
      bench.listingError = new Error('hid enumerate failed');
      devices.start();
      await settle();
      expect(devices.snapshot().units).toEqual([]);
      expect(bench.traces).toContain('(devices) listing the units failed: hid enumerate failed');

      bench.listingError = null;
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(devices.snapshot().units[0]?.state).toBe('ready');
    });

    it('keeps the units it has when one listing fails', async () => {
      bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
      devices.start();
      await settle();
      bench.listingError = new Error('hid enumerate failed');
      await vi.advanceTimersByTimeAsync(POLL_MS * 2);
      expect(devices.snapshot().units[0]?.state).toBe('ready');
      expect(bench.closed).toEqual([]);
    });

    it('never starts a poll while the last is still listing', async () => {
      const gate = deferred();
      bench.listing = gate.promise;
      devices.start();
      await vi.advanceTimersByTimeAsync(POLL_MS * 5);
      expect(bench.listed).toBe(1);

      bench.listing = null;
      gate.release();
      await settle();
      expect(bench.listed).toBe(1);
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(bench.listed).toBe(2);
    });

    it('keeps polling while a unit is slow to identify, without opening it twice', async () => {
      const gate = deferred();
      bench.firstReply = gate.promise;
      bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
      bench.plug('right-path', new FakeUnit({ deviceId: RIGHT }));
      devices.start();
      await vi.advanceTimersByTimeAsync(POLL_MS * 4);
      expect(bench.listed).toBeGreaterThanOrEqual(4);
      expect(bench.opened).toEqual(['left-path', 'right-path']);
      expect(devices.snapshot().units.map((u) => u.state)).toEqual(['connecting', 'connecting']);

      gate.release();
      await settle();
      expect(devices.snapshot().units.map((u) => u.state)).toEqual(['ready', 'ready']);
      expect(bench.opened).toEqual(['left-path', 'right-path']);
    });

    it('does not start twice', async () => {
      devices.start();
      devices.start();
      await vi.advanceTimersByTimeAsync(POLL_MS * 2);
      expect(bench.listed).toBe(3);
    });
  });

  describe('stopping', () => {
    it('stops polling and closes every unit, failed ones once', async () => {
      bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
      bench.plug('right-path', new FakeUnit({ deviceId: RIGHT }));
      bench.plug('old', new FakeUnit({ firmware: 99 }));
      devices.start();
      await settle();
      const seen: DevicesSnapshot[] = [];
      devices.onChange((s) => seen.push(s));

      await devices.stop();
      expect([...bench.closed].sort()).toEqual(['left-path', 'old', 'right-path']);
      expect(devices.snapshot().units).toEqual([]);
      expect(seen.at(-1)).toEqual({ units: [] });

      const listed = bench.listed;
      await vi.advanceTimersByTimeAsync(POLL_MS * 5);
      expect(bench.listed).toBe(listed);
    });

    it('ignores a listing that comes back after it stopped', async () => {
      const gate = deferred();
      bench.listing = gate.promise;
      bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
      devices.start();
      await settle();
      await devices.stop();
      gate.release();
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
      expect(bench.opened).toEqual([]);
      expect(devices.snapshot().units).toEqual([]);
    });

    it('closes a unit that was still being identified', async () => {
      const gate = deferred();
      bench.firstReply = gate.promise;
      bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
      devices.start();
      await settle();
      await devices.stop();
      expect(bench.closed).toEqual(['left-path']);
      gate.release();
      await settle();
      expect(bench.closed).toEqual(['left-path']);
      expect(devices.snapshot().units).toEqual([]);
    });

    it('can be started again, and identifies afresh', async () => {
      bench.plug('left-path', new FakeUnit({ deviceId: LEFT }));
      devices.start();
      await settle();
      await devices.stop();
      devices.start();
      await settle();
      expect(devices.snapshot().units[0]?.state).toBe('ready');
      expect(bench.opened).toEqual(['left-path', 'left-path']);
    });
  });
});
