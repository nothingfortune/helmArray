// The game-file target over a temp folder: copies of the games' own files
// (reference/game-files, read only) where each game keeps its file, the real disk, and a disk
// wrapped to fail where a test says.

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Game, GameBinding, GameFileFormat, Plan, Signal } from '@helmarray/core';
import { harvestEliteBinds, harvestUnrealIni, writeUnrealIni } from '@helmarray/games';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameFileDisk } from './game-file-disk';
import { nodeGameFileDisk } from './game-file-disk';
import type { GameFileDeps, GameFileKind } from './game-file';
import { BACKUPS_KEPT, GAME_FILE_KINDS, createGameFileTarget } from './game-file';

const REFERENCE = new URL('../../../../reference/game-files/', import.meta.url);
const ES2_BYTES = await readFile(new URL('everspace2-Input.before.ini', REFERENCE));
const ELITE_BYTES = await readFile(new URL('elite-Custom.4.1.binds', REFERENCE));
const ES2_GAME = harvestUnrealIni(ES2_BYTES.toString('utf8'), {
  id: 'everspace2',
  name: 'Everspace 2',
}).game;
const ELITE_GAME = harvestEliteBinds(ELITE_BYTES.toString('utf8'), {
  id: 'elite',
  name: 'Elite Dangerous',
}).game;
const ES2_PROGRAM = 'ES2-test.exe';
const ELITE_PROGRAM = 'Elite-test.exe';

/** The formats as the app has them, with programs to look for (the app's own are not known). */
const KINDS: Record<GameFileFormat, GameFileKind> = {
  'unreal-ini': { ...GAME_FILE_KINDS['unreal-ini'], processNames: [ES2_PROGRAM] },
  'elite-binds': { ...GAME_FILE_KINDS['elite-binds'], processNames: [ELITE_PROGRAM] },
};

const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;
const row = (action: string, signal: Signal | null, mode = 'flight'): GameBinding => ({
  set: 'keyboard',
  mode,
  action,
  signal,
  native: null,
});
const planOf = (game: Game, gameBindings: GameBinding[]): Plan => ({
  units: {},
  bindings: [],
  gameBindings,
  bindSheet: [],
  ledger: {},
  findings: [],
  ...(game.file === undefined ? {} : { gameFile: { format: game.file.format } }),
});
/** Boost moved from Left Shift to B: a write that changes one line. */
const MOVED = planOf(ES2_GAME, [row('Boost', key('B'))]);
/** Boost where the game ships it: a write that changes nothing. */
const KEPT = planOf(ES2_GAME, [row('Boost', key('LShift'))]);

let root: string;
let local: string;
let backups: string;
let iniPath: string;
let running: string[];
let clock: number;
let lines: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'helm-game-file-'));
  local = join(root, 'local');
  backups = join(root, 'data', 'backups');
  const ini = join(local, 'ES2', 'Saved', 'Config', 'Windows');
  await mkdir(ini, { recursive: true });
  iniPath = join(ini, 'Input.ini');
  await writeFile(iniPath, ES2_BYTES);
  running = ['explorer.exe'];
  clock = Date.UTC(2026, 10, 24, 9, 30, 0, 250);
  lines = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function target(over: Partial<GameFileDeps> = {}) {
  return createGameFileTarget({
    disk: nodeGameFileDisk,
    localAppData: [local],
    backupsDir: backups,
    listProcesses: () => Promise.resolve(running),
    now: () => (clock += 1000),
    kinds: KINDS,
    trace: (line) => lines.push(line),
    ...over,
  });
}

/** The real disk, with writes to the game's file (not the backups) replaced. */
const failingWrites = (write: GameFileDisk['write']): GameFileDisk => ({
  ...nodeGameFileDisk,
  write: (path, bytes) =>
    path === iniPath ? write(path, bytes) : nodeGameFileDisk.write(path, bytes),
});

const backupsOf = async (gameId: string) =>
  readdir(join(backups, gameId)).catch(() => [] as string[]);
const ini = async () => readFile(iniPath);

