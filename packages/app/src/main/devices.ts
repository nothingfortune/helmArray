// The `devices` service: which units are plugged in, and what each one holds. node-hid has no
// hotplug event, so the device list is polled about once a second; that is also what turns a
// unit's chip off within a second of unplugging it. Pure: the list, the transport and the clock
// are all handed in, so tests run it over a fake unit and fake timers.

import type { StoredSlot, Transport, UnitIdentity } from '@helmarray/azeron';
import { UnitSession } from '@helmarray/azeron';
import { gatedSession, isGateRefusal } from './gated-session';
import type { UnitOps } from './gated-session';

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
  /** The clock, in milliseconds. Defaults to `Date.now`. */
  now?(): number;
  /**
   * A fresh look at whether the Azeron app is running, every call; a look that fails throws.
   * Every session the service has (and hands out) asks it before each operation: anything but a
   * plain "no" and the operation is refused before a report is sent (see gated-session.ts).
   * Without it, nothing is asked.
   */
  azeronAppRunning?(): Promise<boolean>;
}

export const POLL_MS = 1000;

export type UnitState = 'connecting' | 'ready' | 'failed';

/** One unit as the windows see it: plain data, safe to send over IPC. */
export interface UnitSnapshot {
  path: string;
  state: UnitState;
  /** Known once the unit has answered; also on a unit that then failed to read its slots. */
  identity?: UnitIdentity;
  /**
   * What the unit held when last read. Known once ready, but gone again when the unit could not
   * be looked at since (the Azeron app was open, or could not be ruled out): nothing is then
   * known of what it holds.
   */
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
  /** Only ever the gated form: no raw session leaves this service, or is kept in it. */
  session?: UnitOps;
  transport?: ClosableTransport;
  closing?: Promise<void>;
  /** Settles when `openUnit` has finished, opened or not: stop waits on it to close the unit. */
  opening?: Promise<void>;
  /** Unplugged (or the service stopped) while it was being set up: nothing more is done to it. */
  dropped: boolean;
  /** When the slots and the running slot were last read from the unit. */
  readAt?: number;
}

/** What a job holding the service is handed. */
export interface HoldTools {
  /**
   * Reads every ready unit again (who it is, its slots, the slot it runs), skipping a unit read
   * within the last `olderThanMs`. Tells the listeners once, if any unit was read.
   */
  refresh(olderThanMs?: number): Promise<void>;
}

const LOG = '(devices)';

export class Devices {
  private readonly entries = new Map<string, Entry>();
  /** Units unplugged whose open or close hasn't finished: not opened again until it has. */
  private readonly cleaning = new Map<string, Promise<void>>();
  private readonly listeners = new Set<Listener>();
  private running = false;
  /** Bumped by every start and stop, so a poll that was in flight across one is ignored. */
  private generation = 0;
  private cancelNext: (() => void) | null = null;
  /** Counts notices, so a nested one supersedes the one it interrupted. */
  private emitted = 0;
  /** Jobs holding the service (see `exclusive`), those waiting for their turn included. */
  private holding = 0;
  /** Settles when the last job to ask for the service has let go of it. */
  private holdTail: Promise<void> = Promise.resolve();

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
    // A job writing to the units is never cut off by the units being let go: it is waited for.
    // Its own checks stop it at the next step if the Azeron app has opened meanwhile.
    while (this.holding > 0) await this.holdTail;
    // Started again while waiting: that start supersedes this stop.
    if (this.running) return;
    // Every unit let go is tracked until its open and close have finished, so a second stop
    // waits for them too and a restart can't open a path still being let go.
    const hadUnits = this.entries.size > 0;
    for (const [path, entry] of this.entries) this.cleanUp(path, entry);
    this.entries.clear();
    if (hadUnits) this.emit();
    await Promise.all([...this.cleaning.values()]);
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
  session(deviceId: number): UnitOps | undefined {
    for (const entry of this.entries.values()) {
      if (entry.state === 'ready' && entry.identity?.deviceId === deviceId) return entry.session;
    }
    return undefined;
  }

  /**
   * Holds the service for `job`: while it runs nothing else reads from a unit or lists them.
   * Polling is skipped (the next one comes at its usual time after the job), a unit newly seen
   * is not opened, none is closed because a listing missed it, and `stop` waits. Jobs run one
   * at a time, in the order asked. The hold is let go of when the job ends, however it ends.
   *
   * What the job itself does to the units goes through `session()`; to put what the service
   * knows of them right afterwards, it uses `tools.refresh()`.
   */
  async exclusive<T>(job: (tools: HoldTools) => Promise<T>): Promise<T> {
    // Claimed now, not when the turn comes: a poll between the call and the turn is skipped too.
    this.holding++;
    const earlier = this.holdTail;
    let release!: () => void;
    this.holdTail = new Promise<void>((resolve) => (release = resolve));
    try {
      await earlier;
      return await job({ refresh: (olderThanMs) => this.readAgain(olderThanMs) });
    } finally {
      this.holding--;
      release();
    }
  }

  /** Reads the ready units again, unless read within `olderThanMs`. One job at a time. */
  refresh(options: { olderThanMs?: number } = {}): Promise<void> {
    return this.exclusive((tools) => tools.refresh(options.olderThanMs));
  }

