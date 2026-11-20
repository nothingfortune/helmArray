// J2: a binding edit, the pill stops saying In sync, Apply writes only the unit the edit changed,
// and the pill is back in sync. The edit is made the way the editor makes it (`assign`), saved
// through `window.helm`, and read back from the units.

import { isDeepStrictEqual } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Plan, Scheme } from '@helmarray/core';
import type { ApplyPreview, ApplyResult } from '../../packages/app/src/shared/api';
import { assign } from '../../packages/app/src/renderer/screens/editor-model';
import { isWrite } from './support/fake-hid';
import { World, expectedSlot, heldSlot, holding } from './support/world';

describe('J2: moving Fire to another button of the right unit', () => {
  let world: World;
  let before: Scheme;
  let after: Scheme;
  let appliedPlan: Plan;
  let editedPlan: Plan;
  let ledgerBeforeApply: Scheme['ledger'];
  let ledgerAfterApply: Scheme['ledger'];
  let pillAfterEdit: string;
  let preview: ApplyPreview;
  let result: ApplyResult;
  /** How many frames each unit had been sent when the second Apply began. */
  /** How many states the windows had been told when the second Apply began. */
  let toldBefore: number;
  let sentBefore: { left: number; right: number };

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    before = await world.createKeysScheme();
    appliedPlan = await world.planOf(before);
    ledgerBeforeApply = before.ledger;
    const first = await world.previewAndApply(before.id);
    ledgerAfterApply = (await world.scheme(before.id)).ledger;
    // The test starts from a scheme that is applied and read back in sync.
    expect([first.result.ok, world.state.sync.label]).toEqual([true, 'In sync']);

    after = await world.edit(before.id, (scheme, game) =>
      assign(scheme, { mode: 'default', control: 'R.index_2', press: 'tap' }, 'fire_primary', game),
    );
    editedPlan = await world.planOf(after);
    await world.until('the pill to notice the edit', () => world.state.sync.label !== 'In sync');
    pillAfterEdit = world.state.sync.label;

    sentBefore = { left: world.left.unit.received.length, right: world.right.unit.received.length };
    toldBefore = world.states.length;
    preview = await world.helm.previewApply(before.id);
    result = await world.helm.apply(before.id, preview.fingerprint);
    await world.idle();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('the edit changed the right unit’s half of the plan and not the left’s', () => {
    expect([
      isDeepStrictEqual(expectedSlot(editedPlan, 'left', 1), expectedSlot(appliedPlan, 'left', 1)),
      isDeepStrictEqual(
        expectedSlot(editedPlan, 'right', 1),
        expectedSlot(appliedPlan, 'right', 1),
      ),
    ]).toEqual([true, false]);
  });

  it('the pill says two buttons changed and are not applied, before any Apply', () => {
    expect(pillAfterEdit).toBe('2 changes not applied');
  });

  it('the drawer offers a write to the right unit only', () => {
    expect([preview.left.write, preview.right.write?.slot]).toEqual([null, 0]);
  });

  it('Apply says the left unit already held its layout and the right was written', () => {
    expect(result.units.map((unit) => [unit.hand, unit.status])).toEqual([
      ['left', 'unchanged'],
      ['right', 'applied'],
    ]);
  });

  it('no write of any kind reached the left unit', () => {
    const lastApply = world.left.commands().slice(sentBefore.left);
    expect([lastApply.length > 0, lastApply.filter(isWrite)]).toEqual([true, []]);
  });

  it('the right unit holds the edited layout in a new slot 0, runs it, and has nothing else', () => {
    expect({ ...holding(world.right), records: heldSlot(world.right, 0) }).toEqual({
      slots: { 0: "Game's own keys" },
      running: 0,
      records: expectedSlot(editedPlan, 'right', 0),
    });
  });

  it('the left unit still holds the first layout in slot 1', () => {
    expect({ ...holding(world.left), records: heldSlot(world.left, 1) }).toEqual({
      slots: { 1: "Game's own keys" },
      running: 1,
      records: expectedSlot(appliedPlan, 'left', 1),
    });
  });

  it('the store holds the edited plan as the applied one', async () => {
    expect(await world.app.data.getApplied(before.id)).toEqual(editedPlan);
  });

  it('the pill is back to In sync', () => {
    expect(world.state.sync).toEqual({ label: 'In sync', tone: 'ok' });
  });

  it('the windows were told nothing half-done while Apply wrote: one pill, In sync', () => {
    expect(world.states.slice(toldBefore).map((state) => state.sync.label)).toEqual(['In sync']);
  });

  it('the first Apply put the six keys it dealt into the scheme, which had none', () => {
    expect([Object.keys(ledgerBeforeApply).length, ledgerAfterApply]).toEqual([
      0,
      appliedPlan.ledger,
    ]);
  });

  it('the keys the plan dealt are six, one for each action placed', () => {
    expect(Object.keys(appliedPlan.ledger)).toHaveLength(6);
  });
});
