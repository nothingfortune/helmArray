// J4 through the services as index.ts wires them: one button, a job in one of Elite's modes and
// another on foot, applied. The units are told one signal for the button, and the player's own
// .binds (a copy of reference/game-files, in a temp folder standing for %LOCALAPPDATA%) binds each
// mode's action to it. Read back from the file by Elite's own harvest, as the Game screen reads it.
// With the game's own keys: Landing gear in the ship, Jump on foot, on one key. As an Xbox
// controller (whose preset puts nothing of the ship on the left unit, from this player's file):
// Vertical thrusters in the SRV, Jump on foot, on one Xbox control.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModeId, Plan, Signal } from '@helmarray/core';
import { signalId } from '@helmarray/core';
import { harvestEliteBinds } from '@helmarray/games';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drop } from '../../packages/app/src/renderer/screens/editor-model';
import type { ApplyResult } from '../../packages/app/src/shared/api';
import { World } from './support/world';

const ELITE_BYTES = await readFile(
  new URL('../../reference/game-files/elite-Custom.4.1.binds', import.meta.url),
);
const ELITE = 'elite-dangerous';
const GEAR = 'LandingGearToggle';
const THRUSTERS = 'VerticalThrustersButton';
const JUMP = 'HumanoidJumpButton';

/** Steam lists Elite, and the player's own file is where the game keeps it. */
async function eliteWorld(): Promise<{ world: World; binds: string }> {
  const world = await World.create({
    steam: [{ appId: '359320', name: 'Elite Dangerous', installDir: 'Elite Dangerous' }],
  });
  const dir = join(
    world.localAppData,
    'Frontier Developments',
    'Elite Dangerous',
    'Options',
    'Bindings',
  );
  await mkdir(dir, { recursive: true });
  const binds = join(dir, 'Custom.4.1.binds');
  await writeFile(binds, ELITE_BYTES);
  await writeFile(join(dir, 'StartPreset.4.start'), 'Custom\r\nCustom\r\nCustom\r\nCustom');
  await world.boot();
  return { world, binds };
}

interface Applied {
  /** The left unit's button the preset put `other` on, given Jump on foot. */
  control: string;
  result: ApplyResult;
  plan: Plan | null;
  /** What the button's tap sends, as the unit was told. */
  sent: Signal | undefined;
  /** What the written file binds each action to, read back as the Game screen reads it. */
  file: Record<string, { key?: string; pad?: string }>;
}

/**
 * Elite from the preset; the left button it put `other` on (in its mode) given Jump on foot, by the
 * Editor's drop in On foot; the findings kept, as the drawer is reached; applied.
 */
async function j4(
  world: World,
  binds: string,
  preset: 'keys' | 'xbox',
  other: { mode: ModeId; action: string },
): Promise<Applied> {
  const made = await world.createScheme(preset, ELITE);
  const game = await world.game(ELITE);
  const control = Object.entries(made.map[other.mode] ?? {}).find(
    ([c, presses]) => c.startsWith('L.') && presses.tap === other.action,
  )?.[0];
  if (control === undefined) throw new Error(`${other.action} is on no left button.`);
  await world.helm.saveScheme(drop(made, 'foot', control, JUMP, undefined, game));
  const scheme = await world.keepFindings(made.id);
  const { result } = await world.previewAndApply(scheme.id);
  const plan = await world.app.data.getApplied(scheme.id);
  const read = harvestEliteBinds(await readFile(binds, 'utf8'), { id: ELITE, name: 'Elite' }).game;
  const words = (id: string) => {
    const native = read.actions.find((a) => a.id === id)?.native;
    return {
      ...(native?.key === undefined ? {} : { key: signalId(native.key) }),
      ...(native?.pad === undefined ? {} : { pad: native.pad }),
    };
  };
  return {
    control,
    result,
    plan,
    sent: plan?.units.left?.pins.find((p) => p.control === control)?.presses.tap,
    file: { [other.action]: words(other.action), [JUMP]: words(JUMP) },
  };
}

/** The modes the plan has the button's tap in, and the signals it is bound to across them. */
function across(got: Applied, modes: readonly ModeId[]) {
  const on = (got.plan?.bindings ?? []).filter(
    (b) => b.control === got.control && b.press === 'tap',
  );
  return {
    modes: on.map((b) => b.mode).filter((m) => modes.includes(m)),
    signals: [...new Set(on.map((b) => signalId(b.signal)))],
  };
}

describe('J4 on Elite with the game’s own keys: one key, a job in each mode', () => {
  let world: World;
  let got: Applied;

  beforeAll(async () => {
    const made = await eliteWorld();
    world = made.world;
    got = await j4(world, made.binds, 'keys', { mode: 'ship', action: GEAR });
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('applies to both units and the game’s file', () => {
    expect({
      ok: got.result.ok,
      units: got.result.units.map((u) => u.status),
      file: got.result.gameFile?.ok,
    }).toEqual({ ok: true, units: ['applied', 'applied'], file: true });
  });

  it('tells the unit one key for the button, and binds both modes’ actions to that key', () => {
    expect({
      sent: got.sent === undefined ? 'nothing' : signalId(got.sent),
      gear: got.file[GEAR]?.key,
      jump: got.file[JUMP]?.key,
      // Jump keeps the pad's own A beside it: only the keyboard set is the setup's.
      jumpPad: got.file[JUMP]?.pad,
    }).toEqual({ sent: 'key:+L', gear: 'key:+L', jump: 'key:+L', jumpPad: 'A' });
  });

  it('plans one signal for the button in every mode it carries an action in', () => {
    // The preset put a job in Fighter orders on it too, on the same key.
    expect(across(got, ['ship', 'foot'])).toEqual({
      modes: ['ship', 'foot'],
      signals: ['key:+L'],
    });
  });
});

describe('J4 on Elite as an Xbox controller: one Xbox control, a job in each mode', () => {
  let world: World;
  let got: Applied;

  beforeAll(async () => {
    const made = await eliteWorld();
    world = made.world;
    got = await j4(world, made.binds, 'xbox', { mode: 'srv', action: THRUSTERS });
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('tells the unit one Xbox control for the button, and binds both modes’ actions to it', () => {
    expect({
      ok: got.result.ok,
      sent: got.sent,
      thrusters: got.file[THRUSTERS]?.pad,
      jump: got.file[JUMP]?.pad,
    }).toEqual({ ok: true, sent: { kind: 'pad', control: 'B' }, thrusters: 'B', jump: 'B' });
  });

  it('plans one signal for the button in every mode it carries an action in', () => {
    expect(across(got, ['srv', 'foot'])).toEqual({
      modes: ['srv', 'foot'],
      signals: ['pad:B'],
    });
  });
});
