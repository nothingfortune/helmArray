// The Azeron app opens in the middle of an Apply, after the left unit is done and before the right
// one is touched. Two programs talking to one unit mix their answers, so from that moment helmArray
// sends nothing: the right unit gets no report at all, and there is no read-back afterwards.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Command, parseHostReport } from '@helmarray/azeron';
import type { Plan, Scheme } from '@helmarray/core';
import type { ApplyResult } from '../../packages/app/src/shared/api';
import { World, expectedSlot, heldSlot, holding } from './support/world';

describe('the Azeron app opens between the two units of an Apply', () => {
  let world: World;
  let scheme: Scheme;
  let plan: Plan;
  let result: ApplyResult;
  /** Frames each unit had been sent when the Apply began, and when the Azeron app opened. */
  let atStart: { left: number; right: number };
  let leftAtOpen: number | null = null;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    scheme = await world.createKeysScheme();
    plan = await world.planOf(scheme);
    const preview = await world.helm.previewApply(scheme.id);

    // The Azeron app opens the moment the left unit has answered its last question, which is
    // what it runs once the other slots are gone: the left unit is finished, the right not begun.
    world.left.afterFrame((frame) => {
      const { command } = parseHostReport(frame);
      const finished =
        command === Command.HARDWARE_PROFILE_INDEX &&
        world.left.unit.slots.size === 1 &&
        world.left.unit.running === 1;
      if (finished && leftAtOpen === null) {
        leftAtOpen = world.left.unit.received.length;
        world.processes.azeronOpen = true;
      }
    });
    atStart = { left: world.left.unit.received.length, right: world.right.unit.received.length };
    result = await world.helm.apply(scheme.id, preview.fingerprint);
    await world.idle();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('the Azeron app did open between the units (the moment the test hangs it on happened)', () => {
    expect(leftAtOpen).toBeGreaterThan(atStart.left);
  });

  it('Apply fails on the right unit and says the Azeron app is why', () => {
    expect(result).toEqual({
      ok: false,
      message:
        'The right unit failed: the Azeron app is open, and it talks to the units too: close it first; nothing on it was changed.',
      units: [
        { hand: 'left', status: 'applied', message: expect.any(String), slot: 1 },
        { hand: 'right', status: 'failed', message: expect.any(String), slot: null },
      ],
    });
  });

  it('the right unit was sent no report at all', () => {
    expect(world.right.unit.received.length - atStart.right).toBe(0);
  });

  it('the left unit was sent nothing after the Azeron app opened: no read-back', () => {
    expect(world.left.unit.received.length - (leftAtOpen ?? 0)).toBe(0);
  });

  it('the left unit, finished before the Azeron app opened, holds its half of the layout', () => {
    expect({ ...holding(world.left), records: heldSlot(world.left, 1) }).toEqual({
      slots: { 1: "Game's own keys" },
      running: 1,
      records: expectedSlot(plan, 'left', 1),
    });
  });

  it('the right unit is as it was: its stock slot, running', () => {
    expect(holding(world.right)).toEqual({ slots: { 0: 'Default' }, running: 0 });
  });

  it('nothing is recorded as applied', async () => {
    expect(await world.app.data.getApplied(scheme.id)).toBeNull();
  });

  it('the scheme is not made the active one', () => {
    expect(world.state.activeSchemeId).toBeNull();
  });

  it('neither unit is shown as read: nothing is known of what they hold now', () => {
    expect(world.state.devices.map((chip) => chip.read)).toEqual([false, false]);
  });

  it('the log says the reads that would have followed were refused', async () => {
    const lines = await world.logLines();
    expect(
      lines.some((line) =>
        line.includes(`[${world.left.path}] identify refused: the Azeron app is open`),
      ),
    ).toBe(true);
  });
});
