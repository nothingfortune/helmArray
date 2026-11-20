// The rudder pedals, an Xbox controller and a unit's other interfaces are on the HID bus the whole
// time. The app asks the bus for the units' ids and nothing else, opens only the units'
// configuration interfaces, and never sends anything that could be a GET_REPORT: that hung the
// pedals until they were replugged. All of it is read at the fake bus.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findUnits, openUnit } from '../../packages/app/src/main/hid-transport';
import { FakeHid, PEDALS, XBOX_PAD } from './support/fake-hid';
import { World } from './support/world';

describe('the pedals and other HID devices on the bus during a whole Apply', () => {
  let world: World;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    const scheme = await world.createKeysScheme();
    const { result } = await world.previewAndApply(scheme.id);
    // A full run of the app: both units found, read, written and read back.
    expect(result.ok).toBe(true);
    await world.runningSlotTick();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('the bus was asked for the units’ ids and no others', () => {
    expect([...new Set(world.hid.enumerated())]).toEqual(['16d0:12f7']);
  });

  it('only the two configuration interfaces were ever opened', () => {
    expect([...new Set(world.hid.opened())].sort()).toEqual(
      [world.left.path, world.right.path].sort(),
    );
  });

  it('the pedals were never opened, written, read or closed', () => {
    expect(world.pedals.touched).toEqual([]);
  });

  it('the Xbox controller was never opened, written, read or closed', () => {
    expect(world.xboxPad.touched).toEqual([]);
  });

  it('no GET_REPORT, and no feature report of any kind, reached any device', () => {
    expect(world.hid.forbidden()).toEqual([]);
  });

  it('every write to a unit was one whole frame behind report id 0', () => {
    const sizes = world.hid.events.flatMap((event) => (event.op === 'write' ? [event.bytes] : []));
    expect([sizes.length > 0, [...new Set(sizes)]]).toEqual([true, [65]]);
  });
});

// The fake bus has to be able to see what the tests above say it did not see: a bus that records
// nothing would pass them all.
describe('the fake bus notices what the tests above are about', () => {
  const bus = () => {
    const hid = new FakeHid();
    const unit = hid.plugUnit({ serial: 'x', deviceId: 1 });
    const pedals = hid.plugBystander('The rudder pedals', PEDALS.vendorId, PEDALS.productId, 1);
    const pad = hid.plugBystander('The Xbox controller', XBOX_PAD.vendorId, XBOX_PAD.productId, 1);
    return { hid, unit, pedals, pad };
  };

  it('lists the pedals and the controller when asked for them', async () => {
    const { hid, pedals, pad } = bus();
    expect([
      await hid.enumerate(PEDALS.vendorId, PEDALS.productId),
      await hid.enumerate(XBOX_PAD.vendorId, XBOX_PAD.productId),
    ]).toEqual([[pedals.info], [pad.info]]);
  });

  it('records an unfiltered listing, which would hand the app the pedals', async () => {
    const { hid } = bus();
    await hid.enumerate(0, 0);
    expect(hid.enumerated()).toEqual(['0000:0000']);
  });

  it('records a GET_REPORT on a unit, and refuses it', async () => {
    const { hid, unit } = bus();
    const device = await hid.open(unit.path);
    await expect(device.getFeatureReport(0, 64)).rejects.toThrow(
      'A GET_REPORT must never be sent.',
    );
    expect(hid.forbidden()).toEqual([{ op: 'GET_REPORT', path: unit.path }]);
  });

  it('records the pedals being opened and written to', async () => {
    const { hid, pedals } = bus();
    const device = await hid.open(pedals.info.path ?? '');
    await expect(device.write(new Uint8Array(65))).rejects.toThrow('must never be talked to');
    expect([hid.opened(), pedals.touched]).toEqual([[pedals.info.path], ['open', 'write']]);
  });

  it('the transport refuses to open the pedals, so the app never gets that far', async () => {
    const { hid, pedals } = bus();
    await expect(openUnit(hid, pedals.info.path ?? '')).rejects.toThrow(
      'That is not an Azeron unit’s configuration interface.',
    );
    expect(hid.opened()).toEqual([]);
  });

  it('the transport refuses a unit’s other interfaces', async () => {
    const { hid, unit } = bus();
    await expect(openUnit(hid, unit.otherPaths[0] ?? '')).rejects.toThrow(
      'That is not an Azeron unit’s configuration interface.',
    );
    expect(hid.opened()).toEqual([]);
  });

  it('the transport finds a unit by its configuration interface alone', async () => {
    const { hid, unit } = bus();
    expect(await findUnits(hid)).toEqual([{ path: unit.path }]);
  });
});
