// What is still to be set by hand in the game survives a restart, because it is worked out from
// what is on disk: the plan applied last, and the bindings the game holds (its baseline, moved only
// by Done). An apply leaves a binding to set in Helldivers 2's own controls (its file isn't
// written); the app restarts and the reminder is the same; Done moves the baseline, which also
// survives a restart, and the next change is said from it.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameBinding, KeptSheet, Scheme } from '@helmarray/core';
import type { ApplyPreview } from '../../packages/app/src/shared/api';
import { assign } from '../../packages/app/src/renderer/screens/editor-model';
import { HELLDIVERS2, World } from './support/world';

describe('the bind sheet reminder and the game’s baseline across restarts', () => {
  let world: World;
  let scheme: Scheme;
  let preview: ApplyPreview;
  let afterRestart: KeptSheet[];
  let afterDone: KeptSheet[];
  let baselineAfterRestart: GameBinding[] | null;
  let appliedBindings: GameBinding[];
  let nextPreview: ApplyPreview;
  let afterNextApply: KeptSheet[];

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    scheme = await world.createKeysScheme();
    expect((await world.previewAndApply(scheme.id)).result.ok).toBe(true);
    // Fire onto a button with no key of the game's own: the game is to be told its new key.
    await world.edit(scheme.id, (s, game) =>
      assign(s, { mode: 'default', control: 'R.index_2', press: 'tap' }, 'fire_primary', game),
    );
    const applied = await world.previewAndApply(scheme.id);
    expect(applied.result.ok).toBe(true);
    preview = applied.preview;
    expect(preview.game.rows.length).toBeGreaterThan(0);
    appliedBindings = (await world.app.data.getApplied(scheme.id))?.gameBindings ?? [];

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
    baselineAfterRestart = await world.app.data.heldBindings(HELLDIVERS2);

    // Fire on another button now: said from where the game holds it since Done.
    await world.edit(scheme.id, (s, game) =>
      assign(s, { mode: 'default', control: 'R.index_3', press: 'tap' }, 'fire_primary', game),
    );
    const next = await world.previewAndApply(scheme.id);
    expect(next.result.ok).toBe(true);
    nextPreview = next.preview;
    await world.idle();
    afterNextApply = world.state.sheets;
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('is still there after a restart, with exactly the rows the drawer showed', () => {
    expect(afterRestart).toEqual([
      { gameId: HELLDIVERS2, gameName: 'Helldivers 2', rows: preview.game.rows },
    ]);
  });

  it('goes with Done', () => {
    expect(afterDone).toEqual([]);
  });

  it('Done moved the baseline to what was applied, and it survives a restart', () => {
    expect(baselineAfterRestart).toEqual(appliedBindings);
  });

  it('the next change is said from the baseline: the reminder is exactly what the drawer showed', () => {
    expect(afterNextApply).toEqual([
      { gameId: HELLDIVERS2, gameName: 'Helldivers 2', rows: nextPreview.game.rows },
    ]);
  });
});
