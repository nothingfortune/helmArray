// J1 end to end: a scheme from the Xbox controller preset on Helldivers 2 is previewed, applied
// and verified, through `window.helm`, over the real services and a fake pair of units.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApplyPreview, ApplyResult } from '../../packages/app/src/shared/api';
import type { Plan, Scheme } from '@helmarray/core';
import { isWrite } from './support/fake-hid';
import { HELLDIVERS2, World, expectedSlot, heldSlot, holding } from './support/world';

describe('J1: the Xbox controller preset on Helldivers 2, applied', () => {
  let world: World;
  let scheme: Scheme;
  let plan: Plan;
  let preview: ApplyPreview;
  let result: ApplyResult;

  // One Apply, then each test reads a different thing it left behind.
  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    // The two units start as stock: one slot, "Default", running. The test depends on that.
    expect([holding(world.left), holding(world.right)]).toEqual([
      { slots: { 0: 'Default' }, running: 0 },
      { slots: { 0: 'Default' }, running: 0 },
    ]);
    const created = await world.createScheme('xbox');
    scheme = await world.keepFindings(created.id);
    plan = await world.planOf(scheme);
    // The two halves of the plan are different layouts: a half on the wrong unit would show.
    expect(expectedSlot(plan, 'left', 1)).not.toEqual(expectedSlot(plan, 'right', 1));
    ({ preview, result } = await world.previewAndApply(scheme.id));
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('the preview was ready and promised a new slot 1 on each unit', () => {
    expect([preview.ready, preview.left.write?.slot, preview.right.write?.slot]).toEqual([
      true,
      1,
      1,
    ]);
  });

  it('Apply says both units run the layout', () => {
    expect(result).toEqual({
      ok: true,
      message: 'Both units now run the layout.',
      units: [
        { hand: 'left', status: 'applied', message: expect.any(String), slot: 1 },
        { hand: 'right', status: 'applied', message: expect.any(String), slot: 1 },
      ],
    });
  });

  it('the left unit holds the plan’s left half in slot 1, named for the scheme, and runs it', () => {
    expect({ ...holding(world.left), records: heldSlot(world.left, 1) }).toEqual({
      slots: { 1: 'Xbox controller' },
      running: 1,
      records: expectedSlot(plan, 'left', 1),
    });
  });

  it('the right unit holds the plan’s right half in slot 1, named for the scheme, and runs it', () => {
    expect({ ...holding(world.right), records: heldSlot(world.right, 1) }).toEqual({
      slots: { 1: 'Xbox controller' },
      running: 1,
      records: expectedSlot(plan, 'right', 1),
    });
  });

  it('the store holds the plan that was applied', async () => {
    expect(await world.app.data.getApplied(scheme.id)).toEqual(plan);
  });

  it('the store holds the scheme with no keys dealt: pad output sends pad controls, not keys', async () => {
    expect([plan.ledger, (await world.scheme(scheme.id)).ledger]).toEqual([{}, {}]);
  });

  it('the scheme is now the game’s active one', () => {
    expect([world.state.activeGameId, world.state.activeSchemeId]).toEqual([
      HELLDIVERS2,
      scheme.id,
    ]);
  });

  it('the sync pill reads In sync', () => {
    expect(world.state.sync).toEqual({ label: 'In sync', tone: 'ok' });
  });
});

describe('J1: a scheme whose errors were not kept', () => {
  let world: World;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('is not ready to apply, and the drawer says why in the game’s words', async () => {
    const fresh = await world.createScheme('xbox');
    const preview = await world.helm.previewApply(fresh.id);
    expect(preview.checks.filter((check) => !check.ok).map((check) => check.text)).toEqual([
      'Move forward is needed to play Default, and it is on no button.',
      'Move back is needed to play Default, and it is on no button.',
      'Strafe left is needed to play Default, and it is on no button.',
      'Strafe right is needed to play Default, and it is on no button.',
      'Fire is needed to play Default, and it is on no button.',
      'Stratagem (hold) is needed to play Default, and it is on no button.',
    ]);
  });

  it('is refused by Apply itself, whatever the drawer showed', async () => {
    const fresh = await world.createScheme('xbox');
    const preview = await world.helm.previewApply(fresh.id);
    const result = await world.helm.apply(fresh.id, preview.fingerprint);
    expect([result.ok, result.units]).toEqual([false, []]);
  });

  it('writes nothing to either unit when Apply is pressed on it, though both were read', async () => {
    const fresh = await world.createScheme('xbox');
    const preview = await world.helm.previewApply(fresh.id);
    await world.helm.apply(fresh.id, preview.fingerprint);
    const sent = [world.left, world.right].map((unit) => unit.commands());
    expect(sent.map((commands) => [commands.length > 0, commands.filter(isWrite)])).toEqual([
      [true, []],
      [true, []],
    ]);
  });
});
