// A scheme made before its game's file was first read, through the services as index.ts wires
// them. Everspace 2 typed in on the Game screen (no file format), Boost [HOLD] put on a button with
// no key of its own: the pool deals it one, the scheme is applied, and its game binding is on the
// bind sheet, not done yet. Then *Read from the game's file* (a copy of
// reference/game-files/everspace2-Input.before.ini, in a temp folder) gives the game its format:
// the scheme writes the game's file from then on, sending what it sent, and the Library still
// lists what is left to set until Apply writes the file.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Game, KeptSheet, Plan, Scheme } from '@helmarray/core';
import { mergeHarvest } from '@helmarray/core';
import { harvestUnrealIni } from '@helmarray/games';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assign } from '../../packages/app/src/renderer/screens/editor-model';
import { addAction, newGame, usesOf } from '../../packages/app/src/renderer/screens/game-model';
import type { ApplyPreview, ApplyResult } from '../../packages/app/src/shared/api';
import { World } from './support/world';

const ES2_BYTES = await readFile(
  new URL('../../reference/game-files/everspace2-Input.before.ini', import.meta.url),
);

/** What each unit button sends, by control. */
const sends = (plan: Plan) =>
  [...(plan.units.left?.pins ?? []), ...(plan.units.right?.pins ?? [])].map((p) => [
    p.control,
    p.presses,
  ]);

describe("Everspace 2 typed in, a scheme applied, then its file read: the scheme writes the game's file from then on", () => {
  let world: World;
  let ini: string;
  let typed: Game;
  let scheme: Scheme;
  let planBefore: Plan;
  let remindedBefore: KeptSheet[];
  let schemeAfter: Scheme;
  let planAfter: Plan;
  let remindedAfterRead: KeptSheet[];
  let preview: ApplyPreview;
  let result: ApplyResult;
  let remindedAfterApply: KeptSheet[];

  beforeAll(async () => {
    world = await World.create({
      steam: [{ appId: '1128920', name: 'EVERSPACE™ 2', installDir: 'EVERSPACE 2' }],
    });
    const dir = join(world.localAppData, 'ES2', 'Saved', 'Config', 'Windows');
    await mkdir(dir, { recursive: true });
    ini = join(dir, 'Input.ini');
    await writeFile(ini, ES2_BYTES);
    await world.boot();

    // *Set up* on its Steam tile, Boost typed in with no key: no file format yet.
    typed = addAction(newGame('Everspace 2', [], 1128920), 'default', 'Boost [HOLD]').game;
    await world.helm.saveGame(typed);
    await world.idle();
    const made = await world.helm.createScheme(typed.id, 'keys');
    await world.helm.saveScheme(
      assign(made, { mode: 'default', control: 'L.index_1', press: 'tap' }, 'boost_hold', typed),
    );
    await world.helm.setActive(typed.id, made.id);
    scheme = await world.keepFindings(made.id);
    await world.previewAndApply(scheme.id);
    await world.idle();
    planBefore = await world.planOf(await world.scheme(scheme.id));
    remindedBefore = world.state.sheets.filter((s) => s.gameId === typed.id);

    // *Read from the game's file*, merged as the Game screen does, and saved with the one button.
    const read = await world.helm.readGameFile(typed.id);
    if (!read.ok) throw new Error(read.message);
    const merged = mergeHarvest(
      typed,
      read.file,
      read.held,
      usesOf(await world.helm.listSchemes(typed.id)),
    );
    await world.helm.saveFileRead(merged.game, merged.moves);
    await world.idle();
    schemeAfter = await world.scheme(scheme.id);
    planAfter = await world.planOf(schemeAfter);
    remindedAfterRead = world.state.sheets.filter((s) => s.gameId === typed.id);

    // The read brings the game's own actions and rules: the player keeps what the checks find.
    await world.keepFindings(scheme.id);
    ({ preview, result } = await world.previewAndApply(scheme.id));
    await world.idle();
    remindedAfterApply = world.state.sheets.filter((s) => s.gameId === typed.id);
  });

  afterAll(async () => {
    await world.dispose();
  });

  it("before the read, doesn't write the file: Boost's key is on the bind sheet, to set by hand", () => {
    expect({
      writes: scheme.writeGameFile,
      file: planBefore.gameFile,
      reminded: remindedBefore.map((s) => s.rows.map((r) => r.actionName)),
    }).toEqual({ writes: false, file: undefined, reminded: [['Boost [HOLD]']] });
  });

  it("writes the game's file once the read gives the game its format", () => {
    expect([schemeAfter.writeGameFile, planAfter.gameFile, planAfter.bindSheet]).toEqual([
      true,
      { format: 'unreal-ini' },
      [],
    ]);
  });

  it('sends what it sent: every button keeps its key', () => {
    expect(sends(planAfter)).toEqual(sends(planBefore));
  });

  it("keeps Boost's game binding, the key the units send, under the file's id", () => {
    const boost = (plan: Plan, id: string) =>
      plan.gameBindings.find((b) => b.set === 'keyboard' && b.action === id)?.signal;
    expect([boost(planAfter, 'Boost'), boost(planAfter, 'Boost')?.kind]).toEqual([
      boost(planBefore, 'boost_hold'),
      'key',
    ]);
  });

  it('still lists Boost to set by hand after the read: nothing has written the file yet', () => {
    expect(remindedAfterRead.map((s) => s.rows.map((r) => [r.action, r.to]))).toEqual([
      [['Boost', planBefore.gameBindings.find((b) => b.action === 'boost_hold')?.signal]],
    ]);
  });

  it('writes the file on Apply, with the key the units send for Boost', async () => {
    const boost = harvestUnrealIni(await readFile(ini, 'utf8'), {
      id: typed.id,
      name: 'Everspace 2',
    }).game.actions.find((a) => a.id === 'Boost')?.native?.key;
    expect({
      via: preview.game.via,
      failing: preview.checks.filter((c) => !c.ok).map((c) => c.text),
      file: result.gameFile?.ok,
      boost,
    }).toEqual({
      via: 'file',
      failing: [],
      file: true,
      boost: planAfter.gameBindings.find((b) => b.action === 'Boost' && b.set === 'keyboard')
        ?.signal,
    });
  });

  it('moves the baseline and empties the Library’s reminder once the file is written', async () => {
    const held = (await world.app.data.heldBindings(typed.id)) ?? [];
    expect({
      boost: held.find((b) => b.action === 'Boost' && b.set === 'keyboard')?.signal,
      reminded: remindedAfterApply,
    }).toEqual({
      boost: planAfter.gameBindings.find((b) => b.action === 'Boost' && b.set === 'keyboard')
        ?.signal,
      reminded: [],
    });
  });
});