  private async readAgain(olderThanMs?: number): Promise<void> {
    const now = this.deps.now ?? Date.now;
    let changed = false;
    for (const entry of [...this.entries.values()]) {
      if (entry.state !== 'ready' || entry.dropped || !entry.session) continue;
      if (olderThanMs !== undefined && now() - (entry.readAt ?? 0) < olderThanMs) continue;
      changed = true;
      try {
        const identity = await entry.session.identify();
        const slots = await entry.session.readSlots();
        const running = await entry.session.runningSlot();
        if (entry.dropped) continue;
        entry.identity = { ...identity, runningSlot: running };
        entry.slots = slots;
        entry.readAt = now();
      } catch (error) {
        if (entry.dropped) continue;
        // The gate refused (the Azeron app is open, or could not be ruled out): the unit was not
        // spoken to, it is not at fault, and the next look reads it.
        if (isGateRefusal(error)) {
          this.forget(entry);
          continue;
        }
        // What the unit holds is not known now: it is no longer offered as ready or as read.
        entry.state = 'failed';
        entry.error = messageOf(error);
        delete entry.session;
        delete entry.slots;
        this.trace(entry.path, `reading it again failed: ${entry.error}`);
        await this.close(entry);
      }
    }
    if (changed) this.emit();
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
    // A job holds the service: not even a listing is asked for. The next poll is on time.
    if (this.holding > 0) return;
    let paths: string[];
    try {
      paths = (await this.deps.findUnits()).map((unit) => unit.path);
    } catch (error) {
      // A failed look says nothing about the units: keep what is listed and look again.
      this.trace(LOG, `listing the units failed: ${messageOf(error)}`);
      return;
    }
    if (generation !== this.generation) return;
    // A hold began while the listing was out: it is dropped, so no unit is opened or closed.
    if (this.holding > 0) return;
    this.reconcile(new Set(paths));
  }

  private reconcile(present: Set<string>): void {
    let changed = false;
    for (const [path, entry] of this.entries) {
      if (present.has(path)) continue;
      this.entries.delete(path);
      this.trace(path, 'unplugged');
      this.cleanUp(path, entry);
      changed = true;
    }
    const added: Entry[] = [];
    for (const path of present) {
      // A unit still being let go is opened on a later poll, once its cleanup has finished.
      if (this.entries.has(path) || this.cleaning.has(path)) continue;
      const entry: Entry = { path, state: 'connecting', dropped: false };
      this.entries.set(path, entry);
      added.push(entry);
      changed = true;
    }
    if (changed) this.emit();
    // A listener may have stopped the service, or the unit gone, during emit.
    for (const entry of added) if (!entry.dropped) void this.connect(entry);
  }

  private async connect(entry: Entry): Promise<void> {
    const { path } = entry;
    try {
      let transport: ClosableTransport;
      try {
        const opening = this.deps.openUnit(path);
        entry.opening = opening.then(
          () => undefined,
          () => undefined,
        );
        transport = await opening;
      } catch (error) {
        throw new Error(`The unit couldn’t be opened: ${messageOf(error)}`, { cause: error });
      }
      entry.transport = transport;
      if (entry.dropped) return void (await this.close(entry));
      const session = gatedSession(new UnitSession(transport, (line) => this.trace(path, line)), {
        look: () => this.deps.azeronAppRunning?.() ?? Promise.resolve(false),
        stale: () => this.forget(entry),
        trace: (line) => this.trace(path, line),
      });
      const identity = await session.identify();
      if (entry.dropped) return;
      entry.identity = identity;
      this.emit();
      const slots = await session.readSlots();
      if (entry.dropped) return;
      entry.session = session;
      entry.slots = slots;
      entry.readAt = (this.deps.now ?? Date.now)();
      entry.state = 'ready';
      this.emit();
    } catch (error) {
      if (entry.dropped) return;
      // Refused by the gate: the unit was not spoken to. It is let go and a later poll tries it.
      if (isGateRefusal(error)) return this.giveUp(entry);
      entry.state = 'failed';
      entry.error = messageOf(error);
      this.trace(path, `failed: ${entry.error}`);
      this.emit();
      await this.close(entry);
    }
  }

  /** What is cached of a unit is not to be trusted any more: it is not said to be read. */
  private forget(entry: Entry): void {
    delete entry.slots;
    delete entry.readAt;
  }

  /** Lets a unit go that was not to be talked to; a later poll tries it again. */
  private giveUp(entry: Entry): void {
    if (entry.dropped) return;
    if (this.entries.get(entry.path) === entry) this.entries.delete(entry.path);
    this.cleanUp(entry.path, entry);
    this.emit();
  }

  private cleanUp(path: string, entry: Entry): void {
    const done = this.drop(entry).finally(() => {
      if (this.cleaning.get(path) === done) this.cleaning.delete(path);
    });
    this.cleaning.set(path, done);
  }

  /** Marks an entry gone and lets go of its transport (now, or when it finishes opening). */
  private async drop(entry: Entry): Promise<void> {
    entry.dropped = true;
    // A unit still opening has no transport yet: wait for it, so stop() resolves only once
    // everything it opened is closed and a restart can't open the same path twice.
    await entry.opening;
    await this.close(entry);
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
    // A listener can change the service (stop it, say), which emits a newer snapshot to
    // everyone. Then this older one must not reach the listeners still to come.
    const sequence = ++this.emitted;
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) {
      if (sequence !== this.emitted) return;
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
