// A setup of the left Azeron and the mouse, on Helldivers 2, end to end: Apply writes the left unit
// and nothing else. The right unit starts holding a layout of its own in two slots, running the
// second, so anything done to it (a write, a switch, a delete) would show.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Plan, Scheme } from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
  CYBORG2_RIGHT,
  helldivers2,
  resolve,
  unitOf,
  xboxControllerPreset,
} from '@helmarray/core';
import { encodeRecord, storedFromWritten, toHex, unitRecords } from '@helmarray/azeron';
import type { ApplyPreview, ApplyResult } from '../../packages/app/src/shared/api';
import { setDevices } from '../../packages/app/src/renderer/screens/editor-model';
import { isWrite } from './support/fake-hid';
import { World, expectedSlot, heldSlot, holding } from './support/world';

/** The right half of the Xbox controller preset, as slot 3 of a unit holds it. */
const RIGHT_OWN = unitRecords(
  unitOf(resolve(xboxControllerPreset(helldivers2), helldivers2, BUILT_IN_DEVICES), 'right'),
  CYBORG2_RIGHT,
).map((record) => storedFromWritten(encodeRecord(3, record)));
const LEFT_AND_MOUSE = {
  azerons: 'left',
  keyboard: false,
  mouse: true,
  controller: false,
} as const;

/** What the right unit holds, every slot's records in hex. */
const rightHolds = (world: World) =>
  Object.fromEntries(
    [...world.right.unit.slots].map(([n, slot]) => [
      n,
      { name: slot.name, records: [...slot.records].map(([id, r]) => [id, toHex(r)]) },
    ]),
  );

describe('left Azeron + mouse: Apply writes only the left unit', () => {
  let world: World;
  let scheme: Scheme;
  let plan: Plan;
  let rightBefore: ReturnType<typeof rightHolds>;
  let rightSentBefore: number;
  let preview: ApplyPreview;
  let result: ApplyResult;

  beforeAll(async () => {
    world = await World.create({
      right: {
        slots: { 0: { name: 'Default' }, 3: { name: 'Mine', records: RIGHT_OWN } },
        running: 3,
      },
    });
    await world.boot();
    // The precondition: the right unit holds two slots and runs the second, a real layout.
    expect([holding(world.right), (heldSlot(world.right, 3) ?? {})[1] !== undefined]).toEqual([
      { slots: { 0: 'Default', 3: 'Mine' }, running: 3 },
      true,
    ]);
    const created = await world.createScheme('xbox');
    scheme = await world.edit(created.id, (s, game) => setDevices(s, LEFT_AND_MOUSE, game));
    plan = await world.planOf(scheme);
    rightBefore = rightHolds(world);
    rightSentBefore = world.right.commands().length;
    ({ preview, result } = await world.previewAndApply(scheme.id));
    await world.idle();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('the plan has the left unit only', () => {
    expect(Object.keys(plan.units)).toEqual(['left']);
  });

  it('the preview is ready, writes a new slot on the left unit and nothing on the right', () => {
    expect([
      preview.ready,
      preview.left.write?.slot,
      preview.right.used,
      preview.right.write,
    ]).toEqual([true, 1, false, null]);
  });

  it('Apply says the left unit runs the layout, and names no other', () => {
    expect([result.ok, result.message, result.units.map((u) => u.hand)]).toEqual([
      true,
      'The left unit now runs the layout.',
      ['left'],
    ]);
  });

  it('the left unit holds the plan’s left half in slot 1 and runs it', () => {
    expect({ ...holding(world.left), records: heldSlot(world.left, 1) }).toEqual({
      slots: { 1: 'Xbox controller' },
      running: 1,
      records: expectedSlot(plan, 'left', 1),
    });
  });

  it('the right unit was sent no write, no switch and no delete', () => {
    expect(world.right.commands().slice(rightSentBefore).filter(isWrite)).toEqual([]);
  });

  it('the right unit’s slots are untouched: the same two, the same records, the same one running', () => {
    expect([rightHolds(world), world.right.unit.running]).toEqual([rightBefore, 3]);
  });

  it('the sync pill reads In sync, judging the left unit only', () => {
    expect(world.state.sync).toEqual({ label: 'In sync', tone: 'ok' });
  });
});

describe('left Azeron + mouse with the right unit unplugged', () => {
  let world: World;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    world.right.unplug();
    await world.until('the right chip to go', () =>
      world.state.devices.every((d) => d.hand !== 'right'),
    );
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('is ready, applies to the left unit, and the pill says In sync', async () => {
    const created = await world.createScheme('xbox');
    const scheme = await world.edit(created.id, (s, game) => setDevices(s, LEFT_AND_MOUSE, game));
    const { preview, result } = await world.previewAndApply(scheme.id);
    await world.idle();
    expect([preview.ready, result.ok, result.message, world.state.sync.label]).toEqual([
      true,
      true,
      'The left unit now runs the layout.',
      'In sync',
    ]);
  });
});