describe('the game-file target: what it says before Apply', () => {
  it("leaves a plan that doesn't write the game's file to the bind sheet", async () => {
    const noFile = planOf({ ...ES2_GAME, file: { format: 'unreal-ini' } }, MOVED.gameBindings);
    delete noFile.gameFile;
    expect(await target().look(ES2_GAME, noFile)).toEqual({
      via: 'sheet',
      note: null,
      name: null,
      same: false,
      byHand: [],
      checks: [],
    });
  });

  it("leaves both games to the bind sheet as the app ships: their programs aren't known", async () => {
    const look = await target({ kinds: GAME_FILE_KINDS }).look(ES2_GAME, MOVED);
    expect({
      via: look.via,
      programs: Object.values(GAME_FILE_KINDS).map((kind) => kind.processNames),
      said: lines,
    }).toEqual({
      via: 'sheet',
      programs: [null, null],
      said: ["everspace2: its file isn't written, since whether it runs can't be told"],
    });
  });

  it('names the file and says the game is closed, when the file can take the bindings', async () => {
    expect(await target().look(ES2_GAME, MOVED)).toEqual({
      via: 'file',
      note: null,
      name: 'Input.ini',
      same: false,
      byHand: [],
      checks: [{ ok: true, kind: 'game', text: 'Everspace 2 is closed.' }],
    });
  });

  it('says the file already holds the bindings, when writing them changes nothing', async () => {
    expect((await target().look(ES2_GAME, KEPT)).same).toBe(true);
  });

  it('asks for the game to be closed while it runs, in any case of its name', async () => {
    running = ['explorer.exe', 'es2-TEST.EXE'];
    expect((await target().look(ES2_GAME, MOVED)).checks).toEqual([
      { ok: false, kind: 'game', text: 'Close Everspace 2 to apply.' },
    ]);
  });

  it("says so when it can't tell whether the game runs", async () => {
    const look = await target({
      listProcesses: () => Promise.reject(new Error('tasklist failed')),
    }).look(ES2_GAME, MOVED);
    expect(look.checks).toEqual([
      {
        ok: false,
        kind: 'game',
        text: "helmArray couldn't tell whether Everspace 2 is running.",
      },
    ]);
  });

  it('leaves the bindings to set by hand when there is no file yet, and says why and how to make it', async () => {
    await rm(iniPath);
    expect(await target().look(ES2_GAME, MOVED)).toEqual({
      via: 'sheet',
      note: "helmArray can't find Everspace 2's controls file, so set these in the game's own menu (changing any control there makes the game save one).",
      name: null,
      same: false,
      byHand: [],
      checks: [],
    });
  });

  it('names the file and never says it holds the bindings, when it cannot take them', async () => {
    const look = await target().look(ES2_GAME, planOf(ES2_GAME, [row('Boost', key('F14'))]));
    expect([look.name, look.same]).toEqual(['Input.ini', false]);
  });

  it('leaves a game whose programs are listed as none to the bind sheet', async () => {
    const kinds = { 'unreal-ini': { ...KINDS['unreal-ini'], processNames: [] } };
    expect((await target({ kinds }).look(ES2_GAME, MOVED)).via).toBe('sheet');
  });

  it('says the one thing the file can not take, with no count of more', async () => {
    const plan = planOf(ES2_GAME, [row('Boost', key('F14'))]);
    expect((await target().look(ES2_GAME, plan)).checks[1]?.text).toBe(
      `Everspace 2's controls file can't take this scheme: Boost [HOLD]: Unreal has no name for F14.`,
    );
  });

  it("isn't refused for an action the file doesn't have: its bindings are set by hand, the rest written", async () => {
    const plan = planOf(ES2_GAME, [...MOVED.gameBindings, row('wave', key('C'))]);
    const look = await target().look(ES2_GAME, plan);
    const outcome = await target().write(ES2_GAME, plan);
    const after = harvestUnrealIni((await ini()).toString('utf8'), ES2_GAME).game;
    expect({
      byHand: look.byHand,
      checks: look.checks.map((c) => c.ok),
      written: outcome.written,
      boost: after.actions.find((a) => a.id === 'Boost')?.native?.key,
      file: (await ini()).toString('utf8'),
    }).toEqual({
      byHand: ['wave'],
      checks: [true],
      written: true,
      boost: key('B'),
      file: writeUnrealIni(ES2_BYTES.toString('utf8'), MOVED.gameBindings),
    });
  });

  it('says what went wrong when the adapter fails some other way', async () => {
    const kinds = {
      'unreal-ini': {
        ...KINDS['unreal-ini'],
        write: () => {
          throw new Error('Unexpected end of line.  ');
        },
      },
    };
    expect((await target({ kinds }).look(ES2_GAME, MOVED)).checks[1]?.text).toBe(
      "Everspace 2's controls file can't take this scheme: Unexpected end of line.",
    );
  });

  it("says why when the file can't be read", async () => {
    const disk: GameFileDisk = {
      ...nodeGameFileDisk,
      read: () => Promise.reject(new Error('EBUSY: resource busy or locked. \n')),
    };
    expect((await target({ disk }).look(ES2_GAME, MOVED)).checks[1]).toEqual({
      ok: false,
      kind: 'game-file',
      text: "helmArray couldn't read Everspace 2's controls file (EBUSY: resource busy or locked).",
    });
  });

  it("refuses a file that isn't UTF-8 text, rather than write it back changed", async () => {
    await writeFile(iniPath, Buffer.from([0x5b, 0xff, 0xfe, 0x5d]));
    expect((await target().look(ES2_GAME, MOVED)).checks[1]?.text).toBe(
      "Everspace 2's controls file isn't text helmArray can read.",
    );
  });

  it("says what the file can't take, the first reason and how many more", async () => {
    const plan = planOf(ES2_GAME, [row('Boost', key('F14')), row('Boost', key('F15'))]);
    expect((await target().look(ES2_GAME, plan)).checks[1]?.text).toBe(
      `Everspace 2's controls file can't take this scheme: Boost [HOLD]: Unreal has no name for F14 (and 1 more).`,
    );
  });
});

