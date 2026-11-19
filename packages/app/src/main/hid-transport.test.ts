import { FakeUnit, UnitSession, hostReports } from '@helmarray/azeron';
import { describe, expect, it } from 'vitest';
import type { HidBackend, HidDevice, HidDeviceInfo } from './hid-transport';
import {
  UNIT_INTERFACE,
  UNIT_PRODUCT_ID,
  UNIT_USAGE_PAGE,
  UNIT_VENDOR_ID,
  findUnits,
  openUnit,
} from './hid-transport';

const unitInterface = (path: string, over: Partial<HidDeviceInfo> = {}): HidDeviceInfo => ({
  vendorId: UNIT_VENDOR_ID,
  productId: UNIT_PRODUCT_ID,
  usagePage: UNIT_USAGE_PAGE,
  interface: UNIT_INTERFACE,
  path,
  ...over,
});

const LEFT = '\\\\?\\hid#vid_16d0&pid_12f7&mi_04#left';
const RIGHT = '\\\\?\\hid#vid_16d0&pid_12f7&mi_04#right';
const KEYBOARD_INTERFACE = '\\\\?\\hid#vid_16d0&pid_12f7&mi_00#left';
const PEDALS = '\\\\?\\hid#vid_06a3&pid_0763#pedals';

/** Everything a Windows enumeration would list: two units, their other interfaces, the pedals. */
const everything: HidDeviceInfo[] = [
  unitInterface(KEYBOARD_INTERFACE, { usagePage: 0x01, interface: 0 }),
  unitInterface(LEFT),
  unitInterface(RIGHT),
  unitInterface('\\\\?\\hid#vid_16d0&pid_12f7&mi_01#left', { usagePage: 0x0c, interface: 1 }),
  { vendorId: 0x06a3, productId: 0x0763, usagePage: 0x01, interface: 0, path: PEDALS },
];

/** A fake node-hid: hidapi's filter, a device list, and a log of everything done to it. */
class FakeBackend implements HidBackend {
  readonly enumerated: [number, number][] = [];
  readonly opened: string[] = [];
  readonly devices = new Map<string, HidDevice>();

  constructor(private readonly list: HidDeviceInfo[] = everything) {}

  async enumerate(vendorId: number, productId: number) {
    this.enumerated.push([vendorId, productId]);
    // As hidapi does: a filter that doesn't match lists nothing; no filter lists everything.
    return this.list.filter((d) => d.vendorId === vendorId && d.productId === productId);
  }

  async open(path: string) {
    this.opened.push(path);
    const device = this.devices.get(path);
    if (!device) throw new Error(`nothing at ${path}`);
    return device;
  }
}

/** An open device that records its writes and plays back the reports it is given. */
class ScriptedDevice implements HidDevice {
  readonly written: Uint8Array[] = [];
  readonly reads: number[] = [];
  closed = 0;
  constructor(private readonly incoming: (Uint8Array | undefined)[] = []) {}
  async write(data: Uint8Array) {
    this.written.push(data);
  }
  async read(timeoutMs: number) {
    this.reads.push(timeoutMs);
    return this.incoming.shift();
  }
  async close() {
    this.closed++;
  }
}

const withDevice = (device: HidDevice, path = LEFT) => {
  const backend = new FakeBackend();
  backend.devices.set(path, device);
  return backend;
};

describe('finding units', () => {
  it('enumerates with the unit’s vendor and product id, never unfiltered', async () => {
    const backend = new FakeBackend();
    await findUnits(backend);
    expect(backend.enumerated).toEqual([[0x16d0, 0x12f7]]);
  });

  it('returns only the configuration interface of each unit', async () => {
    expect(await findUnits(new FakeBackend())).toEqual([{ path: LEFT }, { path: RIGHT }]);
  });

  it('leaves out the pedals, the units’ other interfaces and anything without a path', async () => {
    const backend = new FakeBackend([
      ...everything.filter((d) => d.path !== LEFT && d.path !== RIGHT),
      unitInterface('', {}),
      unitInterface('x', { path: undefined }),
      unitInterface('wrong page', { usagePage: 0x01 }),
      unitInterface('wrong interface', { interface: 3 }),
    ]);
    expect(await findUnits(backend)).toEqual([]);
  });

  it('finds nothing when no unit is plugged in', async () => {
    const pedalsOnly = new FakeBackend(everything.filter((d) => d.vendorId === 0x06a3));
    expect(await findUnits(pedalsOnly)).toEqual([]);
  });
});

