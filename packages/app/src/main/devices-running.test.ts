// The profile button moves the slot a unit runs without a word. The devices service asks each ready
// unit which slot it runs, and the pill follows: it is the units' own answer, not what the app
// last did.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Game, Hand, Plan, Scheme } from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
  CYBORG2_LEFT,
  CYBORG2_RIGHT,
  gameKeysPreset,
  resolve,
} from '@helmarray/core';
import {
  Command,
  FakeUnit,
  encodeRecord,
  parseHostReport,
  storedFromWritten,
  unitRecords,
} from '@helmarray/azeron';
import { composeAppState } from './app-state';
import type { ActivePlans } from './active-plans';
import type { ClosableTransport } from './devices';
import { Devices, RUNNING_MS } from './devices';
import { handsFor } from './hands';

const game: Game = {
  id: 'skiff',
  name: 'Skiff',
  modes: [{ id: 'ship', name: 'Ship' }],
  actions: [
    { id: 'boost', name: 'Boost', mode: 'ship', role: 'movement', required: true },
    { id: 'fire', name: 'Fire', mode: 'ship', role: 'combat', required: true },
  ],
  file: { format: 'elite-binds' },
};
const scheme: Scheme = {
  ...gameKeysPreset(game),
  map: {
    ship: {
      'L.index_1': { tap: 'boost' },
      'L.middle_1': { tap: 'fire' },
      'R.index_1': { tap: 'fire' },
    },
  },
};
const plan: Plan = resolve(scheme, game, BUILT_IN_DEVICES);
const LEFT = 49229;
const RIGHT = 29993;
const DEVICE = { left: CYBORG2_LEFT, right: CYBORG2_RIGHT } as const;

/** A unit holding the layout in slot 1 and something else in slot 0, running slot 1. */
const holding = (hand: Hand, id: number) =>
  new FakeUnit({
    deviceId: id,
    slots: {
      0: { name: 'Default' },
      1: {
        name: 'Main',
        records: unitRecords(plan.units[hand], DEVICE[hand]).map((r) =>
          storedFromWritten(encodeRecord(1, r)),
        ),
      },
    },
    running: 1,
  });

const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
};

