// What is still to be set by hand in the game survives a restart: an apply leaves a binding to set
// in Helldivers 2's own controls (its file isn't written), the app is quit and started again over
// the same folder, and the reminder is still there, with the rows the drawer showed, until Done.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { KeptSheet } from '@helmarray/core';
import type { ApplyPreview } from '../../packages/app/src/shared/api';
import { assign } from '../../packages/app/src/renderer/screens/editor-model';
import { HELLDIVERS2, World } from './support/world';

describe('the bind sheet reminder across a restart', () => {
  let world: World;
  let preview: ApplyPreview;
  let afterRestart: KeptSheet[];
  let afterDone: KeptSheet[];
  let afterSecondRestart: KeptSheet[];

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    const scheme = await world.createKeysScheme();
    expect((await world.previewAndApply(scheme.id)).result.ok).toBe(true);
    // Fire onto a button with no key of the game's own: the game is to be told its new key.
    await world.edit(scheme.id, (s, game) =>
      assign(s, { mode: 'default', control: 'R.index_2', press: 'tap' }, 'fire_primary', game),
    );
    const applied = await world.previewAndApply(scheme.id);
    expect(applied.result.ok).toBe(true);
    preview = applied.preview;
    expect(preview.game.rows.length).toBeGreaterThan(0);

    await world.quit();
    await world.boot();
    await world.idle();
    afterRestart = world.state.sheets;
    await world.helm.dismissSheet(HELLDIVERS2);
    await world.idle();
    afterDone = world.state.sheets;
    await world.quit();
    await world.boot();
    await world.idle();
    afterSecondRestart = world.state.sheets;
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('is still there after a restart, with exactly the rows the drawer showed', () => {
    expect(afterRestart).toEqual([
      { gameId: HELLDIVERS2, gameName: 'Helldivers 2', rows: preview.game.rows },
    ]);
  });

  it('goes with Done, and stays gone after another restart', () => {
    expect([afterDone, afterSecondRestart]).toEqual([[], []]);
  });
});
