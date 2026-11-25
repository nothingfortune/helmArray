// Elite with no file of its own, through the services as index.ts wires them: StartPreset names a
// preset the game ships, and its install folder (a Steam library in a temp folder) holds that
// preset (a copy of reference/game-files/elite-KeyboardMouseOnly.binds). The Library knows Elite
// from the preset; Apply makes Custom.4.1.binds from it, writes the bindings into it and points
// StartPreset at it last. A failure at any step leaves StartPreset as it was and no new file; the
// game running refuses before anything is written; without the install folder, the bindings are
// set by hand as before.

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameBinding, Plan, Scheme, Signal } from '@helmarray/core';
import { harvestEliteBinds } from '@helmarray/games';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { GameFileDisk } from '../../packages/app/src/main/game-file-disk';
import { nodeGameFileDisk } from '../../packages/app/src/main/game-file-disk';
import { drop } from '../../packages/app/src/renderer/screens/editor-model';
import type { ApplyPreview, ApplyResult } from '../../packages/app/src/shared/api';
import { GAME_PROGRAMS, World } from './support/world';

const SHIPPED_BYTES = await readFile(
  new URL('../../reference/game-files/elite-KeyboardMouseOnly.binds', import.meta.url),
);
const ELITE = 'elite-dangerous';
const JUMP = 'HumanoidJumpButton';
const PROGRAM = GAME_PROGRAMS['elite-binds'];
const START =
  'KeyboardMouseOnly\r\nKeyboardMouseOnly\r\nKeyboardMouseOnly\r\nKeyboardMouseOnly\r\n';
const POINTED = 'Custom\r\nCustom\r\nCustom\r\nCustom\r\n';
const NOTE =
  "Elite Dangerous has no controls file of its own yet, so helmArray makes one from the game's keyboard and mouse preset and sets the game to use it.";
const DONE =
  "Elite Dangerous now has the scheme's controls, in a controls file of its own made from the game's keyboard and mouse preset.";
const LEFT = ', so the game was left as it was.';

interface Elite {
  world: World;
  bindings: string;
  start: string;
  custom: string;
  shipped: string;
}

/**
 * Steam lists Elite (in a library on disk when `installed`), the game has run (StartPreset names
 * its keyboard and mouse preset) and the player has no file of their own.
 */
