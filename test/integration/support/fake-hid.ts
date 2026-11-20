// A fake HID bus under the app's real transport (packages/app/src/main/hid-transport.ts). It
// hands out paths the way hidapi does on Windows, lists several interfaces per device and
// several devices (the units, the rudder pedals, an Xbox controller), and records everything
// that reaches it, so a test can say what was and was not touched.
//
// Each Azeron unit is a `FakeUnit` from @helmarray/azeron: the protocol-speaking fake, which is
// the one thing the app's own session talks to. What this file adds is the hidapi edge: report
// id 0 ahead of each 64-byte frame (a write that is not 65 bytes is refused, as hidapi would),
// a unit that can be unplugged, and a hook after each frame for a test to act on.
//
// The pedals are the point of `forbidden`: a HID GET_REPORT hung them until they were replugged.
// The app's `HidDevice` has no way to send one, so the fake gives every device it hands out the
// feature-report methods node-hid has, and records any call as a `GET_REPORT` (or its sibling)
// instead of answering it. A test that finds `forbidden()` not empty has found a way the app
// could have sent one.

import { Command, FakeUnit, REPORT_LENGTH, parseHostReport } from '@helmarray/azeron';
import type { FakeUnitOptions } from '@helmarray/azeron';
import type {
  HidBackend,
  HidDevice,
  HidDeviceInfo,
} from '../../../packages/app/src/main/hid-transport';

const HID_GUID = '{4d1e55b2-f16f-11cf-88cb-001111000030}';

/** The way hidapi spells a path on Windows: `\\?\HID#VID_16D0&PID_12F7&MI_04#<instance>#<guid>`. */
export function hidPath(
  vendorId: number,
  productId: number,
  iface: number,
  serial: string,
): string {
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
  const mi = iface >= 0 ? `&MI_${iface.toString().padStart(2, '0')}` : '';
  return `\\\\?\\HID#VID_${hex(vendorId)}&PID_${hex(productId)}${mi}#${serial}#${HID_GUID}`;
}

/** One thing that reached the bus, in order. */
export type HidEvent =
  | { op: 'enumerate'; vendorId: number; productId: number }
  | { op: 'open'; path: string }
  | { op: 'write'; path: string; bytes: number }
  | { op: 'read'; path: string }
  | { op: 'close'; path: string }
  /** A feature-report call (GET_REPORT or its siblings): never sent, only recorded. */
  | { op: 'GET_REPORT' | 'SEND_FEATURE_REPORT'; path: string };

/** What the app is handed for an opened device: write, read, close, and the traps. */
type OpenedDevice = HidDevice & {
  getFeatureReport(reportId: number, length: number): Promise<never>;
  sendFeatureReport(data: Uint8Array): Promise<never>;
};

export interface PluggedUnitOptions extends FakeUnitOptions {
  /** A short text that makes this unit's paths its own. */
  serial: string;
}

/**
 * An Azeron Cyborg II on the bus: its configuration interface (MI_04, vendor page 0xFF01) and
 * the interfaces Windows also lists for it (keyboard, mouse), which the app must never open.
 */
export class PluggedUnit {
  readonly unit: FakeUnit;
  /** The configuration interface: the only path of this unit the app may open. */
  readonly path: string;
  /** The unit's other interfaces. */
  readonly otherPaths: string[];
  plugged = true;
  private readonly hooks: ((frame: Uint8Array) => void)[] = [];

  constructor(
    private readonly bus: FakeHid,
    options: PluggedUnitOptions,
  ) {
    const { serial, ...unitOptions } = options;
    this.unit = new FakeUnit(unitOptions);
    this.path = hidPath(UNIT.vendorId, UNIT.productId, 4, serial);
    this.otherPaths = [0, 1, 2].map((i) => hidPath(UNIT.vendorId, UNIT.productId, i, serial));
  }

  /** The commands this unit has been sent, in order. */
  commands(): number[] {
    return this.unit.received.map((frame) => parseHostReport(frame).command);
  }

  /** Runs `hook` after every frame the unit receives from now on. */
  afterFrame(hook: (frame: Uint8Array) => void): void {
    this.hooks.push(hook);
  }

  /** Pulls the cable: the unit leaves the bus, and what the app holds of it stops working. */
  unplug(): void {
    this.plugged = false;
  }

  /** Plugs it back in: the same paths as before, as hidapi gives while a unit stays plugged in. */
  replug(): void {
    this.plugged = true;
  }

  /** What the bus lists for this unit now. */
  infos(): HidDeviceInfo[] {
    if (!this.plugged) return [];
    return [
      ...this.otherPaths.map((path, i) => ({
        vendorId: UNIT.vendorId,
        productId: UNIT.productId,
        path,
        usagePage: i === 0 ? 0x01 : 0x0c,
        interface: i,
      })),
      {
        vendorId: UNIT.vendorId,
        productId: UNIT.productId,
        path: this.path,
        usagePage: UNIT.usagePage,
        interface: UNIT.interface,
      },
    ];
  }

