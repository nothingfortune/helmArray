// Apply writes the game's file: Everspace 2's Input.ini (a copy of reference/game-files, in a temp
// folder standing for %LOCALAPPDATA%), after the units, through the services as index.ts wires
// them. The game's data is the harvest of that file, saved as the Game screen saves a game (putting
// a harvest into the app is a later part of M5).
//
// What a journey leaves is read by the tests after it: the file, its copies in the backups folder,
// the game's baseline and the reminder, the units.

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Game, KeptSheet, Scheme } from '@helmarray/core';
import { harvestUnrealIni } from '@helmarray/games';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { nodeGameFileDisk } from '../../packages/app/src/main/game-file-disk';
import { assign } from '../../packages/app/src/renderer/screens/editor-model';
import type { ApplyPreview, ApplyResult } from '../../packages/app/src/shared/api';
import { GAME_PROGRAMS, World } from './support/world';

const ES2_BYTES = await readFile(
  new URL('../../reference/game-files/everspace2-Input.before.ini', import.meta.url),
);
const ES2 = 'everspace2';
const PROGRAM = GAME_PROGRAMS['unreal-ini'];

/** Puts Everspace 2's file where the game keeps it, and the game's data in the app. */
async function seed(world: World): Promise<{ ini: string; game: Game }> {
  const dir = join(world.localAppData, 'ES2', 'Saved', 'Config', 'Windows');
  await mkdir(dir, { recursive: true });
  const ini = join(dir, 'Input.ini');
  await writeFile(ini, ES2_BYTES);
  const { game } = harvestUnrealIni(ES2_BYTES.toString('utf8'), { id: ES2, name: 'Everspace 2' });
  await world.helm.saveGame(game);
  await world.idle();
  return { ini, game };
}

/** The game's own keys, as the preset makes them, ready to apply (its errors kept). */
async function ownKeys(world: World): Promise<Scheme> {
  const scheme = await world.createScheme('keys', ES2);
  return world.keepFindings(scheme.id);
}

/** Boost (Left Shift, as the game ships it) put on another button: its key comes from the pool. */
const moveBoost = (world: World, schemeId: string, control: string) =>
  world.edit(schemeId, (s, game) =>
    assign(s, { mode: 'flight', control, press: 'tap' }, 'Boost', game),
  );

const backupsOf = (world: World) =>
  readdir(join(world.dataDir, 'backups', ES2)).catch(() => [] as string[]);
const unitWrites = (world: World) =>
  world.left.unit.received.length + world.right.unit.received.length;
const harvestOf = (text: string) => harvestUnrealIni(text, { id: ES2, name: 'Everspace 2' });