describe('the game-file target: a write', () => {
  it('writes the bindings, keeps a copy of the file as it was, and says so', async () => {
    const outcome = await target().write(ES2_GAME, MOVED);
    const copies = await backupsOf('everspace2');
    const after = harvestUnrealIni((await ini()).toString('utf8'), ES2_GAME).game;
    expect({
      outcome,
      boost: after.actions.find((a) => a.id === 'Boost')?.native?.key,
      copies,
      copy: await readFile(join(backups, 'everspace2', copies[0] ?? '')),
    }).toEqual({
      outcome: {
        ok: true,
        written: true,
        message: "Everspace 2 now has the scheme's controls, and a copy of its old file is kept.",
      },
      boost: key('B'),
      copies: ['2026-11-24 09.30.01.250 Input.ini'],
      copy: ES2_BYTES,
    });
  });

  it('keeps a byte order mark the file starts with', async () => {
    await writeFile(iniPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), ES2_BYTES]));
    await target().write(ES2_GAME, MOVED);
    expect([...(await ini()).subarray(0, 4)]).toEqual([0xef, 0xbb, 0xbf, ES2_BYTES[0]]);
  });

  it("refuses to write for a plan that doesn't write the game's file", async () => {
    const noFile = planOf(ES2_GAME, MOVED.gameBindings);
    delete noFile.gameFile;
    expect({ outcome: await target().write(ES2_GAME, noFile), file: await ini() }).toEqual({
      outcome: {
        ok: false,
        written: false,
        message: "helmArray doesn't write Everspace 2's file.",
      },
      file: ES2_BYTES,
    });
  });

  it('says in the log what it kept, what it wrote, and what went wrong', async () => {
    running = [];
    await target().write(ES2_GAME, MOVED);
    const failing = target({
      disk: failingWrites(() => Promise.reject(new Error('EPERM'))),
      listProcesses: () => Promise.reject(new Error('tasklist failed')),
    });
    await failing.look(ES2_GAME, MOVED);
    await writeFile(iniPath, ES2_BYTES);
    const damaging = failingWrites(async (path, bytes) => {
      await writeFile(path, bytes.slice(0, 10));
      throw new Error('EPERM');
    });
    await target({ disk: damaging }).write(ES2_GAME, MOVED);
    const at = (text: string) => lines.some((line) => line.includes(text));
    expect({
      kept: at(`everspace2: kept a copy of ${iniPath} as 2026-11-24 09.30.01.250 Input.ini`),
      wrote: at(`everspace2: wrote ${iniPath}`),
      look: at("couldn't look for everspace2: tasklist failed"),
      failed: at("everspace2: Everspace 2's controls file couldn't be written (EPERM)"),
      putBack: at('putting the file back failed: EPERM'),
    }).toEqual({ kept: true, wrote: true, look: true, failed: true, putBack: true });
  });

  it('says in the log when no copy could be kept', async () => {
    const disk: GameFileDisk = {
      ...nodeGameFileDisk,
      makeDir: () => Promise.reject(new Error('EACCES')),
    };
    await target({ disk }).write(ES2_GAME, MOVED);
    expect(lines).toContain(`everspace2: no copy of ${iniPath} could be kept: EACCES`);
  });

  it('puts the file back when it is gone after the write', async () => {
    let writes = 0;
    const disk = failingWrites(async (path, bytes) => {
      writes++;
      if (writes === 1) await rm(path);
      else await nodeGameFileDisk.write(path, bytes);
    });
    expect({ outcome: await target({ disk }).write(ES2_GAME, MOVED), file: await ini() }).toEqual({
      outcome: {
        ok: false,
        written: false,
        message:
          "Everspace 2's controls file didn't read back as it was written, so it was put back as it was.",
      },
      file: ES2_BYTES,
    });
  });

  it('changes only the line that changes, and keeps the CRLF endings', async () => {
    await target().write(ES2_GAME, MOVED);
    const before = ES2_BYTES.toString('utf8').split('\r\n');
    const after = (await ini()).toString('utf8').split('\r\n');
    expect({
      count: after.length,
      changed: after.filter((line, i) => line !== before[i]).length,
    }).toEqual({ count: before.length, changed: 1 });
  });

  it('refuses while the game runs, and leaves the file and the backups alone', async () => {
    running = ['explorer.exe', ES2_PROGRAM];
    expect({
      outcome: await target().write(ES2_GAME, MOVED),
      file: await ini(),
      copies: await backupsOf('everspace2'),
    }).toEqual({
      outcome: { ok: false, written: false, message: 'Close Everspace 2 to apply.' },
      file: ES2_BYTES,
      copies: [],
    });
  });

  it('writes nothing, keeps no copy, and says the bindings are to set by hand, when the file is gone', async () => {
    await rm(iniPath);
    expect({
      outcome: await target().write(ES2_GAME, MOVED),
      copies: await backupsOf('everspace2'),
    }).toEqual({
      outcome: {
        ok: false,
        written: false,
        missing: true,
        message:
          "helmArray can't find Everspace 2's controls file, so set these in the game's own menu (changing any control there makes the game save one).",
      },
      copies: [],
    });
  });

  it('writes nothing, and keeps no copy, when the file holds the bindings already', async () => {
    expect({
      outcome: await target().write(ES2_GAME, KEPT),
      copies: await backupsOf('everspace2'),
    }).toEqual({
      outcome: { ok: true, written: false, message: 'Everspace 2 already has these controls.' },
      copies: [],
    });
  });

  it('writes nothing the second time the same bindings are applied', async () => {
    const first = await target().write(ES2_GAME, MOVED);
    const written = await ini();
    const second = await target().write(ES2_GAME, MOVED);
    expect({
      first: first.written,
      second,
      file: (await ini()).equals(written),
      copies: (await backupsOf('everspace2')).length,
    }).toEqual({
      first: true,
      second: { ok: true, written: false, message: 'Everspace 2 already has these controls.' },
      file: true,
      copies: 1,
    });
  });

  it('puts the file back when a write fails half way', async () => {
    let writes = 0;
    const disk = failingWrites(async (path, bytes) => {
      // The first write stops half way through the file itself; putting it back goes through.
      if (++writes > 1) return nodeGameFileDisk.write(path, bytes);
      await writeFile(path, bytes.slice(0, bytes.length / 2));
      throw new Error('ENOSPC: no space left on device.');
    });
    expect({ outcome: await target({ disk }).write(ES2_GAME, MOVED), file: await ini() }).toEqual({
      outcome: {
        ok: false,
        written: false,
        message:
          "Everspace 2's controls file couldn't be written (ENOSPC: no space left on device), so it was put back as it was.",
      },
      file: ES2_BYTES,
    });
  });

  it("puts the file back when it doesn't read back as written", async () => {
    let writes = 0;
    const disk = failingWrites(async (path, bytes) => {
      // The first write puts Boost on C, not B; putting the file back goes through.
      writes++;
      const wrong = writeUnrealIni(ES2_BYTES.toString('utf8'), [row('Boost', key('C'))]);
      await nodeGameFileDisk.write(path, writes === 1 ? new TextEncoder().encode(wrong) : bytes);
    });
    expect({ outcome: await target({ disk }).write(ES2_GAME, MOVED), file: await ini() }).toEqual({
      outcome: {
        ok: false,
        written: false,
        message:
          "Everspace 2's controls file didn't read back as it was written, so it was put back as it was.",
      },
      file: ES2_BYTES,
    });
  });

  it('notices a second key gone missing: what is checked is everything the file holds', async () => {
    const twoKeys = planOf(ES2_GAME, [row('Boost', key('B')), row('Boost', key('C'))]);
    let writes = 0;
    const disk = failingWrites(async (path, bytes) => {
      // The first write holds Boost's first key only; putting the file back goes through.
      writes++;
      const one = writeUnrealIni(ES2_BYTES.toString('utf8'), [row('Boost', key('B'))]);
      await nodeGameFileDisk.write(path, writes === 1 ? new TextEncoder().encode(one) : bytes);
    });
    const written = await target().write(ES2_GAME, twoKeys);
    const second = harvestUnrealIni((await ini()).toString('utf8'), ES2_GAME).kept;
    await writeFile(iniPath, ES2_BYTES);
    expect({
      written: written.ok,
      second,
      faulty: await target({ disk }).write(ES2_GAME, twoKeys),
    }).toEqual({
      written: true,
      second: expect.arrayContaining([{ action: 'Boost', set: 'keyboard', text: 'C' }]),
      faulty: {
        ok: false,
        written: false,
        message:
          "Everspace 2's controls file didn't read back as it was written, so it was put back as it was.",
      },
    });
  });

  it("counts a file that reads back as something that isn't text as not written", async () => {
    let writes = 0;
    const disk = failingWrites(async (path, bytes) => {
      writes++;
      await nodeGameFileDisk.write(path, writes === 1 ? Buffer.from([0xff, 0xfe]) : bytes);
    });
    expect((await target({ disk }).write(ES2_GAME, MOVED)).message).toBe(
      "Everspace 2's controls file didn't read back as it was written, so it was put back as it was.",
    );
  });

  it.each([
    ['short of its last byte', (bytes: Uint8Array) => bytes.slice(0, -1)],
    ['with one byte changed', (bytes: Uint8Array) => bytes.map((b, i) => (i === 10 ? b ^ 1 : b))],
  ])("doesn't say the file was put back when it reads back %s", async (_how, spoil) => {
    let writes = 0;
    const disk = failingWrites(async (path, bytes) => {
      // The first write stops half way through the file; putting it back goes wrong.
      writes++;
      if (writes > 1) return nodeGameFileDisk.write(path, spoil(bytes));
      await writeFile(path, bytes.slice(0, bytes.length / 2));
      throw new Error('EIO');
    });
    expect((await target({ disk }).write(ES2_GAME, MOVED)).message).toBe(
      "Everspace 2's controls file couldn't be written (EIO), and couldn't be put back: a copy of the old one is in helmArray's backups folder, as “2026-11-24 09.30.01.250 Input.ini”.",
    );
  });

  it('says the file is as it was when the write was refused before it touched it', async () => {
    let writes = 0;
    const disk = failingWrites(() => {
      writes++;
      return Promise.reject(new Error('EPERM: operation not permitted'));
    });
    expect({
      outcome: await target({ disk }).write(ES2_GAME, MOVED),
      file: await ini(),
      writes,
    }).toEqual({
      outcome: {
        ok: false,
        written: false,
        message:
          "Everspace 2's controls file couldn't be written (EPERM: operation not permitted), and it is as it was.",
      },
      file: ES2_BYTES,
      writes: 1,
    });
  });

  it("says where the copy is when the file can't even be put back", async () => {
    let writes = 0;
    const disk = failingWrites(async (path, bytes) => {
      // The first write stops half way through the file; every write after it is refused.
      if (++writes > 1) throw new Error('EPERM: operation not permitted');
      await writeFile(path, bytes.slice(0, bytes.length / 2));
      throw new Error('EPERM: operation not permitted');
    });
    expect(await target({ disk }).write(ES2_GAME, MOVED)).toEqual({
      ok: false,
      written: false,
      message:
        "Everspace 2's controls file couldn't be written (EPERM: operation not permitted), and couldn't be put back: a copy of the old one is in helmArray's backups folder, as “2026-11-24 09.30.01.250 Input.ini”.",
    });
  });

  it("doesn't write the file when no copy of it can be kept", async () => {
    const disk: GameFileDisk = {
      ...nodeGameFileDisk,
      makeDir: () => Promise.reject(new Error('EACCES: permission denied')),
    };
    expect({ outcome: await target({ disk }).write(ES2_GAME, MOVED), file: await ini() }).toEqual({
      outcome: {
        ok: false,
        written: false,
        message:
          "Everspace 2's controls file wasn't written: helmArray couldn't keep a copy of it first (EACCES: permission denied).",
      },
      file: ES2_BYTES,
    });
  });

  it.each([
    ['short of its last byte', (bytes: Uint8Array) => bytes.slice(0, -1)],
    ['with one byte changed', (bytes: Uint8Array) => bytes.map((b, i) => (i === 10 ? b ^ 1 : b))],
  ])("doesn't write the file when the copy reads back %s", async (_how, spoil) => {
    const disk: GameFileDisk = {
      ...nodeGameFileDisk,
      write: (path, bytes) =>
        path === iniPath
          ? nodeGameFileDisk.write(path, bytes)
          : nodeGameFileDisk.write(path, spoil(bytes)),
    };
    expect({ outcome: await target({ disk }).write(ES2_GAME, MOVED), file: await ini() }).toEqual({
      outcome: {
        ok: false,
        written: false,
        message:
          "Everspace 2's controls file wasn't written: helmArray couldn't keep a copy of it first (the copy didn't read back).",
      },
      file: ES2_BYTES,
    });
  });
});

