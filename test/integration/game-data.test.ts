// A game's data added and edited in the app (docs/plans/01-features.md, *Game data*), through
// `window.helm` over the real services and a fake pair of units: a game is added, a setup is made
// from it and applied; an action is then deleted from the game and the setup shows it as a
// finding, unchanged; and a built-in game edited in the app goes back to helmArray's.

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Finding, Game, Plan, Scheme } from '@helmarray/core';
import { helldivers2 } from '@helmarray/core';
import type { ApplyResult, GameEntry } from '../../packages/app/src/shared/api';
import { assign } from '../../packages/app/src/renderer/screens/editor-model';
import { HELLDIVERS2, World, expectedSlot, heldSlot } from './support/world';

/** A game helmArray doesn't ship, as the Game screen saves it: two actions with their own keys. */
const ROVER: Game = {
  id: 'rover',
  name: 'Rover',
  modes: [{ id: 'default', name: 'Default' }],
  actions: [
    {
      id: 'jump',
      name: 'Jump',
      mode: 'default',
      role: 'movement',
      required: false,
      native: { key: { kind: 'key', code: 'Space' }, pad: 'A' },
    },
    {
      id: 'reload',
      name: 'Reload',
      mode: 'default',
      role: 'combat',
      required: false,
      native: { key: { kind: 'key', code: 'R' }, pad: 'X' },
    },
  ],
};
const WITHOUT_JUMP: Game = { ...ROVER, actions: ROVER.actions.filter((a) => a.id !== 'jump') };

