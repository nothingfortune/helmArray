// The Transport the M2 session talks over: the Cyborg II's configuration interface, through
// node-hid. Pure: the real node-hid sits behind `HidBackend` (hid-backend.ts), so tests run on
// a fake and nothing here imports electron.
//
// Two rules hold the hardware safe. Only the units' configuration interface can ever be found
// or opened, so the rudder pedals (VID 0x06A3) are never touched: a HID GET_REPORT hung them
// until they were replugged. And `HidBackend` has no way to send one, on any device.

import type { Transport } from '@helmarray/azeron';
import { REPORT_LENGTH } from '@helmarray/azeron';

/** The Cyborg II's USB ids. */
export const UNIT_VENDOR_ID = 0x16d0;
export const UNIT_PRODUCT_ID = 0x12f7;
/** The configuration interface: the vendor-defined collection, Windows' `MI_04`. */
export const UNIT_USAGE_PAGE = 0xff01;
export const UNIT_INTERFACE = 4;

/** What an enumeration says about one HID interface (the parts used here). */
export interface HidDeviceInfo {
  vendorId: number;
  productId: number;
  path?: string | undefined;
  usagePage?: number | undefined;
  interface?: number | undefined;
}

/** An open device. Writes and reads only: there is deliberately no feature or GET_REPORT call. */
export interface HidDevice {
  write(data: Uint8Array): Promise<void>;
  /** The next input report, or undefined (or empty) when none came within `timeoutMs`. */
  read(timeoutMs: number): Promise<Uint8Array | undefined>;
  close(): Promise<void>;
}

/** The small part of node-hid used. */
export interface HidBackend {
  /** Always called with a vendor and product id: hidapi reads strings only from matches. */
  enumerate(vendorId: number, productId: number): Promise<HidDeviceInfo[]>;
  open(path: string): Promise<HidDevice>;
}

export interface UnitTransport extends Transport {
  close(): Promise<void>;
}

/** The path of an interface that is a unit's configuration interface, else undefined. */
function unitPath(d: HidDeviceInfo): string | undefined {
  const isUnit =
    d.vendorId === UNIT_VENDOR_ID &&
    d.productId === UNIT_PRODUCT_ID &&
    d.usagePage === UNIT_USAGE_PAGE &&
    d.interface === UNIT_INTERFACE;
  return isUnit && d.path ? d.path : undefined;
}

/** The units' own paths. Never enumerates unfiltered: the pedals must get no more than a lookup. */
async function unitPaths(hid: HidBackend): Promise<string[]> {
  const all = await hid.enumerate(UNIT_VENDOR_ID, UNIT_PRODUCT_ID);
  return all.flatMap((d) => unitPath(d) ?? []);
}

/** The paths of the units' configuration interfaces, one per plugged-in unit. */
export async function findUnits(hid: HidBackend): Promise<{ path: string }[]> {
  return (await unitPaths(hid)).map((path) => ({ path }));
}

/** Opens a unit's configuration interface. Refuses any path `findUnits` would not return. */
export async function openUnit(hid: HidBackend, path: string): Promise<UnitTransport> {
  if (!(await unitPaths(hid)).includes(path)) {
    throw new Error('That is not an Azeron unit’s configuration interface.');
  }
  const device = await hid.open(path);
  let closed = false;
  const live = () => {
    if (closed) throw new Error('The unit’s connection is closed.');
  };
  return {
    async send(report) {
      live();
      if (report.length !== REPORT_LENGTH) {
        throw new Error(`A report is ${REPORT_LENGTH} bytes, not ${report.length}.`);
      }
      // The frame already starts with report id 0, which is what the device is written with.
      await device.write(report);
    },
    async receive(timeoutMs) {
      live();
      const data = await device.read(Math.max(0, Math.floor(timeoutMs)));
      return data && data.length > 0 ? Uint8Array.from(data) : null;
    },
    async close() {
      if (closed) return;
      closed = true;
      await device.close();
    },
  };
}
