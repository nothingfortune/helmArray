// The `devices` service: which units are plugged in, and what each one holds. node-hid has no
// hotplug event, so the device list is polled about once a second; that is also what turns a
// unit's chip off within a second of unplugging it. Pure: the list, the transport and the clock
// are all handed in, so tests run it over a fake unit and fake timers.

import type { StoredSlot, Transport, UnitIdentity } from '@helmarray/azeron';
import { UnitSession } from '@helmarray/azeron';

/** A transport that can be let go. The service closes every one it opens. */
export type ClosableTransport = Transport & { close(): Promise<void> };

export interface DeviceDeps {
  /** The units on the bus right now, each by a path that is stable while it stays plugged in. */
  findUnits(): Promise<{ path: string }[]>;
  openUnit(path: string): Promise<ClosableTransport>;
  /** Every report in and out of a unit, and what the service itself did, for the rolling log. */
  trace?(path: string, line: string): void;
  /** Runs `fn` once after `ms` and returns a way to cancel it. Defaults to `setTimeout`. */
  schedule?(fn: () => void, ms: number): () => void;
  /** Time between the end of one poll and the start of the next. Defaults to `POLL_MS`. */
  pollMs?: number;
}

export const POLL_MS = 1000;

export type UnitState = 'connecting' | 'ready' | 'failed';

/** One unit as the windows see it: plain data, safe to send over IPC. */
export interface UnitSnapshot {
  path: string;
  state: UnitState;
  /** Known once the unit has answered; also on a unit that then failed to read its slots. */
  identity?: UnitIdentity;
  /** Known once ready. */
  slots?: StoredSlot[];
  /** Why a unit failed, in the unit session's own words. */
  error?: string;
}

export interface DevicesSnapshot {
  units: UnitSnapshot[];
}

type Listener = (snapshot: DevicesSnapshot) => void;

interface Entry {
  path: string;
  state: UnitState;
  identity?: UnitIdentity;
  slots?: StoredSlot[];
  error?: string;
  session?: UnitSession;
  transport?: ClosableTransport;
  closing?: Promise<void>;
  /** Unplugged (or the service stopped) while it was being set up: nothing more is done to it. */
  dropped: boolean;
}

const LOG = '(devices)';

export class Devices {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<Listener>();
  private running = false;
  /** Bumped by every start and stop, so a poll that was in flight across one is ignored. */
  private generation = 0;
  private cancelNext: (() => void) | null = null;

  constructor(private readonly deps: DeviceDeps) {}

  /** Starts polling, with the first poll at once. Starting a running service does nothing. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    void this.tick(generation);
  }

  /** Stops polling and closes every unit. The listeners stay subscribed. */
  async stop(): Promise<void> {
    this.running = false;
    this.generation++;
    this.cancelNext?.();
    this.cancelNext = null;
    if (this.entries.size === 0) return;
    const closing = [...this.entries.values()].map((entry) => this.drop(entry));
    this.entries.clear();
    this.emit();
    await Promise.all(closing);
  }

  /** Calls `listener` with a fresh snapshot on every change. Returns the way to stop. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  snapshot(): DevicesSnapshot {
    return { units: [...this.entries.values()].map(snapshotOf) };
  }

  /** The session of a ready unit, for writing to it. Undefined for a unit that isn't ready. */
  session(deviceId: number): UnitSession | undefined {
    for (const entry of this.entries.values()) {
      if (entry.state === 'ready' && entry.identity?.deviceId === deviceId) return entry.session;
    }
    return undefined;
  }

  /** One poll, then the next after the interval: never two at once. */
  private async tick(generation: number): Promise<void> {
    await this.poll(generation);
    if (generation !== this.generation) return;
    const schedule = this.deps.schedule ?? defaultSchedule;
    this.cancelNext = schedule(() => {
      this.cancelNext = null;
      void this.tick(generation);
    }, this.deps.pollMs ?? POLL_MS);
  }

  private async poll(generation: number): Promise<void> {
    let paths: string[];
    try {
      paths = (await this.deps.findUnits()).map((unit) => unit.path);
    } catch (error) {
      // A failed look says nothing about the units: keep what is listed and look again.
      this.trace(LOG, `listing the units failed: ${messageOf(error)}`);
      return;
    }
    if (generation !== this.generation) return;
    this.reconcile(new Set(paths));
  }

  private reconcile(present: Set<string>): void {
    let changed = false;
    for (const [path, entry] of this.entries) {
      if (present.has(path)) continue;
      this.entries.delete(path);
      this.trace(path, 'unplugged');
      void this.drop(entry);
      changed = true;
    }
    const added: Entry[] = [];
    for (const path of present) {
      if (this.entries.has(path)) continue;
      const entry: Entry = { path, state: 'connecting', dropped: false };
      this.entries.set(path, entry);
      added.push(entry);
      changed = true;
    }
    if (changed) this.emit();
    for (const entry of added) void this.connect(entry);
  }

  private async connect(entry: Entry): Promise<void> {
    const { path } = entry;
    try {
      let transport: ClosableTransport;
      try {
        transport = await this.deps.openUnit(path);
      } catch (error) {
        throw new Error(`The unit couldn’t be opened: ${messageOf(error)}`, { cause: error });
      }
      entry.transport = transport;
      if (entry.dropped) return void (await this.close(entry));
      const session = new UnitSession(transport, (line) => this.trace(path, line));
      const identity = await session.identify();
      if (entry.dropped) return;
      entry.identity = identity;
      this.emit();
      const slots = await session.readSlots();
      if (entry.dropped) return;
      entry.session = session;
      entry.slots = slots;
      entry.state = 'ready';
      this.emit();
    } catch (error) {
      if (entry.dropped) return;
      entry.state = 'failed';
      entry.error = messageOf(error);
      this.trace(path, `failed: ${entry.error}`);
      this.emit();
      await this.close(entry);
    }
  }

  /** Marks an entry gone and lets go of its transport (now, or when it finishes opening). */
  private drop(entry: Entry): Promise<void> {
    entry.dropped = true;
    return this.close(entry);
  }

  private close(entry: Entry): Promise<void> {
    const { transport } = entry;
    if (!transport) return Promise.resolve();
    entry.closing ??= transport.close().catch((error: unknown) => {
      this.trace(entry.path, `closing failed: ${messageOf(error)}`);
    });
    return entry.closing;
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch (error) {
        this.trace(LOG, `a listener threw: ${messageOf(error)}`);
      }
    }
  }

  private trace(path: string, line: string): void {
    try {
      this.deps.trace?.(path, line);
    } catch {
      // The log must never take the service down.
    }
  }
}

const snapshotOf = (entry: Entry): UnitSnapshot => ({
  path: entry.path,
  state: entry.state,
  ...(entry.identity && { identity: { ...entry.identity } }),
  ...(entry.slots && { slots: structuredClone(entry.slots) }),
  ...(entry.error !== undefined && { error: entry.error }),
});

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};
