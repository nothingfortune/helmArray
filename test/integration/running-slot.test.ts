// The profile button on a unit moves the slot it runs without a word. The devices service asks
// each unit which slot it runs every few seconds; what it hears reaches the pill, which stops
// saying In sync. The pill is read from the units, never from what the app last did.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isWrite } from './support/fake-hid';
import { World, expectedSlot, heldSlot } from './support/world';
import type { Plan } from '@helmarray/core';

describe('the profile button moves the slot the left unit runs', () => {
  let world: World;
  let plan: Plan;
  let framesBeforeTick: { left: number; right: number };

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    const scheme = await world.createKeysScheme();
    plan = await world.planOf(scheme);
    await world.previewAndApply(scheme.id);
    // Both units hold the layout, run it, and the pill says so: the test starts from there.
    expect([world.state.sync.label, world.state.devices.map((chip) => chip.running)]).toEqual([
      'In sync',
      [1, 1],
    ]);
    // The owner added a spare profile on the left unit (in the Azeron app, earlier) and now
    // presses the unit's profile button: it runs slot 0 and says nothing.
    world.left.unit.slots.set(0, { name: 'Spare', records: new Map() });
    world.left.unit.running = 0;
    framesBeforeTick = {
      left: world.left.unit.received.length,
      right: world.right.unit.received.length,
    };
    await world.runningSlotTick();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('the tick asked the left unit which slot it runs', () => {
    expect(world.left.unit.received.length).toBeGreaterThan(framesBeforeTick.left);
  });

  it('the left chip shows slot 0 as the one it runs', () => {
    expect(world.state.devices.map((chip) => [chip.hand, chip.running])).toEqual([
      ['left', 0],
      ['right', 1],
    ]);
  });

  it('the pill says the left unit differs, and not In sync', () => {
    expect(world.state.sync).toEqual({
      label: 'Left unit differs',
      tone: 'error',
      detail: expect.stringMatching(/^Left unit: \d+ buttons? not as applied\.$/),
    });
  });

  it('asking is not writing: nothing but questions reached the left unit', () => {
    expect(world.left.commands().slice(framesBeforeTick.left).filter(isWrite)).toEqual([]);
  });

  it('the layout is still in slot 1 on the left unit: only what runs changed', () => {
    expect(heldSlot(world.left, 1)).toEqual(expectedSlot(plan, 'left', 1));
  });

  it('pressing the button back to the layout puts the pill back to In sync', async () => {
    world.left.unit.running = 1;
    await world.runningSlotTick();
    expect(world.state.sync).toEqual({ label: 'In sync', tone: 'ok' });
  });
});
