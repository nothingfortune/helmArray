// The app is quit and started again over the same folders and the same units. What was applied,
// which scheme is the active one and the keys the layout was dealt are on disk and come back; the
// pill is worked out again from the units and the files, not remembered.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Plan, Scheme } from '@helmarray/core';
import { World, heldSlot, expectedSlot } from './support/world';

describe('a second start over the same folders', () => {
  let world: World;
  let scheme: Scheme;
  let plan: Plan;
  let ledgerBefore: Scheme['ledger'];
  let openedBeforeQuit: number;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    scheme = await world.createKeysScheme();
    plan = await world.planOf(scheme);
    await world.previewAndApply(scheme.id);
    ledgerBefore = (await world.scheme(scheme.id)).ledger;
    // Something to survive: keys were dealt, and the scheme is applied, active and in sync.
    expect([Object.keys(ledgerBefore).length, world.state.sync.label]).toEqual([6, 'In sync']);
    openedBeforeQuit = world.hid.opened().length;
    await world.quit();
    await world.boot();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('the first run let go of both units on the way out', () => {
    const closed = world.hid.events.filter((event) => event.op === 'close').length;
    expect(closed).toBe(openedBeforeQuit);
  });

  it('the second run opened both units again', () => {
    expect(world.hid.opened().length).toBe(openedBeforeQuit + 2);
  });

  it('the plan that was applied is still the applied one', async () => {
    expect(await world.app.data.getApplied(scheme.id)).toEqual(plan);
  });

  it('the scheme is still the active one of its game', () => {
    expect([world.state.activeGameId, world.state.activeSchemeId]).toEqual([
      'helldivers2',
      scheme.id,
    ]);
  });

  it('the keys the layout was dealt are still in the scheme', async () => {
    expect((await world.scheme(scheme.id)).ledger).toEqual(ledgerBefore);
  });

  it('the Library knows which scheme is on the units', async () => {
    const entry = (await world.helm.listLibrary(true)).find((e) => e.gameId === 'helldivers2');
    expect([entry?.appId, entry?.activeSchemeId, entry?.applied?.schemeId]).toEqual([
      '553850',
      scheme.id,
      scheme.id,
    ]);
  });

  it('the pill reads In sync, worked out again from the units', () => {
    expect(world.state.sync).toEqual({ label: 'In sync', tone: 'ok' });
  });

  it('the hands were remembered: both chips know their hand with nothing asked', () => {
    expect([world.state.devices.map((chip) => chip.hand), world.state.question]).toEqual([
      ['left', 'right'],
      null,
    ]);
  });

  it('the units still hold the layout', () => {
    expect([heldSlot(world.left, 1), heldSlot(world.right, 1)]).toEqual([
      expectedSlot(plan, 'left', 1),
      expectedSlot(plan, 'right', 1),
    ]);
  });
});

describe('a unit changed while the app was closed', () => {
  let world: World;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    const scheme = await world.createKeysScheme();
    await world.previewAndApply(scheme.id);
    expect(world.state.sync.label).toBe('In sync');
    await world.quit();
    // The Azeron app was used on the left unit meanwhile: it now runs another profile.
    world.left.unit.slots.set(0, { name: 'Spare', records: new Map() });
    world.left.unit.running = 0;
    await world.boot();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('the pill, worked out again, says the left unit differs', () => {
    expect(world.state.sync.label).toBe('Left unit differs');
  });
});