describe('the game-file target: the copies it keeps', () => {
  /** Applies Boost on each of these keys in turn: one write, and one copy, each. */
  const applyEach = async (codes: string[]) => {
    for (const code of codes)
      await target().write(ES2_GAME, planOf(ES2_GAME, [row('Boost', key(code))]));
  };

  it(`keeps the newest ${BACKUPS_KEPT}, named so the newest sorts last`, async () => {
    await applyEach(['B', 'C', 'F', 'G', 'H', 'J', 'K']);
    expect(await backupsOf('everspace2')).toEqual([
      '2026-11-24 09.30.03.250 Input.ini',
      '2026-11-24 09.30.04.250 Input.ini',
      '2026-11-24 09.30.05.250 Input.ini',
      '2026-11-24 09.30.06.250 Input.ini',
      '2026-11-24 09.30.07.250 Input.ini',
    ]);
  });

  it('keeps as many as it is told to', async () => {
    for (const code of ['B', 'C', 'F'])
      await target({ keep: 2 }).write(ES2_GAME, planOf(ES2_GAME, [row('Boost', key(code))]));
    expect((await backupsOf('everspace2')).length).toBe(2);
  });

  it('keeps the newest copy whole: it is the file as it was just before', async () => {
    await applyEach(['B', 'C']);
    const copies = await backupsOf('everspace2');
    const newest = await readFile(join(backups, 'everspace2', copies.at(-1) ?? ''), 'utf8');
    expect(
      harvestUnrealIni(newest, ES2_GAME).game.actions.find((a) => a.id === 'Boost')?.native,
    ).toEqual(expect.objectContaining({ key: key('B') }));
  });

  it('never removes a file it did not make', async () => {
    await mkdir(join(backups, 'everspace2'), { recursive: true });
    // Each sorts before helmArray's own copies: removed first, were it taken for one.
    const mine = ['0 my notes.txt', '0 2026-11-01 10.00.00.000 Input.ini'];
    for (const name of mine) await writeFile(join(backups, 'everspace2', name), 'mine');
    await applyEach(['B', 'C', 'F', 'G', 'H', 'J', 'K']);
    expect(await backupsOf('everspace2')).toEqual(expect.arrayContaining(mine));
  });

  it('keeps the newest, whatever order the folder lists them in', async () => {
    const disk: GameFileDisk = {
      ...nodeGameFileDisk,
      list: async (dir) => (await nodeGameFileDisk.list(dir)).reverse(),
    };
    for (const code of ['B', 'C', 'F'])
      await target({ disk, keep: 2 }).write(ES2_GAME, planOf(ES2_GAME, [row('Boost', key(code))]));
    expect(await backupsOf('everspace2')).toEqual([
      '2026-11-24 09.30.02.250 Input.ini',
      '2026-11-24 09.30.03.250 Input.ini',
    ]);
  });

  it('takes a second name when two copies are made in the same moment', async () => {
    const still = () => Date.UTC(2026, 10, 24, 9, 30, 0, 250);
    await target({ now: still }).write(ES2_GAME, MOVED);
    await target({ now: still }).write(ES2_GAME, planOf(ES2_GAME, [row('Boost', key('C'))]));
    expect(await backupsOf('everspace2')).toEqual([
      '2026-11-24 09.30.00.250 Input.ini',
      '2026-11-24 09.30.00.250-01 Input.ini',
    ]);
  });

  it("goes on when an old copy can't be removed, and says so in the log", async () => {
    const disk: GameFileDisk = {
      ...nodeGameFileDisk,
      remove: () => Promise.reject(new Error('EBUSY')),
    };
    for (const code of ['B', 'C', 'F'])
      await target({ disk, keep: 1 }).write(ES2_GAME, planOf(ES2_GAME, [row('Boost', key(code))]));
    expect({
      boost: harvestUnrealIni((await ini()).toString('utf8'), ES2_GAME).game.actions.find(
        (a) => a.id === 'Boost',
      )?.native?.key,
      said: lines.filter((line) => line.startsWith("couldn't remove")).length,
    }).toEqual({ boost: key('F'), said: 3 });
  });
});