describe('opening a unit', () => {
  it('opens a path findUnits returned', async () => {
    const backend = withDevice(new ScriptedDevice());
    await openUnit(backend, LEFT);
    expect(backend.opened).toEqual([LEFT]);
  });

  it.each([
    ['the pedals', PEDALS],
    ['a unit’s other interface', KEYBOARD_INTERFACE],
    ['a path nobody listed', '\\\\?\\hid#vid_dead&pid_beef#x'],
    ['an empty path', ''],
  ])('refuses %s, and opens nothing', async (_name, path) => {
    const backend = new FakeBackend();
    backend.devices.set(path, new ScriptedDevice());
    await expect(openUnit(backend, path)).rejects.toThrow(/not an Azeron unit/);
    expect(backend.opened).toEqual([]);
  });

  it('refuses a unit that was unplugged since it was found', async () => {
    const backend = new FakeBackend([]);
    backend.devices.set(LEFT, new ScriptedDevice());
    await expect(openUnit(backend, LEFT)).rejects.toThrow();
    expect(backend.opened).toEqual([]);
  });

  it('checks the path against a filtered enumeration too', async () => {
    const backend = withDevice(new ScriptedDevice());
    await openUnit(backend, LEFT);
    expect(backend.enumerated).toEqual([[0x16d0, 0x12f7]]);
  });
});

describe('the transport', () => {
  const report = (...head: number[]) => {
    const r = new Uint8Array(64);
    r.set(head);
    return r;
  };

  it('sends a report as it is, report id 0 first', async () => {
    const device = new ScriptedDevice();
    const unit = await openUnit(withDevice(device), LEFT);
    const frame = hostReports('FIRMWARE_VERSION', 7, new Uint8Array())[0] as Uint8Array;
    await unit.send(frame);
    expect(device.written).toHaveLength(1);
    expect(Array.from(device.written[0] as Uint8Array)).toEqual(Array.from(frame));
    expect(device.written[0]?.[0]).toBe(0);
  });

  it('refuses to send anything that is not a 64-byte report', async () => {
    const device = new ScriptedDevice();
    const unit = await openUnit(withDevice(device), LEFT);
    await expect(unit.send(new Uint8Array(65))).rejects.toThrow(/64 bytes/);
    await expect(unit.send(new Uint8Array(0))).rejects.toThrow(/64 bytes/);
    expect(device.written).toEqual([]);
  });

  it('receives the next report as a Uint8Array, asking the device for the timeout given', async () => {
    const device = new ScriptedDevice([report(1, 2, 3)]);
    const unit = await openUnit(withDevice(device), LEFT);
    const got = await unit.receive(250);
    expect(got).toBeInstanceOf(Uint8Array);
    expect(Array.from(got ?? []).slice(0, 4)).toEqual([1, 2, 3, 0]);
    expect(got).toHaveLength(64);
    expect(device.reads).toEqual([250]);
  });

  it('gives null when nothing comes in time, whether the device says undefined or empty', async () => {
    const device = new ScriptedDevice([undefined, new Uint8Array(0)]);
    const unit = await openUnit(withDevice(device), LEFT);
    expect(await unit.receive(10)).toBeNull();
    expect(await unit.receive(10)).toBeNull();
  });

  it('never asks the device to wait without limit', async () => {
    const device = new ScriptedDevice([undefined, undefined]);
    const unit = await openUnit(withDevice(device), LEFT);
    await unit.receive(-1);
    await unit.receive(12.7);
    expect(device.reads).toEqual([0, 12]);
  });

  it('closes the device once, and does nothing more afterwards', async () => {
    const device = new ScriptedDevice();
    const unit = await openUnit(withDevice(device), LEFT);
    await unit.close();
    await unit.close();
    expect(device.closed).toBe(1);
    await expect(unit.send(report())).rejects.toThrow(/closed/);
    await expect(unit.receive(10)).rejects.toThrow(/closed/);
    expect(device.written).toEqual([]);
    expect(device.reads).toEqual([]);
  });

  it('passes a failed write on to the caller', async () => {
    const device = new ScriptedDevice();
    device.write = () => Promise.reject(new Error('unplugged'));
    const unit = await openUnit(withDevice(device), LEFT);
    await expect(unit.send(report())).rejects.toThrow('unplugged');
  });
});

describe('a session over the transport', () => {
  it('identifies a unit that answers as a Cyborg II does', async () => {
    const fake = new FakeUnit({ deviceId: 49229 });
    const device: HidDevice = {
      write: (data) => fake.send(data),
      read: async () => (await fake.receive()) ?? undefined,
      close: async () => undefined,
    };
    const [unit] = await findUnits(withDevice(device));
    const transport = await openUnit(withDevice(device), unit?.path ?? '');
    const identity = await new UnitSession(transport).identify();
    expect(identity).toMatchObject({ firmware: 112, deviceId: 49229, slotLimit: 6 });
    expect(fake.received.length).toBeGreaterThan(0);
    await transport.close();
  });
});