async function eliteWorld(installed = true): Promise<Elite> {
  const world = await World.create({
    steam: [
      {
        appId: '359320',
        name: 'Elite Dangerous',
        installDir: 'Elite Dangerous',
        ...(installed ? { onDisk: true as const } : {}),
      },
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
  const start = join(bindings, 'StartPreset.4.start');
  await writeFile(start, START);
  const schemes = join(
    world.installDirOf('Elite Dangerous'),
    'Products',
    'elite-dangerous-odyssey-64',
    'ControlSchemes',
  );
  await mkdir(schemes, { recursive: true });
  const shipped = join(schemes, 'KeyboardMouseOnly.binds');
  await writeFile(shipped, SHIPPED_BYTES);
  await world.boot();
  return { world, bindings, start, custom: join(bindings, 'Custom.4.1.binds'), shipped };
}

/**
 * The game's own keys, from Elite's tile, with Jump on foot put on the left button that carries
 * the first ship action there: the file then has a binding to change. Its findings kept.
 */
async function ownKeys(world: World): Promise<Scheme> {
  const made = await world.createScheme('keys', ELITE);
  const game = await world.game(ELITE);
  const control = Object.entries(made.map['ship'] ?? {}).find(
    ([c, presses]) => c.startsWith('L.') && presses.tap !== undefined,
  )?.[0];
  if (control === undefined) throw new Error('The preset put nothing of the ship on the left.');
  await world.helm.saveScheme(drop(made, 'foot', control, JUMP, undefined, game));
  return world.keepFindings(made.id);
}

/** What is on disk: StartPreset, the new file (null when there is none), the shipped preset. */
async function onDisk(elite: Elite) {
  return {
    start: await readFile(elite.start, 'utf8'),
    custom: await readFile(elite.custom).catch(() => null),
    shipped: (await readFile(elite.shipped)).equals(SHIPPED_BYTES),
    folder: (await readdir(elite.bindings)).sort(),
  };
}
const backupsOf = (world: World) =>
  readdir(join(world.dataDir, 'backups', ELITE)).catch(() => [] as string[]);
const unitWrites = (world: World) =>
  world.left.unit.received.length + world.right.unit.received.length;
const keyOf = (text: string, action: string): Signal | undefined =>
  harvestEliteBinds(text, { id: ELITE, name: 'Elite Dangerous' }).game.actions.find(
    (a) => a.id === action,
  )?.native?.key;
const keyboardRow = (plan: Plan | null, action: string): GameBinding | undefined =>
  plan?.gameBindings.find((b) => b.action === action && b.set === 'keyboard');

describe('Elite with no file of its own: the Library knows it from its shipped preset, and Apply makes the file', () => {
  let elite: Elite;
  let found: boolean | undefined;
  let scheme: Scheme;
  let preview: ApplyPreview;
  let result: ApplyResult;
  let plan: Plan | null;

  beforeAll(async () => {
    elite = await eliteWorld();
    found = (await elite.world.helm.listGames()).find((e) => e.game.id === ELITE)?.found;
    scheme = await ownKeys(elite.world);
    ({ preview, result } = await elite.world.previewAndApply(scheme.id));
    plan = await elite.world.app.data.getApplied(scheme.id);
    await elite.world.idle();
  });

  afterAll(async () => {
    await elite.world.dispose();
  });

  it('lists Elite as a game helmArray knows, read from the preset it ships', () => {
    expect(found).toBe(true);
  });

  it('says in the drawer, in one sentence, that it makes the file from the shipped preset', () => {
    expect({
      ready: preview.ready,
      via: preview.game.via,
      file: preview.game.file,
      note: preview.game.note,
      jump: preview.game.rows.some((r) => r.action === JUMP),
      game: preview.checks.find((c) => c.kind === 'game'),
    }).toEqual({
      ready: true,
      via: 'file',
      file: { name: 'Custom.4.1.binds', same: false, made: true },
      note: NOTE,
      jump: true,
      game: { ok: true, kind: 'game', text: 'Elite Dangerous is closed.' },
    });
  });

  it('writes the units, then makes the file, and says both', () => {
    expect({
      ok: result.ok,
      units: result.units.map((u) => u.status),
      gameFile: result.gameFile,
    }).toEqual({
      ok: true,
      units: ['applied', 'applied'],
      gameFile: { ok: true, message: DONE },
    });
  });

  it("makes Custom.4.1.binds with Jump on the key the units send, and points StartPreset at it; the game's preset stays as it was", async () => {
    const disk = await onDisk(elite);
    expect({
      ...disk,
      custom: disk.custom === null ? null : keyOf(disk.custom.toString('utf8'), JUMP),
      root: disk.custom?.toString('utf8').split('\r\n')[1],
    }).toEqual({
      start: POINTED,
      custom: keyboardRow(plan, JUMP)?.signal,
      shipped: true,
      folder: ['Custom.4.1.binds', 'StartPreset.4.start'],
      root: '<Root PresetName="Custom" MajorVersion="4" MinorVersion="1">',
    });
  });

  it('keeps a copy of StartPreset as it was, in the backups folder', async () => {
    const copies = await backupsOf(elite.world);
    expect({
      copies: copies.map((c) => c.endsWith(' StartPreset.4.start')),
      copy: await readFile(join(elite.world.dataDir, 'backups', ELITE, copies[0] ?? ''), 'utf8'),
    }).toEqual({ copies: [true], copy: START });
  });

  it("moves the game's baseline to what was applied: nothing is left to set by hand", async () => {
    expect({
      held: await elite.world.app.data.heldBindings(ELITE),
      sheets: elite.world.state.sheets.filter((s) => s.gameId === ELITE),
    }).toEqual({ held: plan?.gameBindings, sheets: [] });
  });

  it('the next Apply writes the file it made, as any file of the player’s', async () => {
    const again = await elite.world.previewAndApply(scheme.id);
    expect({
      file: again.preview.game.file,
      note: again.preview.game.note,
      gameFile: again.result.gameFile,
    }).toEqual({
      file: { name: 'Custom.4.1.binds', same: true },
      note: undefined,
      gameFile: { ok: true, message: 'Elite Dangerous already has these controls.' },
    });
  });
});

describe('Elite with no file of its own: when the file is not to be made', () => {
  let elite: Elite;
  let scheme: Scheme;
  let held: GameBinding[] | null;

  beforeAll(async () => {
    elite = await eliteWorld();
    scheme = await ownKeys(elite.world);
    held = await elite.world.app.data.heldBindings(ELITE);
  });

  afterAll(async () => {
    await elite.world.dispose();
  });

  afterEach(async () => {
    elite.world.processes.others = [];
    elite.world.gameDisk = nodeGameFileDisk;
    await writeFile(elite.start, START);
    await rm(elite.custom, { force: true });
  });

  /** The drawer opens, and Apply is pressed; what reached the units, the disk and the baseline. */
  const attempt = async () => {
    const before = unitWrites(elite.world);
    const { preview, result } = await elite.world.previewAndApply(scheme.id);
    await elite.world.idle();
    return {
      preview,
      result,
      unitReports: unitWrites(elite.world) - before,
      disk: await onDisk(elite),
      held: await elite.world.app.data.heldBindings(ELITE),
    };
  };

  it('refuses while the game runs, before a unit is written, and touches neither file', async () => {
    elite.world.processes.others = [PROGRAM];
    const { preview, result, unitReports, disk } = await attempt();
    expect({
      ready: preview.ready,
      check: preview.checks.find((c) => c.kind === 'game'),
      result,
      unitReports,
      disk,
      copies: await backupsOf(elite.world),
    }).toEqual({
      ready: false,
      check: { ok: false, kind: 'game', text: 'Close Elite Dangerous to apply.' },
      result: { ok: false, message: 'Close Elite Dangerous to apply.', units: [] },
      unitReports: 0,
      disk: { start: START, custom: null, shipped: true, folder: ['StartPreset.4.start'] },
      copies: [],
    });
  });

  /** The real disk, with the write a test names made to fail. */
  const failingWrite = (fails: (path: string, nth: number) => boolean): GameFileDisk => {
    const writes = new Map<string, number>();
    return {
      ...nodeGameFileDisk,
      write: (path, bytes) => {
        const nth = (writes.get(path) ?? 0) + 1;
        writes.set(path, nth);
        return fails(path, nth)
          ? Promise.reject(new Error('the disk is full'))
          : nodeGameFileDisk.write(path, bytes);
      },
    };
  };

  const steps: [string, (path: string, nth: number) => boolean, string][] = [
    [
      'keeping the copy of StartPreset',
      (path) => path.startsWith(join(elite?.world.dataDir ?? '', 'backups')),
      "Elite Dangerous's controls file wasn't made: helmArray couldn't keep a copy of StartPreset.4.start first (the disk is full).",
    ],
    [
      'writing the new file',
      (path, nth) => path === elite.custom && nth === 1,
      `Elite Dangerous's controls file couldn't be written (the disk is full)${LEFT}`,
    ],
    [
      'writing the bindings into it',
      (path, nth) => path === elite.custom && nth === 2,
      `Elite Dangerous's controls file couldn't be written (the disk is full)${LEFT}`,
    ],
    [
      'pointing StartPreset at it',
      (path) => path === elite.start,
      `StartPreset.4.start couldn't be written (the disk is full)${LEFT}`,
    ],
  ];

  for (const [step, fails, message] of steps) {
    // After the units: the first case writes them, and the rest find them holding the layout.
    it(`a failure at ${step}: StartPreset stays, no new file, the baseline doesn't move`, async () => {
      elite.world.gameDisk = failingWrite(fails);
      const got = await attempt();
      expect({
        ok: got.result.ok,
        unitsFailed: got.result.units.filter((u) => u.status === 'failed').length,
        gameFile: got.result.gameFile,
        disk: got.disk,
        held: got.held,
      }).toEqual({
        ok: false,
        unitsFailed: 0,
        gameFile: { ok: false, message },
        disk: { start: START, custom: null, shipped: true, folder: ['StartPreset.4.start'] },
        held,
      });
    });
  }
});

describe('Elite with no file of its own, and no install folder found', () => {
  let elite: Elite;
  let preview: ApplyPreview;
  let result: ApplyResult;
  let found: { found?: true | undefined } | undefined;

  beforeAll(async () => {
    // Steam lists Elite, but in its own folder (in memory): the install folder isn't on disk.
    elite = await eliteWorld(false);
    found = (await elite.world.helm.listGames()).find((e) => e.game.id === ELITE);
    // The game's data as the Game screen would save it, typed in or read before.
    const { game } = harvestEliteBinds(SHIPPED_BYTES.toString('utf8'), {
      id: ELITE,
      name: 'Elite Dangerous',
    });
    await elite.world.helm.saveGame(game);
    await elite.world.idle();
    const scheme = await ownKeys(elite.world);
    ({ preview, result } = await elite.world.previewAndApply(scheme.id));
    await elite.world.idle();
  });

  afterAll(async () => {
    await elite.world.dispose();
  });

  it("isn't found from a file: there is none to read", () => {
    expect(found).toBeUndefined();
  });

  it('writes the units and leaves the bindings to set by hand, saying why, and touches neither file', async () => {
    expect({
      via: preview.game.via,
      note: preview.game.note,
      ok: result.ok,
      units: result.units.map((u) => u.status),
      gameFile: result.gameFile,
      disk: await onDisk(elite),
      reminder: elite.world.state.sheets.some((s) => s.gameId === ELITE && s.rows.length > 0),
    }).toEqual({
      via: 'sheet',
      note: "helmArray can't find Elite Dangerous's controls file, so set these in the game's own menu (changing any control there makes the game save one).",
      ok: true,
      units: ['applied', 'applied'],
      gameFile: undefined,
      disk: { start: START, custom: null, shipped: true, folder: ['StartPreset.4.start'] },
      reminder: true,
    });
  });
});
