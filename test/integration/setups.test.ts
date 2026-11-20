// Several setups of one game, end to end through `window.helm`: copy one, switch to it and apply it,
// the Library's status line, deleting the setup the game holds, and a setup with no Azeron at all.
// The edits are the editor's own functions, saved the way the editor saves them.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Scheme } from '@helmarray/core';
import type { ApplyPreview, ApplyResult, LibraryEntry } from '../../packages/app/src/shared/api';
import {
  assign,
  setDevices,
  setOutput,
} from '../../packages/app/src/renderer/screens/editor-model';
import { isWrite } from './support/fake-hid';
import { HELLDIVERS2, World, holding } from './support/world';

const entryOf = async (world: World): Promise<LibraryEntry | undefined> =>
  (await world.helm.listLibrary()).find((e) => e.gameId === HELLDIVERS2);

describe('two setups of Helldivers 2: the copy is switched to, applied, and the Library follows', () => {
  let world: World;
  let desk: Scheme;
  let copy: Scheme;
  let afterFirst: LibraryEntry | undefined;
  let afterEdit: LibraryEntry | undefined;
  let afterSecond: LibraryEntry | undefined;
  let second: ApplyResult;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    desk = await world.createScheme('xbox');
    await world.helm.setActive(HELLDIVERS2, desk.id);
    expect((await world.previewAndApply(desk.id)).result.ok).toBe(true);
    afterFirst = await entryOf(world);

    copy = await world.helm.copyScheme(desk.id);
    await world.edit(copy.id, (s, game) => setOutput(s, 'keys', game));
    afterEdit = await entryOf(world);
    // Switching is picking it: it becomes the active one, which the pill judges.
    await world.helm.setActive(HELLDIVERS2, copy.id);
    ({ result: second } = await world.previewAndApply(copy.id));
    await world.idle();
    afterSecond = await entryOf(world);
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('the copy is a second setup of the game, named after the first', () => {
    expect([copy.gameId, copy.name, copy.id === desk.id]).toEqual([
      HELLDIVERS2,
      'Xbox controller copy',
      false,
    ]);
  });

  it('the Library has the first setup applied, with nothing changed since', () => {
    expect(afterFirst?.applied).toMatchObject({ schemeId: desk.id, changes: 0 });
  });

  it('an edit to a setup not applied leaves the applied one unchanged in the Library', () => {
    expect([afterEdit?.applied?.schemeId, afterEdit?.applied?.changes]).toEqual([desk.id, 0]);
  });

  it('applying the other setup writes both units with it, and the pill reads In sync', () => {
    expect([
      second.ok,
      holding(world.left).slots,
      holding(world.right).slots,
      world.state.sync.label,
      // A unit keeps 19 characters of a name.
    ]).toEqual([true, { 0: 'Xbox controller cop' }, { 0: 'Xbox controller cop' }, 'In sync']);
  });

  it('the Library then names the copy as applied, and lists both setups with what they play with', () => {
    expect([
      afterSecond?.applied?.schemeId,
      afterSecond?.activeSchemeId,
      afterSecond?.schemes.map((s) => [s.name, s.output, s.devices.azerons]),
    ]).toEqual([
      copy.id,
      copy.id,
      [
        ['Xbox controller', 'pad', 'both'],
        ['Xbox controller copy', 'keys', 'both'],
      ],
    ]);
  });
});

describe('deleting the setup a game holds', () => {
  let world: World;
  let held: Scheme;
  let other: Scheme;
  let preview: ApplyPreview;
  let entry: LibraryEntry | undefined;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    other = await world.createScheme('xbox');
    held = await world.helm.copyScheme(other.id);
    // The held setup moves Reload from X to RB; the game holds that once it is applied.
    held = await world.edit(held.id, (s, game) =>
      assign(s, { mode: 'default', control: 'L.index_1', press: 'tap' }, 'reload', game),
    );
    await world.helm.setActive(HELLDIVERS2, held.id);
    expect((await world.previewAndApply(held.id)).result.ok).toBe(true);
    await world.helm.deleteScheme(held.id);
    await world.idle();
    entry = await entryOf(world);
    preview = await world.helm.previewApply(other.id);
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('the setup is gone, and the game has no active setup', () => {
    expect([entry?.schemes.map((s) => s.id), entry?.activeSchemeId, entry?.applied]).toEqual([
      [other.id],
      null,
      null,
    ]);
  });

  it('the other setup’s Apply still says to put Reload back: the game holds the deleted one', () => {
    expect(
      preview.game.rows.filter((r) => r.action === 'reload').map((r) => [r.from, r.to]),
    ).toEqual([
      [
        { kind: 'pad', control: 'RB' },
        { kind: 'pad', control: 'X' },
      ],
    ]);
  });
});

describe('a setup of the keyboard and mouse only', () => {
  let world: World;
  let preview: ApplyPreview;
  let result: ApplyResult;
  let sentBefore: { left: number; right: number };

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    const created = await world.createScheme('keys');
    const keyboard = { azerons: 'none', keyboard: true, mouse: true, controller: false } as const;
    // Reload goes on T: the game ships it on R.
    const scheme = await world.edit(created.id, (s, game) =>
      assign(
        setDevices(s, keyboard, game),
        { mode: 'default', control: 'key.T', press: 'tap' },
        'reload',
        game,
      ),
    );
    await world.helm.setActive(HELLDIVERS2, scheme.id);
    sentBefore = {
      left: world.left.commands().length,
      right: world.right.commands().length,
    };
    ({ preview, result } = await world.previewAndApply(scheme.id));
    await world.idle();
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('the preview is ready with no unit and no Azeron app to ask about', () => {
    expect([
      preview.ready,
      preview.left.used,
      preview.right.used,
      preview.checks.map((c) => c.text),
    ]).toEqual([true, false, false, ['The scheme has no errors.']]);
  });

  it('the drawer’s game half is a bind sheet with Reload on T', () => {
    expect([
      preview.game.via,
      preview.game.rows.filter((r) => r.action === 'reload').map((r) => [r.set, r.from, r.to]),
    ]).toEqual(['sheet', [['keyboard', { kind: 'key', code: 'R' }, { kind: 'key', code: 'T' }]]]);
  });

  it('Apply succeeds and writes nothing to either unit', () => {
    expect([
      result.ok,
      world.left.commands().slice(sentBefore.left).filter(isWrite),
      world.right.commands().slice(sentBefore.right).filter(isWrite),
      result.units,
    ]).toEqual([true, [], [], []]);
  });
});