describe('a game added in the app: a setup from it, applied; then an action deleted', () => {
  let world: World;
  let listed: GameEntry[];
  let scheme: Scheme;
  let applied: Plan;
  let result: ApplyResult;
  let pillAfterApply: string;
  /** The setup as Apply left it (Apply keeps the keys it dealt in its ledger). */
  let beforeEdit: Scheme;
  let afterDelete: { plan: Plan; scheme: Scheme; ready: boolean; pill: string };

  beforeAll(async () => {
    world = await World.create();
    await world.boot();

    await world.helm.saveGame(ROVER);
    listed = await world.helm.listGames();

    // "Game's own keys", Jump put on the left index 1, and the stick findings kept.
    const created = await world.helm.createScheme('rover', 'keys');
    await world.helm.saveScheme(
      assign(created, { mode: 'default', control: 'L.index_1', press: 'tap' }, 'jump', ROVER),
    );
    scheme = await world.keepFindings(created.id);
    applied = await world.planOf(scheme);
    ({ result } = await world.previewAndApply(scheme.id));
    await world.idle();
    pillAfterApply = world.state.sync.label;
    beforeEdit = await world.scheme(scheme.id);

    // The game is edited: Jump is deleted. The setup is not touched.
    // Not `world.idle()`, which looks at the plans itself: saving the game must make the app look.
    await world.helm.saveGame(WITHOUT_JUMP);
    await world.until(
      'the pill to see the edited game',
      () => world.state.sync.label !== 'In sync',
    );
    const after = await world.scheme(scheme.id);
    afterDelete = {
      plan: await world.planOf(after),
      scheme: after,
      ready: (await world.helm.previewApply(scheme.id)).ready,
      pill: world.state.sync.label,
    };
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('lists the game added, after the built-in ones', () => {
    expect(listed.map((e) => [e.game.id, e.builtIn])).toEqual([
      [HELLDIVERS2, true],
      ['rover', false],
    ]);
  });

  it('applies the setup: the left unit sends Space, Jump’s own key, from index 1', () => {
    const pin = applied.units.left?.pins.find((p) => p.control === 'L.index_1');
    expect([result.ok, pin?.presses.tap]).toEqual([true, { kind: 'key', code: 'Space' }]);
  });

  it('writes that layout onto the left unit', () => {
    expect(heldSlot(world.left, 1)).toEqual(expectedSlot(applied, 'left', 1));
  });

  it('is in sync once applied', () => {
    expect(pillAfterApply).toBe('In sync');
  });

  it('leaves the setup as it was when the game loses an action: it still names Jump', () => {
    expect(afterDelete.scheme).toEqual(beforeEdit);
  });

  it('shows the deleted action as a finding on the button that carried it', () => {
    expect(afterDelete.plan.findings.filter((f) => f.rule === 'action-deleted')).toEqual<Finding[]>(
      [
        {
          rule: 'action-deleted',
          severity: 'warning',
          control: 'L.index_1',
          mode: 'default',
          action: 'jump',
          message: 'The action on this button was deleted from Rover, so pressing it does nothing.',
        },
      ],
    );
  });

  it('no longer sends Space from that button', () => {
    const pin = afterDelete.plan.units.left?.pins.find((p) => p.control === 'L.index_1');
    expect(pin?.presses).toEqual({});
  });

  it('says the units differ from the setup now, and Apply is still ready: it is only a warning', () => {
    expect([afterDelete.pill, afterDelete.ready]).toEqual(['1 change not applied', true]);
  });
});

describe('a built-in game edited in the app, then back to helmArray’s', () => {
  let world: World;
  let edited: GameEntry | undefined;
  let fileWhileEdited: string[];
  let restored: GameEntry | undefined;
  let fileAfter: string[];

  const mine: Game = {
    ...helldivers2,
    name: 'My Helldivers',
    actions: helldivers2.actions.filter((a) => a.id !== 'emote'),
  };

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    await world.helm.saveGame(mine);
    edited = (await world.helm.listGames()).find((e) => e.game.id === HELLDIVERS2);
    await world.quit(); // quitting writes the edit
    fileWhileEdited = await readdir(join(world.dataDir, 'games'));
    await world.boot();
    await world.helm.deleteGame(HELLDIVERS2);
    restored = (await world.helm.listGames()).find((e) => e.game.id === HELLDIVERS2);
    fileAfter = await readdir(join(world.dataDir, 'games'));
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('is your copy, in the built-in game’s place, marked as edited', () => {
    expect([edited?.game.name, edited?.builtIn, edited?.edited]).toEqual([
      'My Helldivers',
      true,
      true,
    ]);
  });

  it('is kept under the built-in game’s id', () => {
    expect(fileWhileEdited).toEqual([`${HELLDIVERS2}.json`]);
  });

  it('goes back to helmArray’s own: the game as it ships, not marked as edited', () => {
    expect(restored).toEqual({ game: helldivers2, builtIn: true });
  });

  it('drops your copy’s file', () => {
    expect(fileAfter).toEqual([]);
  });
});

describe('a game added by hand, active, then deleted', () => {
  let world: World;
  let schemeId: string;
  let after: {
    games: string[];
    library: (string | null)[];
    active: string | null;
    pill: string;
    preview: { ready: boolean; checks: string[] };
    schemes: string[];
  };

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    await world.helm.saveGame(ROVER);
    schemeId = (await world.helm.createScheme('rover', 'keys')).id;
    await world.helm.setActive('rover', schemeId);
    await world.helm.deleteGame('rover');
    // Not `world.idle()`, which looks at the plans itself: the delete must make the app look.
    await world.until('the app to see no game active', () => world.state.activeGameId === null);
    const preview = await world.helm.previewApply(schemeId);
    after = {
      games: (await world.helm.listGames()).map((e) => e.game.id),
      library: (await world.helm.listLibrary()).map((e) => e.gameId),
      active: world.state.activeGameId,
      pill: world.state.sync.label,
      preview: { ready: preview.ready, checks: preview.checks.map((c) => c.text) },
      schemes: (await world.helm.listSchemes('rover')).map((s) => s.id),
    };
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('is gone from the games and the Library', () => {
    expect([after.games, after.library]).toEqual([[HELLDIVERS2], [HELLDIVERS2]]);
  });

  it('keeps its scheme on disk', () => {
    expect(after.schemes).toEqual([schemeId]);
  });

  it('can’t be applied any more, and Apply says why', () => {
    expect(after.preview).toEqual({ ready: false, checks: [expect.stringMatching(/game/i)] });
  });

  it('leaves no game active, so the pill no longer judges a game that is gone', () => {
    expect([after.active, after.pill]).toEqual([null, 'Not checked yet']);
  });
});
