// A backend that does not filter by vendor and product ids, as a faulty one might: the pedals
// (VID 0x06A3) must still never be listed or opened. Found by mutation testing: the ids were
// only ever checked by the fake backend's own filter, never by hid-transport itself.
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

const unit = (path: string, over: Partial<HidDeviceInfo> = {}): HidDeviceInfo => ({
  vendorId: UNIT_VENDOR_ID,
  productId: UNIT_PRODUCT_ID,
  usagePage: UNIT_USAGE_PAGE,
  interface: UNIT_INTERFACE,
  path,
  ...over,
});
const GOOD = 'good';
const listed: HidDeviceInfo[] = [
  unit(GOOD),
  unit('other-vendor', { vendorId: 0x06a3 }),
  unit('other-product', { productId: 0x0763 }),
  unit('other-page', { usagePage: 0x01 }),
  unit('other-interface', { interface: 0 }),
  { ...unit('no-path'), path: undefined },
];

const careless = (opened: string[] = []): HidBackend => ({
  enumerate: async () => listed,
  open: async (path): Promise<HidDevice> => {
    opened.push(path);
    return {
      write: async () => undefined,
      read: async () => undefined,
      close: async () => undefined,
    };
  },
});

describe('a backend that lists more than it was asked for', () => {
  it('gives back only the one interface that is a unit’s configuration interface', async () => {
    expect(await findUnits(careless())).toEqual([{ path: GOOD }]);
  });

  it.each(listed.slice(1).map((d) => d.path ?? 'no-path'))('never opens %s', async (path) => {
    const opened: string[] = [];
    await expect(openUnit(careless(opened), path)).rejects.toThrow(
      'That is not an Azeron unit’s configuration interface.',
    );
    expect(opened).toEqual([]);
  });
});