describe("J1 on Everspace 2: the game's own keys, applied, write its file", () => {
  let world: World;
  let ini: string;
  let scheme: Scheme;
  let preview: ApplyPreview;
  let result: ApplyResult;
  let written: Buffer;
  let sheets: KeptSheet[];
  let again: { preview: ApplyPreview; result: ApplyResult };
  let afterAgain: Buffer;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    ({ ini } = await seed(world));
    scheme = await ownKeys(world);
    await moveBoost(world, scheme.id, 'R.index_2');
    ({ preview, result } = await world.previewAndApply(scheme.id));
    written = await readFile(ini);
    await world.idle();
    sheets = world.state.sheets;
    again = await world.previewAndApply(scheme.id);
    afterAgain = await readFile(ini);
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('shows the file as its own target, with the game closed beside the Azeron app', () => {
    expect({
      ready: preview.ready,
      via: preview.game.via,
      file: preview.game.file,
      boost: preview.game.rows.filter((r) => r.action === 'Boost').map((r) => r.set),
      shown: preview.checks.filter((c) => c.kind === 'azeron-app' || c.kind === 'game'),
    }).toEqual({
      ready: true,
      via: 'file',
      file: { name: 'Input.ini', same: false },
      boost: ['keyboard'],
      shown: [
        { ok: true, kind: 'azeron-app', text: 'The Azeron app is closed.' },
        { ok: true, kind: 'game', text: 'Everspace 2 is closed.' },
      ],
    });
  });

  it('writes the units, then the file, and says both', () => {
    expect({
      ok: result.ok,
      units: result.units.map((u) => u.status),
      gameFile: result.gameFile,
    }).toEqual({
      ok: true,
      units: ['applied', 'applied'],
      gameFile: {
        ok: true,
        message: "Everspace 2 now has the scheme's controls, and a copy of its old file is kept.",
      },
    });
  });

  it('puts in the file the key the units now send for Boost', async () => {
    const plan = await world.app.data.getApplied(scheme.id);
    const boost = plan?.gameBindings.find((b) => b.action === 'Boost' && b.set === 'keyboard');
    const inFile = harvestOf(written.toString('utf8')).game.actions.find((a) => a.id === 'Boost');
    expect({
      moved: boost?.signal?.kind === 'key' && boost.signal.code !== 'LShift',
      inFile: inFile?.native?.key,
    }).toEqual({
      moved: true,
      inFile: boost?.signal,
    });
  });

  it('keeps the file as it was in the backups folder', async () => {
    const copies = await backupsOf(world);
    expect({
      copies: copies.length,
      copy: (await readFile(join(world.dataDir, 'backups', ES2, copies[0] ?? ''))).equals(
        ES2_BYTES,
      ),
    }).toEqual({ copies: 1, copy: true });
  });

  it("moves the game's baseline to what was applied: nothing is left to set by hand", async () => {
    const plan = await world.app.data.getApplied(scheme.id);
    expect({
      held: await world.app.data.heldBindings(ES2),
      sheets: sheets.filter((s) => s.gameId === ES2),
    }).toEqual({ held: plan?.gameBindings, sheets: [] });
  });

  it('a second Apply with nothing changed writes nothing, and keeps no other copy', async () => {
    expect({
      file: again.preview.game.file,
      rows: again.preview.game.rows,
      gameFile: again.result.gameFile,
      same: afterAgain.equals(written),
      copies: (await backupsOf(world)).length,
    }).toEqual({
      file: { name: 'Input.ini', same: true },
      rows: [],
      gameFile: { ok: true, message: 'Everspace 2 already has these controls.' },
      same: true,
      copies: 1,
    });
  });
});

