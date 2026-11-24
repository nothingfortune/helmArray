// A game added by hand is deleted, and a new one is added whose name gives the same id. Nothing of
// the old game carries over: no reminder, no baseline making the drawer think the game already has
// a binding, no Library status, and the units' record of the old game's layout is never taken for
// the new game's.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Game, KeptSheet, Scheme } from '@helmarray/core';
import type { ApplyPreview, LibraryEntry } from '../../packages/app/src/shared/api';
import {
  currentCard,
  heldSchemes,
  statusLine,
} from '../../packages/app/src/renderer/screens/libraryView';
import type { CurrentCard } from '../../packages/app/src/renderer/screens/libraryView';
import { World } from './support/world';

const ID = 'quiet-skies';
const QUIET: Game = {
  id: ID,
  name: 'Quiet Skies',
  modes: [{ id: 'default', name: 'Default' }],
  actions: [
    {
      id: 'jump',
      name: 'Jump',
      mode: 'default',
      role: 'movement',
      required: false,
      native: { key: { kind: 'key', code: 'Space' } },
    },
  ],
};

/** A keyboard-only setup of the game with Jump on J, which the game ships on Space. */
const onJ = (scheme: Scheme): Scheme => ({
  ...scheme,
  devices: { azerons: 'none', keyboard: true, mouse: true, controller: false },
  map: { default: { 'key.J': { tap: 'jump' } } },
});

describe('a game added under the id of one deleted', () => {
  let world: World;
  let reminders: KeptSheet[];
  let preview: ApplyPreview;
  let entry: LibraryEntry | undefined;
  let status: string;
  let card: CurrentCard | null;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();

    // The old game: applied to both units, then with Jump on J, set in the game (Done).
    await world.helm.saveGame(QUIET);
    const units = await world.helm.createScheme(ID, 'keys');
    await world.helm.saveScheme({
      ...units,
      accepted: [
        { rule: 'stick-no-directions', control: 'L.stick', reason: 'No stick' },
        { rule: 'stick-no-directions', control: 'R.stick', reason: 'No stick' },
      ],
      map: { default: { 'L.index_1': { tap: 'jump' } } },
    });
    expect((await world.previewAndApply(units.id)).result.ok).toBe(true);
    const keyboard = await world.helm.createScheme(ID, 'keys');
    await world.helm.saveScheme(onJ(keyboard));
    expect((await world.previewAndApply(keyboard.id)).result.ok).toBe(true);
    await world.helm.dismissSheet(ID);
    await world.idle();
    expect(await world.app.data.heldBindings(ID)).not.toBeNull();

    await world.helm.deleteGame(ID);
    await world.idle();

    // The new game, the same name and so the same id.
    await world.helm.saveGame(QUIET);
    const fresh = await world.helm.createScheme(ID, 'keys');
    await world.helm.saveScheme(onJ(fresh));
    await world.helm.setActive(ID, fresh.id);
    await world.idle();
    reminders = world.state.sheets;
    preview = await world.helm.previewApply(fresh.id);
    entry = (await world.helm.listLibrary()).find((e) => e.gameId === ID);
    status = entry === undefined ? '' : statusLine(entry, heldSchemes(world.state)).text;
    card = currentCard(await world.helm.listLibrary(), world.state);
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('has no reminder of the old game’s', () => {
    expect(reminders).toEqual([]);
  });

  it('starts from what the game ships: the drawer says to set Jump to J, from Space', () => {
    expect(preview.game.rows.map((r) => [r.actionName, r.from, r.to])).toEqual([
      ['Jump', { kind: 'key', code: 'Space' }, { kind: 'key', code: 'J' }],
    ]);
  });

  it('has no baseline of the old game’s', async () => {
    expect(await world.app.data.heldBindings(ID)).toBeNull();
  });

  it('is not applied in the Library: picked, not applied', () => {
    expect([entry?.applied, status]).toEqual([null, 'Not applied · Keyboard and mouse']);
  });

  it('is not taken for what the units hold: the card says it is not applied yet', () => {
    expect([card?.entry.gameId, card?.applied, card?.detail]).toEqual([
      ID,
      false,
      'Not applied yet · Keyboard and mouse',
    ]);
  });

  it('has none of the old game’s retired ids: its file was the old game’s, and went with it', async () => {
    const game = (await world.helm.listGames()).find((g) => g.game.id === ID)?.game;
    expect(game?.retired).toBeUndefined();
  });
});