describe('the slot each unit runs, asked on a timer', () => {
  let left: FakeUnit;
  let right: FakeUnit;
  let devices: Devices;
  /** Commands that reached each unit. */
  const asked = { left: 0, right: 0 };
  const read = { left: 0, right: 0 };
  let azeron = () => Promise.resolve(false);
  let failSends = false;
  const gate: { left: Promise<void> | null; right: Promise<void> | null } = {
    left: null,
    right: null,
  };

  const connect = (hand: Hand, unit: FakeUnit): ClosableTransport => ({
    send: async (report) => {
      if (failSends) throw new Error('the unit went quiet');
      const { command } = parseHostReport(report);
      await gate[hand];
      if (command === Command.HARDWARE_PROFILE_INDEX) asked[hand]++;
      if (command === Command.PROFILE_PAYLOAD_V2) read[hand]++;
      await unit.send(report);
    },
    receive: () => unit.receive(),
    close: () => Promise.resolve(),
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    left = holding('left', LEFT);
    right = holding('right', RIGHT);
    azeron = () => Promise.resolve(false);
    failSends = false;
    gate.left = null;
    gate.right = null;
    devices = new Devices({
      findUnits: () => Promise.resolve([{ path: 'left' }, { path: 'right' }]),
      openUnit: (path) =>
        Promise.resolve(
          connect(path === 'left' ? 'left' : 'right', path === 'left' ? left : right),
        ),
      azeronAppRunning: () => azeron(),
    });
    devices.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(devices.snapshot().units.map((u) => u.state)).toEqual(['ready', 'ready']);
    asked.left = asked.right = read.left = read.right = 0;
  });
  afterEach(async () => {
    await devices.stop();
    vi.useRealTimers();
  });

  const applied: ActivePlans = { active: true, applied: plan, current: plan };
  const pill = () =>
    composeAppState({
      devices: devices.snapshot(),
      hands: handsFor([LEFT, RIGHT], { get: (id) => (id === LEFT ? 'left' : 'right') }),
      writeBlock: null,
      plans: applied,
      now: Date.now(),
    }).sync;
  const tick = () => vi.advanceTimersByTimeAsync(RUNNING_MS);
  /** What a window is told of each unit: whether it is read, and the slot it runs. */
  const chips = () =>
    composeAppState({
      devices: devices.snapshot(),
      hands: handsFor([LEFT, RIGHT], { get: (id) => (id === LEFT ? 'left' : 'right') }),
      writeBlock: null,
    }).devices.map((c) => [c.read, c.running]);

  it('follows the profile button within one tick: In sync, then the unit that moved differs', async () => {
    expect(pill().label).toBe('In sync');
    const seen: number[] = [];
    devices.onChange((s) => seen.push(s.units[0]?.identity?.runningSlot ?? -1));
    left.running = 0; // the button, with no command and no word
    await tick();
    expect(devices.snapshot().units[0]?.identity?.runningSlot).toBe(0);
    expect(seen).toEqual([0]);
    expect(pill().label).toBe('Left unit differs');
    // Pressed back: in sync again within a tick.
    left.running = 1;
    await tick();
    expect(pill().label).toBe('In sync');
  });

  it('does not tell anyone when nothing moved, but asks every unit every tick', async () => {
    const listener = vi.fn();
    devices.onChange(listener);
    await tick();
    await tick();
    expect(listener).not.toHaveBeenCalled();
    expect(asked).toEqual({ left: 2, right: 2 });
  });

  it('asks one unit at a time', async () => {
    const hold = deferred();
    gate.left = hold.promise;
    await tick();
    expect(asked).toEqual({ left: 0, right: 0 }); // the left question is still out
    hold.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual({ left: 1, right: 1 });
  });

  it('asks nothing while a job holds the service (an apply), and carries on after it', async () => {
    const hold = deferred();
    const job = devices.exclusive(() => hold.promise);
    await vi.advanceTimersByTimeAsync(RUNNING_MS * 4);
    expect(asked).toEqual({ left: 0, right: 0 });
    hold.release();
    await job;
    await tick();
    expect(asked).toEqual({ left: 1, right: 1 });
  });

  it('asks nothing with the Azeron app open, or when that cannot be told, and says it has not checked', async () => {
    azeron = () => Promise.resolve(true);
    await tick();
    expect(asked).toEqual({ left: 0, right: 0 });
    expect(pill().label).toBe('Not checked yet');

    azeron = () => Promise.reject(new Error('tasklist failed'));
    await tick();
    expect(asked).toEqual({ left: 0, right: 0 });

    // Closed again: both are read afresh, slots and all, and the pill is back.
    azeron = () => Promise.resolve(false);
    await tick();
    expect(devices.snapshot().units.every((u) => u.slots !== undefined)).toBe(true);
    expect(pill().label).toBe('In sync');
  });

  it('downgrades a unit it could not ask to "Not checked yet", not its old verdict, and reads it again after', async () => {
    expect(pill().label).toBe('In sync');
    failSends = true;
    await tick();
    expect(devices.snapshot().units.every((u) => u.slots === undefined)).toBe(true);
    expect(devices.snapshot().units.every((u) => u.state === 'ready')).toBe(true);
    expect(pill().label).toBe('Not checked yet');
    // The windows are told the units are not read, so an open drawer looks again ...
    expect(chips()).toEqual([
      [false, null],
      [false, null],
    ]);

    failSends = false;
    await tick();
    expect(read.left).toBeGreaterThan(0);
    expect(pill().label).toBe('In sync');
    // ... and again when they are read: that is what enables Apply without reopening it.
    expect(chips()).toEqual([
      [true, 1],
      [true, 1],
    ]);
  });

  it('reads a unit again when it runs a slot the cache has not got', async () => {
    left.slots.set(5, { name: 'Made elsewhere', records: new Map() });
    left.running = 5;
    await tick();
    const unit = devices.snapshot().units[0];
    expect(read.left).toBeGreaterThan(0);
    expect(unit?.slots?.map((s) => s.slot)).toEqual([0, 1, 5]);
    expect(unit?.identity?.runningSlot).toBe(5);
    // The right unit's slots were not read again: nothing was missing there.
    expect(read.right).toBe(0);
  });

  it('does not read the slots again for a button press between slots it knows', async () => {
    left.running = 0;
    await tick();
    expect(read.left).toBe(0);
  });

  it('asks no further unit once the service is being stopped', async () => {
    const hold = deferred();
    gate.left = hold.promise;
    await tick(); // the left question is out
    const stopping = devices.stop();
    hold.release();
    await stopping;
    expect(asked.right).toBe(0);
  });

  it('stops asking when the service is stopped', async () => {
    await devices.stop();
    await vi.advanceTimersByTimeAsync(RUNNING_MS * 3);
    expect(asked).toEqual({ left: 0, right: 0 });
  });
});
