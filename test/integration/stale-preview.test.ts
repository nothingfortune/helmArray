// The drawer was opened, then the scheme was edited, then Apply was pressed with what the drawer
// had shown. The person agreed to the layout they saw, not to another: Apply refuses, writes
// nothing, and says to look again.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assign } from '../../packages/app/src/renderer/screens/editor-model';
import type { ApplyPreview, ApplyResult } from '../../packages/app/src/shared/api';
import { isWrite } from './support/fake-hid';
import { World, holding } from './support/world';

describe('a preview that is stale when Apply is pressed', () => {
  let world: World;
  let schemeId: string;
  let shown: ApplyPreview;
  let shownAgain: ApplyPreview;
  let result: ApplyResult;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    const scheme = await world.createKeysScheme();
    schemeId = scheme.id;
    shown = await world.helm.previewApply(schemeId);
    // Something else is put on a button after the drawer opened.
    await world.edit(schemeId, (current, game) =>
      assign(current, { mode: 'default', control: 'R.index_3', press: 'tap' }, 'reload', game),
    );
    shownAgain = await world.helm.previewApply(schemeId);
    result = await world.helm.apply(schemeId, shown.fingerprint);
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('the edit changed what the preview stands for', () => {
    expect(shownAgain.fingerprint).not.toBe(shown.fingerprint);
  });

  it('Apply refuses, says the layout changed, and attempted no unit', () => {
    expect(result).toEqual({
      ok: false,
      changed: true,
      message: 'The layout changed since the preview: look again.',
      units: [],
    });
  });

  it('no write reached either unit', () => {
    expect([world.left, world.right].map((unit) => unit.commands().filter(isWrite))).toEqual([
      [],
      [],
    ]);
  });

  it('both units still hold only their stock slot', () => {
    expect([holding(world.left), holding(world.right)]).toEqual([
      { slots: { 0: 'Default' }, running: 0 },
      { slots: { 0: 'Default' }, running: 0 },
    ]);
  });

  it('nothing is recorded as applied', async () => {
    expect(await world.app.data.getApplied(schemeId)).toBeNull();
  });

  it('pressing Apply with the fingerprint of the new preview goes through', async () => {
    const second = await world.helm.apply(schemeId, shownAgain.fingerprint);
    expect(second.ok).toBe(true);
  });
});