  /** The device the app gets by opening the configuration interface. */
  open(): HidDevice {
    const gone = () => {
      if (!this.plugged) throw new Error('The device is not connected.');
    };
    return {
      write: async (data) => {
        gone();
        // hidapi: an unnumbered report goes with a leading 0, so 65 bytes for a 64-byte frame.
        if (data.length !== REPORT_LENGTH + 1 || data[0] !== 0) {
          throw new Error(`hidapi wants report id 0 and a whole frame: got ${data.length} bytes.`);
        }
        const frame = data.slice(1);
        this.bus.record({ op: 'write', path: this.path, bytes: data.length });
        await this.unit.send(frame);
        for (const hook of this.hooks) hook(frame);
      },
      read: async () => {
        gone();
        this.bus.record({ op: 'read', path: this.path });
        return (await this.unit.receive()) ?? undefined;
      },
      close: () => {
        this.bus.record({ op: 'close', path: this.path });
        return Promise.resolve();
      },
    };
  }
}

export const UNIT = {
  vendorId: 0x16d0,
  productId: 0x12f7,
  usagePage: 0xff01,
  interface: 4,
} as const;
export const PEDALS = { vendorId: 0x06a3, productId: 0x0763 } as const;
export const XBOX_PAD = { vendorId: 0x045e, productId: 0x02ea } as const;

/** The pedals, or any other device that is not a unit: a device the app must never touch. */
export interface Bystander {
  name: string;
  info: HidDeviceInfo;
  /** Every call that reached it, in order. */
  touched: string[];
}

export class FakeHid implements HidBackend {
  /** Everything that reached the bus, in order. */
  readonly events: HidEvent[] = [];
  private readonly units: PluggedUnit[] = [];
  private readonly bystanders: Bystander[] = [];

  plugUnit(options: PluggedUnitOptions): PluggedUnit {
    const unit = new PluggedUnit(this, options);
    this.units.push(unit);
    return unit;
  }

  /** A device that is not a unit. Anything that opens it or calls it is a fault. */
  plugBystander(name: string, vendorId: number, productId: number, usagePage: number): Bystander {
    const entry: Bystander = {
      name,
      info: {
        vendorId,
        productId,
        path: hidPath(vendorId, productId, -1, `bystander-${this.bystanders.length}`),
        usagePage,
        interface: -1,
      },
      touched: [],
    };
    this.bystanders.push(entry);
    return entry;
  }

  record(event: HidEvent): void {
    this.events.push(event);
  }

  enumerate(vendorId: number, productId: number): Promise<HidDeviceInfo[]> {
    this.record({ op: 'enumerate', vendorId, productId });
    // hidapi: 0 and 0 mean every device on the bus.
    const all = vendorId === 0 && productId === 0;
    const matches = (info: HidDeviceInfo) =>
      all || (info.vendorId === vendorId && info.productId === productId);
    return Promise.resolve(
      [...this.units.flatMap((unit) => unit.infos()), ...this.bystanders.map((b) => b.info)].filter(
        matches,
      ),
    );
  }

  open(path: string): Promise<OpenedDevice> {
    this.record({ op: 'open', path });
    const unit = this.units.find((u) => u.plugged && u.path === path);
    const bystander = this.bystanders.find((b) => b.info.path === path);
    if (bystander) bystander.touched.push('open');
    const base: HidDevice | undefined =
      unit?.open() ?? (bystander ? this.touchedDevice(bystander) : undefined);
    if (!base) {
      const listed = this.units.some((u) => u.otherPaths.includes(path));
      return Promise.reject(
        new Error(
          listed
            ? 'That interface of a unit is not its configuration interface.'
            : 'No device at that path.',
        ),
      );
    }
    return Promise.resolve({
      ...base,
      getFeatureReport: () => {
        this.record({ op: 'GET_REPORT', path });
        return Promise.reject(new Error('A GET_REPORT must never be sent.'));
      },
      sendFeatureReport: () => {
        this.record({ op: 'SEND_FEATURE_REPORT', path });
        return Promise.reject(new Error('A feature report must never be sent.'));
      },
    });
  }

  /** A bystander that was opened: it answers nothing, and says every call it got. */
  private touchedDevice(bystander: Bystander): HidDevice {
    const say = (what: string) => {
      bystander.touched.push(what);
      return Promise.reject(new Error(`${bystander.name} must never be talked to (${what}).`));
    };
    return {
      write: () => say('write'),
      read: () => say('read'),
      close: () => {
        bystander.touched.push('close');
        return Promise.resolve();
      },
    };
  }

  // What a test asks ----------------------------------------------------------------------------

  /** The paths opened, in order. */
  opened(): string[] {
    return this.events.flatMap((e) => (e.op === 'open' ? [e.path] : []));
  }

  /** Every `enumerate` as `vendor:product`, so a test can say which devices were asked for. */
  enumerated(): string[] {
    return this.events.flatMap((e) =>
      e.op === 'enumerate' ? [`${hex4(e.vendorId)}:${hex4(e.productId)}`] : [],
    );
  }

  /** The feature-report calls that reached any device: always empty, or the app can send one. */
  forbidden(): HidEvent[] {
    return this.events.filter((e) => e.op === 'GET_REPORT' || e.op === 'SEND_FEATURE_REPORT');
  }
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0');

/** Whether a frame writes to a unit (anything the app sends that is not a read). */
export const isWrite = (command: number): boolean =>
  command === Command.CHECK_PROFILE ||
  command === Command.PROFILE_NAME ||
  command === Command.OBM_COPY ||
  command === Command.SWITCH_PROFILE ||
  command === Command.DELETE_PROFILE;