describe('Apply on Everspace 2, when the file is not to be written', () => {
  let world: World;
  let ini: string;
  let scheme: Scheme;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    ({ ini } = await seed(world));
    scheme = await ownKeys(world);
  });

  afterAll(async () => {
    await world.dispose();
  });

  afterEach(async () => {
    world.processes.others = [];
    world.gameDisk = nodeGameFileDisk;
    await writeFile(ini, ES2_BYTES);
  });

  /** The drawer opens, and Apply is pressed; what reached the units and the file meanwhile. */
  const attempt = async () => {
    const before = unitWrites(world);
    const { preview, result } = await world.previewAndApply(scheme.id);
    return {
      preview,
      result,
      unitReports: unitWrites(world) - before,
      file: await readFile(ini).catch(() => null),
    };
  };

  it('refuses while the game runs, before a unit is written, and leaves the file alone', async () => {
    world.processes.others = [PROGRAM];
    const { preview, result, unitReports, file } = await attempt();
    expect({
      ready: preview.ready,
      check: preview.checks.find((c) => c.kind === 'game'),
      result,
      unitReports,
      file: file?.equals(ES2_BYTES),
      copies: await backupsOf(world),
    }).toEqual({
      ready: false,
      check: { ok: false, kind: 'game', text: 'Close Everspace 2 to apply.' },
      result: { ok: false, message: 'Close Everspace 2 to apply.', units: [] },
      unitReports: 0,
      file: true,
      copies: [],
    });
  });

  it('when the file is missing, writes the units and lists the bindings to set by hand, saying why', async () => {
    await rm(ini);
    // Boost on another button: a key the game doesn't ship it on, so there is a row to set.
    await moveBoost(world, scheme.id, 'R.index_2');
    const { preview, result, unitReports, file } = await attempt();
    await world.idle();
    expect({
      ready: preview.ready,
      via: preview.game.via,
      note: preview.game.note,
      rows: preview.game.rows.some((r) => r.action === 'Boost'),
      fileChecks: preview.checks.filter((c) => c.kind === 'game' || c.kind === 'game-file'),
      ok: result.ok,
      units: result.units.map((u) => u.status),
      gameFile: result.gameFile,
      wroteUnits: unitReports > 0,
      file,
      copies: await backupsOf(world),
      // Not settled: what is left to set by hand stays on the Library's reminder.
      reminder: world.state.sheets.some((s) => s.gameId === ES2 && s.rows.length > 0),
    }).toEqual({
      ready: true,
      via: 'sheet',
      note: "helmArray can't find Everspace 2's controls file, so set these in the game's own menu (changing any control there makes the game save one).",
      rows: true,
      fileChecks: [],
      ok: true,
      units: ['applied', 'applied'],
      gameFile: undefined,
      wroteUnits: true,
      file: null,
      copies: [],
      reminder: true,
    });
  });

  it("refuses when the file can't be read, and says why", async () => {
    world.gameDisk = {
      ...nodeGameFileDisk,
      read: () => Promise.reject(new Error('EBUSY: resource busy or locked')),
    };
    const { preview, unitReports } = await attempt();
    expect([preview.checks.find((c) => c.kind === 'game-file')?.text, unitReports]).toEqual([
      "helmArray couldn't read Everspace 2's controls file (EBUSY: resource busy or locked).",
      0,
    ]);
  });
});

describe('Apply on Everspace 2, when the file goes between the drawer and the write', () => {
  let world: World;
  let ini: string;
  let scheme: Scheme;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    ({ ini } = await seed(world));
    scheme = await ownKeys(world);
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('when the file goes after the drawer looked, writes the units, keeps no copy, and leaves the bindings to set by hand', async () => {
    await moveBoost(world, scheme.id, 'R.index_2');
    const preview = await world.helm.previewApply(scheme.id);
    // Gone once Apply is pressed: Apply's own look still finds it, the write does not.
    let reads = 0;
    world.gameDisk = {
      ...nodeGameFileDisk,
      read: (path) =>
        path === ini && ++reads > 1 ? Promise.resolve(null) : nodeGameFileDisk.read(path),
    };
    const before = unitWrites(world);
    const result = await world.helm.apply(scheme.id, preview.fingerprint);
    await world.idle();
    expect({
      via: preview.game.via,
      units: result.units.map((u) => u.status),
      wroteUnits: unitWrites(world) > before,
      gameFile: result.gameFile,
      file: (await readFile(ini)).equals(ES2_BYTES),
      copies: await backupsOf(world),
      reminder: world.state.sheets.some((s) => s.gameId === ES2 && s.rows.length > 0),
    }).toEqual({
      via: 'file',
      units: ['applied', 'applied'],
      wroteUnits: true,
      gameFile: {
        ok: false,
        message:
          "helmArray can't find Everspace 2's controls file, so set these in the game's own menu (changing any control there makes the game save one).",
      },
      file: true,
      copies: [],
      reminder: true,
    });
  });
});