describe('the game-file target: Elite', () => {
  let bindings: string;
  beforeEach(async () => {
    bindings = join(local, 'Frontier Developments', 'Elite Dangerous', 'Options', 'Bindings');
    await mkdir(bindings, { recursive: true });
    await writeFile(join(bindings, 'Custom.4.1.binds'), ELITE_BYTES);
  });
  const ROLL = planOf(ELITE_GAME, [row('RollLeftButton', key('Z'), 'ship')]);

  it('writes the file StartPreset names, in the bindings folder', async () => {
    await writeFile(join(bindings, 'StartPreset.4.start'), 'Custom\r\nCustom\r\nCustom\r\nCustom');
    const outcome = await target().write(ELITE_GAME, ROLL);
    const after = await readFile(join(bindings, 'Custom.4.1.binds'), 'utf8');
    expect({
      ok: outcome.ok,
      roll: harvestEliteBinds(after, ELITE_GAME).game.actions.find((a) => a.id === 'RollLeftButton')
        ?.native?.key,
      copies: await backupsOf('elite'),
    }).toEqual({
      ok: true,
      roll: key('Z'),
      copies: ['2026-11-24 09.30.01.250 Custom.4.1.binds'],
    });
  });

  it("never writes a preset the game ships: one StartPreset names isn't found", async () => {
    await writeFile(join(bindings, 'StartPreset.4.start'), 'KeyboardMouseOnly\r\nCustom');
    const look = await target().look(ELITE_GAME, ROLL);
    expect({
      via: look.via,
      checks: look.checks,
      note: look.note?.startsWith("helmArray can't find Elite Dangerous's controls file"),
    }).toEqual({
      via: 'sheet',
      checks: [],
      note: true,
    });
  });

  it('looks for Elite by its own programs', async () => {
    await writeFile(join(bindings, 'StartPreset.4.start'), 'Custom');
    running = [ELITE_PROGRAM, ES2_PROGRAM];
    expect((await target().look(ELITE_GAME, ROLL)).checks[0]?.text).toBe(
      'Close Elite Dangerous to apply.',
    );
  });
});
