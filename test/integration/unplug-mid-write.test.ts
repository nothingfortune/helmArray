// The right unit is unplugged while its slot is being written. The result names the unit, nothing
// is recorded as applied, the unit is left part-written but still running what it ran, and once
// it is back a second Apply finishes the job.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Command, parseHostReport } from '@helmarray/azeron';
import type { Plan, Scheme } from '@helmarray/core';
import type { ApplyResult } from '../../packages/app/src/shared/api';
import { World, expectedSlot, heldSlot, holding } from './support/world';

/** The record piece after which the cable comes out: part way through the layout. */
const UNPLUGGED_AFTER_PIECE = 3;

describe('the right unit is unplugged mid-write', () => {
  let world: World;
  let scheme: Scheme;
  let plan: Plan;
  let failed: ApplyResult;
  let pieces = 0;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    scheme = await world.createKeysScheme();
    plan = await world.planOf(scheme);
    const preview = await world.helm.previewApply(scheme.id);
    world.right.afterFrame((frame) => {
      if (
        parseHostReport(frame).command === Command.OBM_COPY &&
        ++pieces === UNPLUGGED_AFTER_PIECE
      ) {
        world.right.unplug();
      }
    });
    failed = await world.helm.apply(scheme.id, preview.fingerprint);
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('the cable came out while the layout was going in (the moment the test hangs it on happened)', () => {
    expect([pieces, world.right.plugged]).toEqual([UNPLUGGED_AFTER_PIECE, false]);
  });

  it('Apply fails, names the right unit, and says its new slot may be part-written', () => {
    expect([failed.ok, failed.message]).toEqual([
      false,
      expect.stringMatching(
        /^The right unit failed: .+; a new slot 1 may be part-written, and the unit still runs slot 0 with its other slots as they were\.$/,
      ),
    ]);
  });

  it('the left unit had finished and the right one failed', () => {
    expect(failed.units.map((unit) => [unit.hand, unit.status])).toEqual([
      ['left', 'applied'],
      ['right', 'failed'],
    ]);
  });

  it('the right unit still runs slot 0, as it did', () => {
    expect(holding(world.right).running).toBe(0);
  });

  it('the right unit holds the first record of the layout in slot 1, of 31', () => {
    expect({
      held: Object.keys(heldSlot(world.right, 1) ?? {}),
      whole: Object.keys(expectedSlot(plan, 'right', 1)).length,
    }).toEqual({ held: ['1'], whole: 31 });
  });

  it('nothing is recorded as applied', async () => {
    expect(await world.app.data.getApplied(scheme.id)).toBeNull();
  });

  it('the scheme is not made the active one', () => {
    expect(world.state.activeSchemeId).toBeNull();
  });

  describe('then the unit is plugged back in', () => {
    let second: ApplyResult;

    beforeAll(async () => {
      // The service notices the unit gone at its next poll, as it would a second later...
      await world.until('the unplugged unit to be let go', () => world.state.devices.length === 1);
      world.right.replug();
      // ...and finds it again at a poll after the cable is back.
      await world.waitForBothUnits();
      const preview = await world.helm.previewApply(scheme.id);
      second = await world.helm.apply(scheme.id, preview.fingerprint);
    });

    it('the second Apply says both units run the layout', () => {
      expect(second.message).toBe('Both units now run the layout.');
    });

    it('the left unit, which already held it, is left alone', () => {
      expect(second.units.map((unit) => [unit.hand, unit.status])).toEqual([
        ['left', 'unchanged'],
        ['right', 'applied'],
      ]);
    });

    it('the right unit holds the layout in a fresh slot 2, runs it, and nothing else is left', () => {
      expect({ ...holding(world.right), records: heldSlot(world.right, 2) }).toEqual({
        slots: { 2: "Game's own keys" },
        running: 2,
        records: expectedSlot(plan, 'right', 2),
      });
    });

    it('the store now holds the plan as applied', async () => {
      expect(await world.app.data.getApplied(scheme.id)).toEqual(plan);
    });

    it('the pill reads In sync', () => {
      expect(world.state.sync).toEqual({ label: 'In sync', tone: 'ok' });
    });
  });
});
