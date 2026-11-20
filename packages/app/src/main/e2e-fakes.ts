// The fakes a test run (HELM_E2E=1, see e2e-seam.ts) is built on: two fake Azeron units behind a
// fake HID backend, a fake list of running programs, and a Steam read confined to a temp folder.
// Nothing here can reach a real device, program list, registry or game file. Pure of Electron.
//
// Loaded only by a test run, through a dynamic import, so a normal run never loads it.

import { FakeUnit, REPORT_LENGTH, decodeStoredRecord } from '@helmarray/azeron';
import type { Backends, E2eConfig } from './e2e-seam';
import { E2E_UNIT_IDS, isInside } from './e2e-seam';
import type { HidBackend, HidDevice, HidDeviceInfo } from './hid-transport';
import { UNIT_INTERFACE, UNIT_PRODUCT_ID, UNIT_USAGE_PAGE, UNIT_VENDOR_ID } from './hid-transport';
import type { SteamReaders } from './steam-library';
import { readFile, readdir, realpath } from 'node:fs/promises';

const LEFT_PATH = String.raw`\\?\hid#vid_16d0&pid_12f7&mi_04#e2e-left`;
const RIGHT_PATH = String.raw`\\?\hid#vid_16d0&pid_12f7&mi_04#e2e-right`;
/** A unit's other interface (its keyboard): listed, and never to be taken for the unit. */
const DECOY_PATH = String.raw`\\?\hid#vid_16d0&pid_12f7&mi_00#e2e-left`;

/** A fake node-hid over fake units: the same filter hidapi applies, the same writes as the real one. */
export class FakeHidBackend implements HidBackend {
  readonly opened: string[] = [];
  constructor(private readonly units: ReadonlyMap<string, FakeUnit>) {}

  async enumerate(vendorId: number, productId: number): Promise<HidDeviceInfo[]> {
    if (vendorId !== UNIT_VENDOR_ID || productId !== UNIT_PRODUCT_ID) return [];
    const unit = (path: string): HidDeviceInfo => ({
      vendorId,
      productId,
      path,
      usagePage: UNIT_USAGE_PAGE,
      interface: UNIT_INTERFACE,
    });
    return [
      { ...unit(DECOY_PATH), usagePage: 0x01, interface: 0 },
      ...[...this.units.keys()].map(unit),
    ];
  }

  async open(path: string): Promise<HidDevice> {
    const unit = this.units.get(path);
    if (!unit) throw new Error(`nothing at ${path}`);
    this.opened.push(path);
    return {
      async write(data) {
        // The real backend sends report id 0 ahead of the frame (hid-transport.ts); the unit
        // never sees it.
        if (data.length !== REPORT_LENGTH + 1 || data[0] !== 0) {
          throw new Error('A write is report id 0 and then a whole frame.');
        }
        await unit.send(data.slice(1));
      },
      async read() {
        return (await unit.receive()) ?? undefined;
      },
      close: () => Promise.resolve(),
    };
  }
}

export interface FakeUnitView {
  hand: 'left' | 'right';
  deviceId: number;
  running: number;
  slots: {
    slot: number;
    name: string;
    inputs: number;
    /** The buttons whose tap sends something, by input id: the unit's own codes (0xF000 | HID usage for a key). */
    taps: { input: number; keys: number[] }[];
  }[];
  /** How many reports the unit was sent, in all. */
  reportsReceived: number;
}

/** What a test drives and looks at from outside the app, through `electronApp.evaluate`. */
export interface E2eControl {
  /** What the fake units hold now. */
  units(): FakeUnitView[];
  /** Replaces the list of running programs (image names, like `Azeron Software.exe`). */
  setProcesses(names: string[]): void;
  /** The paths opened on the fake HID backend, in order. */
  opened(): string[];
}

const BASE_PROCESSES = ['explorer.exe', 'helmArray.exe'];

/**
 * The steam folder only: a path outside it reads as missing. It is judged by where it really is,
 * after `..` and any link (a junction inside the folder that leads out) are followed, and the
 * file is read from that real place, so what was checked is what is read.
 */
function confinedSteam(steamDir: string): SteamReaders {
  const within = async (path: string): Promise<string | undefined> => {
    try {
      const [real, home] = await Promise.all([realpath(path), realpath(steamDir)]);
      return isInside(real, home, process.platform) ? real : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    readRegistrySteamPath: () => Promise.resolve(steamDir),
    async readFile(path) {
      const real = await within(path);
      return real === undefined ? undefined : readFile(real).catch(() => undefined);
    },
    async listDir(path) {
      const real = await within(path);
      return real === undefined ? undefined : readdir(real).catch(() => undefined);
    },
  };
}

export function fakeBackends(config: E2eConfig): Backends {
  const left = new FakeUnit({ deviceId: E2E_UNIT_IDS.left, slots: { 0: { name: 'Default' } } });
  const right = new FakeUnit({
    deviceId: E2E_UNIT_IDS.right,
    slots: { 0: { name: 'Default' }, 1: { name: 'Old layout' } },
  });
  const units = new Map([
    [LEFT_PATH, left],
    [RIGHT_PATH, right],
  ]);
  const hid = new FakeHidBackend(units);
  let processes = [...BASE_PROCESSES];

  const view = (hand: 'left' | 'right', unit: FakeUnit): FakeUnitView => ({
    hand,
    deviceId: E2E_UNIT_IDS[hand],
    running: unit.running,
    slots: [...unit.slots]
      .sort(([a], [b]) => a - b)
      .map(([slot, s]) => ({
        slot,
        name: s.name,
        inputs: s.records.size,
        taps: [...s.records.values()].flatMap((record) => {
          const decoded = decodeStoredRecord(record);
          if (decoded.kind !== 'button') return [];
          const keys = decoded.tap.keys.filter((code) => code !== 0);
          return keys.length > 0 ? [{ input: decoded.id, keys }] : [];
        }),
      })),
    reportsReceived: unit.received.length,
  });
  const control: E2eControl = {
    units: () => [view('left', left), view('right', right)],
    setProcesses: (names) => {
      processes = [...BASE_PROCESSES, ...names];
    },
    opened: () => [...hid.opened],
  };

  return {
    hid,
    listProcesses: () => Promise.resolve([...processes]),
    steam: confinedSteam(config.steamDir),
    control,
  };
}
