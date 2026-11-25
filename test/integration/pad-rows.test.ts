// Controller bindings Elite's file can't hold, through the services as index.ts wires them. A player
// with no file of their own: helmArray makes Custom.4.1.binds from the game's keyboard and mouse
// preset (a copy of reference/game-files/elite-KeyboardMouseOnly.binds, in a Steam library in a
// temp folder), and that preset has no controller in it, so no device id for one. *Xbox
// controller* with an action dragged onto a left button, and the keyboard in the setup with Boost
// on B: the units are written, Boost goes into the new file, and the controller button is set by
// hand, listed apart (the drawer's sentence is the renderer's, applyFlow.test.ts and the e2e). The baseline moves for what was written only, so the
// Library's reminder keeps the controller button until *Done*.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameBinding, KeptSheet, Plan, Scheme } from '@helmarray/core';
import { harvestEliteBinds } from '@helmarray/games';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drop } from '../../packages/app/src/renderer/screens/editor-model';
import type { ApplyPreview, ApplyResult } from '../../packages/app/src/shared/api';
import { World } from './support/world';

const SHIPPED_BYTES = await readFile(
  new URL('../../reference/game-files/elite-KeyboardMouseOnly.binds', import.meta.url),
);
const ELITE = 'elite-dangerous';
const FIRE = 'PrimaryFire';
const BOOST = 'UseBoostJuice';
const START =
  'KeyboardMouseOnly\r\nKeyboardMouseOnly\r\nKeyboardMouseOnly\r\nKeyboardMouseOnly\r\n';

describe('Elite with no file of its own, on Xbox controller with a controller button dragged on', () => {
  let world: World;
  let custom: string;
  let plan: Plan;
  let scheme: Scheme;
  let preview: ApplyPreview;
  let result: ApplyResult;
  let held: GameBinding[] | null;
  let sheets: KeptSheet[];

  beforeAll(async () => {
    world = await World.create({
      steam: [
        { appId: '359320', name: 'Elite Dangerous', installDir: 'Elite Dangerous', onDisk: true },
      ],
    });
    const bindings = join(
      world.localAppData,
      'Frontier Developments',
      'Elite Dangerous',
      'Options',
      'Bindings',
    );
    await mkdir(bindings, { recursive: true });
    await writeFile(join(bindings, 'StartPreset.4.start'), START);
    const schemes = join(
      world.installDirOf('Elite Dangerous'),
      'Products',
      'elite-dangerous-odyssey-64',
      'ControlSchemes',
    );
    await mkdir(schemes, { recursive: true });
    await writeFile(join(schemes, 'KeyboardMouseOnly.binds'), SHIPPED_BYTES);
    custom = join(bindings, 'Custom.4.1.binds');
    await world.boot();

    const made = await world.createScheme('xbox', ELITE);
    const game = await world.game(ELITE);
    const button = Object.keys(made.padMap).find((c) => c.startsWith('L.'));
    if (button === undefined) throw new Error('The preset sends nothing from the left unit.');
    const withKeyboard: Scheme = { ...made, devices: { ...made.devices, keyboard: true } };
    const placed = drop(
      drop(withKeyboard, 'ship', button, FIRE, undefined, game),
      'ship',
      'key.B',
      BOOST,
      undefined,
      game,
    );
    await world.helm.saveScheme(placed);
    scheme = await world.keepFindings(made.id);
    plan = await world.planOf(scheme);
    ({ preview, result } = await world.previewAndApply(scheme.id));
    await world.idle();
    held = await world.app.data.heldBindings(ELITE);
    sheets = world.state.sheets.filter((s) => s.gameId === ELITE);
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('has a controller button to bind, and Boost on B, in the plan', () => {
    const row = (action: string, set: GameBinding['set']) =>
      plan.gameBindings.find((b) => b.action === action && b.set === set)?.signal;
    expect({
      file: plan.gameFile,
      fire: row(FIRE, 'controller')?.kind,
      boost: row(BOOST, 'keyboard'),
    }).toEqual({
      file: { format: 'elite-binds' },
      fire: 'pad',
      boost: { kind: 'key', code: 'B' },
    });
  });

  it('is ready, and lists the controller button apart, with the file making the rest', () => {
    expect({
      ready: preview.ready,
      failing: preview.checks.filter((c) => !c.ok),
      via: preview.game.via,
      boost: preview.game.rows.some((r) => r.action === BOOST && r.set === 'keyboard'),
      controller: preview.game.rows.filter((r) => r.set === 'controller'),
      padByHand: preview.game.padByHand?.map((r) => [r.set, r.action]),
    }).toEqual({
      ready: true,
      failing: [],
      via: 'file',
      boost: true,
      controller: [],
      padByHand: [['controller', FIRE]],
    });
  });

  it('writes both units, then makes the file', () => {
    expect({
      ok: result.ok,
      units: result.units.map((u) => u.status),
      file: result.gameFile?.ok,
    }).toEqual({ ok: true, units: ['applied', 'applied'], file: true });
  });

  it('puts Boost on B in the new file, and no controller in it', async () => {
    const text = await readFile(custom, 'utf8');
    const actions = harvestEliteBinds(text, { id: ELITE, name: 'Elite Dangerous' }).game.actions;
    const of = (id: string) => actions.find((a) => a.id === id)?.native;
    expect({ boost: of(BOOST)?.key, fire: of(FIRE)?.pad, pads: text.includes('GamePad_') }).toEqual(
      { boost: { kind: 'key', code: 'B' }, fire: undefined, pads: false },
    );
  });

  it('moves the baseline for what was written only', () => {
    expect(held).toEqual(
      plan.gameBindings.filter((b) => !(b.set === 'controller' && b.action === FIRE)),
    );
  });

  it('keeps the controller button on the Library’s reminder, until Done', async () => {
    const before = sheets.map((s) => s.rows.map((r) => [r.set, r.action]));
    await world.helm.dismissSheet(ELITE);
    await world.idle();
    expect([before, world.state.sheets.filter((s) => s.gameId === ELITE)]).toEqual([
      [[['controller', FIRE]]],
      [],
    ]);
  });
});