describe("Apply on Everspace 2, when the file's write goes wrong", () => {
  let world: World;
  let ini: string;
  let scheme: Scheme;

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    ({ ini } = await seed(world));
    scheme = await ownKeys(world);
  });

  afterAll(async () => {
    await world.dispose();
  });

  afterEach(() => {
    world.gameDisk = nodeGameFileDisk;
  });

  /** Writes to the game's file go through `write` the first time, then as they should. */
  const failFirstWrite = (write: (path: string, bytes: Uint8Array) => Promise<void>) => {
    let first = true;
    world.gameDisk = {
      ...nodeGameFileDisk,
      write: (path, bytes) => {
        if (path !== ini || !first) return nodeGameFileDisk.write(path, bytes);
        first = false;
        return write(path, bytes);
      },
    };
  };

  it("puts the file back when the write fails half way, and doesn't move the game's baseline", async () => {
    await moveBoost(world, scheme.id, 'R.index_2');
    failFirstWrite(async (path, bytes) => {
      await writeFile(path, bytes.slice(0, bytes.length / 2));
      throw new Error('ENOSPC: no space left on device');
    });
    const { result } = await world.previewAndApply(scheme.id);
    await world.idle();
    expect({
      ok: result.ok,
      message: result.message,
      units: result.units.map((u) => u.status),
      file: (await readFile(ini)).equals(ES2_BYTES),
      held: await world.app.data.heldBindings(ES2),
      // The units hold the layout, the game doesn't: what to set by hand is said.
      reminder: world.state.sheets.some((s) => s.gameId === ES2),
    }).toEqual({
      ok: false,
      message:
        "Everspace 2's controls file couldn't be written (ENOSPC: no space left on device), so it was put back as it was.",
      units: ['applied', 'applied'],
      file: true,
      held: null,
      reminder: true,
    });
  });

  it("puts the file back when it doesn't read back as written", async () => {
    await moveBoost(world, scheme.id, 'R.index_3');
    failFirstWrite((path) => nodeGameFileDisk.write(path, ES2_BYTES.subarray(0, 200)));
    const { result } = await world.previewAndApply(scheme.id);
    expect({
      ok: result.ok,
      message: result.message,
      file: (await readFile(ini)).equals(ES2_BYTES),
      held: await world.app.data.heldBindings(ES2),
    }).toEqual({
      ok: false,
      message:
        "Everspace 2's controls file didn't read back as it was written, so it was put back as it was.",
      file: true,
      held: null,
    });
  });

  it('then writes it, and moves the baseline, once the write goes through', async () => {
    const { result } = await world.previewAndApply(scheme.id);
    await world.idle();
    expect({
      ok: result.ok,
      changed: !(await readFile(ini)).equals(ES2_BYTES),
      held: (await world.app.data.heldBindings(ES2)) !== null,
      reminder: world.state.sheets.some((s) => s.gameId === ES2),
    }).toEqual({ ok: true, changed: true, held: true, reminder: false });
  });
});

describe('the copies of the file kept, apply after apply', () => {
  let world: World;
  let copies: string[];

  beforeAll(async () => {
    world = await World.create();
    await world.boot();
    await seed(world);
    const scheme = await ownKeys(world);
    // Boost back and forth between two buttons: each apply changes the file, and keeps a copy.
    for (const control of [
      'R.index_2',
      'R.index_3',
      'R.index_2',
      'R.index_3',
      'R.index_2',
      'R.index_3',
    ]) {
      await moveBoost(world, scheme.id, control);
      world.clock.advance(1000);
      expect((await world.previewAndApply(scheme.id)).result.gameFile?.ok).toBe(true);
    }
    copies = await backupsOf(world);
  });

  afterAll(async () => {
    await world.dispose();
  });

  it('keeps the newest five, named by when, so the newest sorts last', () => {
    expect({ count: copies.length, sorted: [...copies].sort() }).toEqual({
      count: 5,
      sorted: copies,
    });
  });

  it('dropped the oldest: the file as the game shipped it is no longer among them', async () => {
    const texts = await Promise.all(
      copies.map((copy) => readFile(join(world.dataDir, 'backups', ES2, copy))),
    );
    expect(texts.some((text) => text.equals(ES2_BYTES))).toBe(false);
  });
});
