// Which unit is which hand. `hands.json` holds unit id to hand; the coordinator shows it on the
// chips, and Apply writes each half of the layout to the unit that is that hand. A unit with no
// saved hand is asked about, and the first of the two unplugged is the left one.

import { afterEach, describe, expect, it } from 'vitest';
import type { Hand } from '@helmarray/core';
import { World, LEFT_ID, RIGHT_ID, expectedSlot, heldSlot } from './support/world';

describe('hands.json', () => {
  const started: World[] = [];
  afterEach(async () => {
    await Promise.all(started.splice(0).map((world) => world.dispose()));
  });

  /** The app, started over a folder whose `hands.json` says `hands`. */
  const start = async (hands: Record<number, Hand> | null | 'unreadable'): Promise<World> => {
    const world = await World.create({ hands });
    started.push(world);
    await world.boot();
    return world;
  };

  it('puts the saved left id on the left chip and the saved right id on the right chip', async () => {
    const world = await start({ [LEFT_ID]: 'left', [RIGHT_ID]: 'right' });
    expect(world.state.devices.map((chip) => [chip.hand, chip.unitId])).toEqual([
      ['left', LEFT_ID],
      ['right', RIGHT_ID],
    ]);
  });

  it('puts the ids the other way round when the file says so', async () => {
    const world = await start({ [LEFT_ID]: 'right', [RIGHT_ID]: 'left' });
    expect(world.state.devices.map((chip) => [chip.hand, chip.unitId])).toEqual([
      ['left', RIGHT_ID],
      ['right', LEFT_ID],
    ]);
  });

  it('writes the left half of a layout to the unit saved as left, even when that is the second one', async () => {
    const world = await start({ [LEFT_ID]: 'right', [RIGHT_ID]: 'left' });
    const scheme = await world.createKeysScheme();
    const plan = await world.planOf(scheme);
    // The two halves are different layouts, or a half on the wrong unit would not show.
    expect(expectedSlot(plan, 'left', 1)).not.toEqual(expectedSlot(plan, 'right', 1));
    await world.previewAndApply(scheme.id);
    expect([heldSlot(world.right, 1), heldSlot(world.left, 1)]).toEqual([
      expectedSlot(plan, 'left', 1),
      expectedSlot(plan, 'right', 1),
    ]);
  });

  it('with only one unit saved, the other is the opposite hand and is saved too', async () => {
    const world = await start({ [RIGHT_ID]: 'right' });
    expect(await world.savedHands()).toEqual({ [LEFT_ID]: 'left', [RIGHT_ID]: 'right' });
  });

  it('with only one unit saved, the other one is shown as that opposite hand', async () => {
    const world = await start({ [RIGHT_ID]: 'right' });
    expect(world.state.devices.map((chip) => [chip.hand, chip.unitId])).toEqual([
      ['left', LEFT_ID],
      ['right', RIGHT_ID],
    ]);
  });

  it('with nothing saved, neither unit has a hand and the question is to unplug the left one', async () => {
    const world = await start(null);
    expect([world.state.devices.map((chip) => chip.hand), world.state.question?.kind]).toEqual([
      ['unknown', 'unknown'],
      'press',
    ]);
  });

  it('with nothing saved, the drawer says helmArray does not know which is the left one', async () => {
    const world = await start(null);
    const scheme = await world.createKeysScheme();
    const preview = await world.helm.previewApply(scheme.id);
    expect(preview.checks.filter((check) => !check.ok).map((check) => check.text)).toEqual([
      "helmArray doesn't know yet which Azeron is the left one.",
      "helmArray doesn't know yet which Azeron is the right one.",
    ]);
  });

  it('with nothing saved, the unit unplugged for the question is the left one, and the file says so', async () => {
    const world = await start(null);
    // The unit with the right id is the one the owner unplugs, so the order of the ids and the
    // order of the units cannot be what decides it.
    world.right.unplug();
    // The unit left behind is told it is the right one once both hands are saved.
    await world.until('the unit left behind to be the right hand', () =>
      world.state.devices.every((chip) => chip.hand === 'right'),
    );
    expect(await world.savedHands()).toEqual({ [RIGHT_ID]: 'left', [LEFT_ID]: 'right' });
  });

  it('that cannot be read does not stop the app: the units are asked about again', async () => {
    const world = await start('unreadable');
    expect([world.state.devices.map((chip) => chip.hand), world.state.question?.kind]).toEqual([
      ['unknown', 'unknown'],
      'press',
    ]);
  });

  it('that cannot be read is said in the log', async () => {
    const world = await start('unreadable');
    const lines = await world.logLines();
    expect(
      lines.filter((line) => line.includes("[(app)] the saved hands couldn't be read")),
    ).toHaveLength(1);
  });
});
