// J1 end to end: a scheme from the Xbox controller preset on Helldivers 2 is previewed, applied
// and verified, through `window.helm`, over the real services and a fake pair of units.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApplyPreview, ApplyResult } from '../../packages/app/src/shared/api';
import type { Plan, Scheme } from '@helmarray/core';
import { UNIT_KEY_CODES, decodeStoredRecord } from '@helmarray/azeron';
import { isWrite } from './support/fake-hid';
import type { PluggedUnit } from './support/fake-hid';
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

  it('the preview lists no game binding to set: the preset starts from what the game ships', () => {
    expect(preview.game).toEqual({ via: 'sheet', rows: [] });
  });

  it('the plan rebinds the game’s controller set only, every action where the game ships it', () => {
    expect([[...new Set(plan.gameBindings.map((b) => b.set))], plan.bindSheet]).toEqual([
      ['controller'],
      [],
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

// A scheme with errors nobody kept. Neither preset has any on Helldivers 2 now (the game ships its
// pad defaults, and the game's own keys preset places every action), so this uses a game's own
// keys scheme as that preset made it before it placed anything: it has the six missing required
// actions, and its two sticks send nothing.
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
    const fresh = await world.createBlankKeysScheme();
    const preview = await world.helm.previewApply(fresh.id);
    expect(preview.checks.filter((check) => !check.ok).map((check) => check.text)).toEqual([
      'Move forward is needed to play Default, and it is on no button.',
      'Move back is needed to play Default, and it is on no button.',
      'Strafe left is needed to play Default, and it is on no button.',
      'Strafe right is needed to play Default, and it is on no button.',
      'Fire is needed to play Default, and it is on no button.',
      'Stratagem (hold) is needed to play Default, and it is on no button.',
      // Key output with nothing placed: the sticks have no keys either.
      'The left stick sends nothing: give its directions keys or set it to a controller stick.',
      'The right stick sends nothing: give its directions keys or set it to a controller stick.',
    ]);
  });

  it('is refused by Apply itself, whatever the drawer showed', async () => {
    const fresh = await world.createBlankKeysScheme();
    const preview = await world.helm.previewApply(fresh.id);
    const result = await world.helm.apply(fresh.id, preview.fingerprint);
    expect([result.ok, result.units]).toEqual([false, []]);
  });

  it('writes nothing to either unit when Apply is pressed on it, though both were read', async () => {
    const fresh = await world.createBlankKeysScheme();
    const preview = await world.helm.previewApply(fresh.id);
    await world.helm.apply(fresh.id, preview.fingerprint);
    const sent = [world.left, world.right].map((unit) => unit.commands());
    expect(sent.map((commands) => [commands.length > 0, commands.filter(isWrite)])).toEqual([
      [true, []],
      [true, []],
    ]);
  });
});

describe('J1: the Xbox controller preset, with nothing to keep', () => {
  let world: World;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('is ready to apply as it is made, with no check failing', async () => {
    const fresh = await world.createScheme('xbox');
    const preview = await world.helm.previewApply(fresh.id);
    expect({
      ready: preview.ready,
      failing: preview.checks.filter((check) => !check.ok).map((check) => check.text),
    }).toEqual({ ready: true, failing: [] });
  });
});

// J1 by the game's own keys: the preset puts Helldivers 2's actions on the units, each on the key
// the game ships it on, so it is ready as it is made and needs nothing set in the game.
describe("J1: the game's own keys preset on Helldivers 2, applied", () => {
  let world: World;
  let plan: Plan;
  let preview: ApplyPreview;
  let result: ApplyResult;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    const created = await world.createScheme('keys');
    plan = await world.planOf(created);
    ({ preview, result } = await world.previewAndApply(created.id));
  });

  afterAll(async () => {
    await world.dispose();
  });

  /** The key codes a unit's slot taps send, sorted. */
  const tapped = (unit: PluggedUnit, slot: number): number[] =>
    [...(unit.unit.slots.get(slot)?.records.values() ?? [])]
      .map(decodeStoredRecord)
      .flatMap((r) => (r.kind === 'button' ? r.tap.keys.filter((k) => k !== 0) : []))
      .sort((a, b) => a - b);

  it('is ready as it is made: nothing to keep, nothing to set in the game', () => {
    expect({
      ready: preview.ready,
      failing: preview.checks.filter((check) => !check.ok).map((check) => check.text),
      game: preview.game,
    }).toEqual({ ready: true, failing: [], game: { via: 'sheet', rows: [] } });
  });

  it('writes both units, each holding its half of the plan', () => {
    expect({
      ok: result.ok,
      left: heldSlot(world.left, 1),
      right: heldSlot(world.right, 1),
    }).toEqual({
      ok: true,
      left: expectedSlot(plan, 'left', 1),
      right: expectedSlot(plan, 'right', 1),
    });
  });

  it('has the units send the key the game ships each action on that is on a key', async () => {
    const game = await world.game();
    const keys = plan.bindings.flatMap((b) => {
      const native = game.actions.find((a) => a.id === b.action)?.native?.key;
      return native?.kind === 'key' ? [UNIT_KEY_CODES[native.code]] : [];
    });
    expect([...tapped(world.left, 1), ...tapped(world.right, 1)].sort((a, b) => a - b)).toEqual(
      expect.arrayContaining(keys),
    );
    // Every action on a button but Fire and Aim, which the game ships on mouse buttons.
    expect(keys).toHaveLength(22);
  });

  it('has the left stick send W, S, A and D', () => {
    const stick = [...(world.left.unit.slots.get(1)?.records.values() ?? [])]
      .map(decodeStoredRecord)
      .find((r) => r.kind === 'stick');
    // The left block: the one a left unit's stick reads. Each direction is a key and no modifier.
    expect(stick?.kind === 'stick' ? stick.directions : undefined).toMatchObject({
      'left.up': [UNIT_KEY_CODES.W, 0, 0],
      'left.down': [UNIT_KEY_CODES.S, 0, 0],
      'left.left': [UNIT_KEY_CODES.A, 0, 0],
      'left.right': [UNIT_KEY_CODES.D, 0, 0],
    });
  });
});
