// The game-file target when Elite has no file of its own: helmArray makes `Custom.4.1.binds` from
// the preset the game ships (a copy of reference/game-files/elite-KeyboardMouseOnly.binds, in a
// temp install folder), writes the bindings into it, and points `StartPreset.4.start` at it last.
// A failure at any step leaves StartPreset as it was and no new file behind.

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Game, GameBinding, GameFileFormat, Plan, Signal } from '@helmarray/core';
import { harvestEliteBinds, newEliteBinds, writeEliteBinds } from '@helmarray/games';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameFileDisk } from './game-file-disk';
import { nodeGameFileDisk } from './game-file-disk';
import type { GameFileDeps, GameFileKind } from './game-file';
import { GAME_FILE_KINDS, createGameFileTarget } from './game-file';

const SHIPPED_BYTES = await readFile(
  new URL('../../../../reference/game-files/elite-KeyboardMouseOnly.binds', import.meta.url),
);
const SHIPPED = new TextDecoder('utf-8', { ignoreBOM: true }).decode(SHIPPED_BYTES);
const START =
  'KeyboardMouseOnly\r\nKeyboardMouseOnly\r\nKeyboardMouseOnly\r\nKeyboardMouseOnly\r\n';
const POINTED = 'Custom\r\nCustom\r\nCustom\r\nCustom\r\n';
const PROGRAM = 'Elite-test.exe';
const GAME: Game = harvestEliteBinds(SHIPPED, {
  id: 'elite-dangerous',
  name: 'Elite Dangerous',
}).game;
const KINDS: Record<GameFileFormat, GameFileKind> = {
  'unreal-ini': { ...GAME_FILE_KINDS['unreal-ini'], processNames: ['ES2-test.exe'] },
  'elite-binds': { ...GAME_FILE_KINDS['elite-binds'], processNames: [PROGRAM] },
};

const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;
const row = (action: string, signal: Signal | null, mode = 'ship'): GameBinding => ({
  set: 'keyboard',
  mode,
  action,
  signal,
  native: null,
});
const planOf = (gameBindings: GameBinding[]): Plan => ({
  units: {},
  bindings: [],
  gameBindings,
  bindSheet: [],
  ledger: {},
  findings: [],
  gameFile: { format: 'elite-binds' },
});
/** Boost moved from Tab to B. */
const MOVED = planOf([row('UseBoostJuice', key('B'))]);
/** Boost where the preset has it: the file is still made, since the game doesn't read it yet. */
const KEPT = planOf([row('UseBoostJuice', key('Tab'))]);
const MADE_TEXT = writeEliteBinds(newEliteBinds(SHIPPED), MOVED.gameBindings);

const NOTE =
  "Elite Dangerous has no controls file of its own yet, so helmArray makes one from the game's keyboard and mouse preset and sets the game to use it.";
const DONE =
  "Elite Dangerous now has the scheme's controls, in a controls file of its own made from the game's keyboard and mouse preset.";

let root: string;
let local: string;
let bindings: string;
let install: string;
let shippedPath: string;
let startPath: string;
let customPath: string;
let backups: string;
let running: string[];
let lines: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'helm-game-file-made-'));
  local = join(root, 'local');
  bindings = join(local, 'Frontier Developments', 'Elite Dangerous', 'Options', 'Bindings');
  install = join(root, 'steam', 'steamapps', 'common', 'Elite Dangerous');
  const schemes = join(install, 'Products', 'elite-dangerous-odyssey-64', 'ControlSchemes');
  await mkdir(bindings, { recursive: true });
  await mkdir(schemes, { recursive: true });
  shippedPath = join(schemes, 'KeyboardMouseOnly.binds');
  startPath = join(bindings, 'StartPreset.4.start');
  customPath = join(bindings, 'Custom.4.1.binds');
  backups = join(root, 'data', 'backups');
  await writeFile(shippedPath, SHIPPED_BYTES);
  await writeFile(startPath, START);
  running = ['explorer.exe'];
  lines = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function target(over: Partial<GameFileDeps> = {}) {
  let clock = Date.UTC(2026, 10, 25, 9, 0, 0, 0);
  return createGameFileTarget({
    disk: nodeGameFileDisk,
    localAppData: [local],
    backupsDir: backups,
    listProcesses: () => Promise.resolve(running),
    now: () => (clock += 1000),
    kinds: KINDS,
    installDir: (format) => Promise.resolve(format === 'elite-binds' ? install : null),
    trace: (line) => lines.push(line),
    ...over,
  });
}

/** What is on disk after: StartPreset as text, whether the new file is there, the shipped preset. */
async function disk() {
  return {
    start: await readFile(startPath, 'utf8'),
    custom: await readFile(customPath).catch(() => null),
    shipped: (await readFile(shippedPath)).equals(SHIPPED_BYTES),
    folder: (await readdir(bindings)).sort(),
  };
}
const backupsOf = async () => readdir(join(backups, 'elite-dangerous')).catch(() => [] as string[]);

/** The real disk, with the steps a test names made to fail. */
function failing(fail: {
  write?: (path: string, nth: number) => boolean;
  read?: (path: string, nth: number) => Uint8Array | null | 'real';
  /** True: the remove fails; `stays`: it succeeds, and the file is still there. */
  remove?: (path: string) => boolean | 'stays';
}): GameFileDisk {
  const writes = new Map<string, number>();
  const reads = new Map<string, number>();
  return {
    ...nodeGameFileDisk,
    write: (path, bytes) => {
      const nth = (writes.get(path) ?? 0) + 1;
      writes.set(path, nth);
      return fail.write?.(path, nth) === true
        ? Promise.reject(new Error('the disk is full'))
        : nodeGameFileDisk.write(path, bytes);
    },
    read: (path) => {
      const nth = (reads.get(path) ?? 0) + 1;
      reads.set(path, nth);
      const got = fail.read === undefined ? 'real' : fail.read(path, nth);
      return got === 'real' ? nodeGameFileDisk.read(path) : Promise.resolve(got);
    },
    remove: (path) => {
      const how = fail.remove?.(path);
      if (how === 'stays') return Promise.resolve();
      return how === true
        ? Promise.reject(new Error('the file is in use'))
        : nodeGameFileDisk.remove(path);
    },
  };
}

describe('Elite with no file of its own: what the drawer says', () => {
  it('names the new file and says in one sentence that it is made from the shipped preset', async () => {
    expect(await target().look(GAME, MOVED)).toEqual({
      via: 'file',
      note: NOTE,
      name: 'Custom.4.1.binds',
      same: false,
      byHand: [],
      checks: [{ ok: true, kind: 'game', text: 'Elite Dangerous is closed.' }],
    });
  });

  it('never says the file holds the bindings already: there is no file yet', async () => {
    expect((await target().look(GAME, KEPT)).same).toBe(false);
  });

  it('asks for the game to be closed while it runs', async () => {
    running = ['explorer.exe', PROGRAM];
    expect((await target().look(GAME, MOVED)).checks).toEqual([
      { ok: false, kind: 'game', text: 'Close Elite Dangerous to apply.' },
    ]);
  });

  it("leaves the bindings to set by hand, as before, without the install folder or the game's preset", async () => {
    const missing = {
      via: 'sheet',
      note: "helmArray can't find Elite Dangerous's controls file, so set these in the game's own menu (changing any control there makes the game save one).",
      name: null,
      same: false,
      byHand: [],
      checks: [],
    };
    const noInstall = await target({ installDir: () => Promise.resolve(null) }).look(GAME, MOVED);
    const throws = await target({
      installDir: () => Promise.reject(new Error('Steam is gone')),
    }).look(GAME, MOVED);
    await rm(shippedPath);
    const noPreset = await target().look(GAME, MOVED);
    expect({ noInstall, throws, noPreset, said: lines }).toEqual({
      noInstall: missing,
      throws: missing,
      noPreset: missing,
      said: ["couldn't find elite-dangerous's install folder: Steam is gone"],
    });
  });

  it("leaves Elite to the bind sheet as the app ships: its program isn't known", async () => {
    expect(await target({ kinds: GAME_FILE_KINDS }).look(GAME, MOVED)).toEqual({
      via: 'sheet',
      note: null,
      name: null,
      same: false,
      byHand: [],
      checks: [],
    });
  });

  it("says why when the game's preset can't be read, or isn't text, or has no root", async () => {
    const said = async (bytes: Uint8Array | Error) => {
      const disk: GameFileDisk = {
        ...nodeGameFileDisk,
        read: (path) =>
          path === shippedPath
            ? bytes instanceof Error
              ? Promise.reject(bytes)
              : Promise.resolve(bytes)
            : nodeGameFileDisk.read(path),
      };
      return (await target({ disk }).look(GAME, MOVED)).checks[1]?.text;
    };
    expect([
      await said(new Error('access denied.')),
      await said(Uint8Array.from([0xff, 0xfe, 0x00])),
      await said(new TextEncoder().encode('<?xml?>\r\n<Rooted />\r\n')),
    ]).toEqual([
      "helmArray couldn't read the game's keyboard and mouse preset (access denied).",
      "The game's keyboard and mouse preset isn't text helmArray can read.",
      "Elite Dangerous's controls file can't be made: the game's preset has no Root line to make the new file from.",
    ]);
  });

  it("says why when StartPreset can't be read, or isn't text, and leaves it to the sheet once it is gone", async () => {
    const said = async (bytes: Uint8Array | Error | null) => {
      const disk: GameFileDisk = {
        ...nodeGameFileDisk,
        read: (path) =>
          path === startPath
            ? bytes instanceof Error
              ? Promise.reject(bytes)
              : Promise.resolve(bytes)
            : nodeGameFileDisk.read(path),
      };
      const look = await target({ disk }).look(GAME, MOVED);
      return look.via === 'sheet' ? look.note : look.checks[1]?.text;
    };
    expect([
      await said(new Error('access denied')),
      await said(Uint8Array.from([0xff, 0xfe, 0x00])),
      await said(null),
    ]).toEqual([
      "helmArray couldn't read StartPreset.4.start, the file that picks Elite Dangerous's controls (access denied).",
      "StartPreset.4.start, the file that picks Elite Dangerous's controls, isn't text helmArray can read.",
      "helmArray can't find Elite Dangerous's controls file, so set these in the game's own menu (changing any control there makes the game save one).",
    ]);
  });
});

describe('Elite with no file of its own: Apply makes it', () => {
  it('makes the file from the preset with the bindings in it, then points StartPreset at it', async () => {
    const outcome = await target().write(GAME, MOVED);
    const copies = await backupsOf();
    expect({
      outcome,
      ...(await disk()),
      custom: (await readFile(customPath, 'utf8')) === MADE_TEXT,
      copies: copies.length,
      copy: (await readFile(join(backups, 'elite-dangerous', copies[0] ?? ''), 'utf8')) === START,
      copyName: copies[0]?.endsWith(' StartPreset.4.start'),
    }).toEqual({
      outcome: { ok: true, written: true, message: DONE },
      start: POINTED,
      custom: true,
      shipped: true,
      folder: ['Custom.4.1.binds', 'StartPreset.4.start'],
      copies: 1,
      copy: true,
      copyName: true,
    });
  });

  it('writes the bytes of the preset, BOM and CRLF, with only the root and the moved binding changed', async () => {
    await target().write(GAME, MOVED);
    const before = SHIPPED_BYTES.toString('latin1').split('\r\n');
    const after = (await readFile(customPath)).toString('latin1').split('\r\n');
    expect({
      bom: [...(await readFile(customPath)).subarray(0, 3)],
      changed: after.flatMap((line, i) => (line === before[i] ? [] : [line])),
    }).toEqual({
      bom: [0xef, 0xbb, 0xbf],
      changed: [
        '<Root PresetName="Custom" MajorVersion="4" MinorVersion="1">',
        '\t\t<Primary Device="Keyboard" Key="Key_B" />',
      ],
    });
  });

  it('makes the file even when the bindings are the preset’s own', async () => {
    expect({ outcome: await target().write(GAME, KEPT), start: (await disk()).start }).toEqual({
      outcome: { ok: true, written: true, message: DONE },
      start: POINTED,
    });
  });

  it('the next look finds the file it made, and holds the bindings', async () => {
    await target().write(GAME, MOVED);
    expect(await target().look(GAME, MOVED)).toEqual({
      via: 'file',
      note: null,
      name: 'Custom.4.1.binds',
      same: true,
      byHand: [],
      checks: [{ ok: true, kind: 'game', text: 'Elite Dangerous is closed.' }],
    });
  });

  it('refuses while the game runs, and touches nothing', async () => {
    running = ['explorer.exe', PROGRAM];
    expect({
      outcome: await target().write(GAME, MOVED),
      ...(await disk()),
      copies: await backupsOf(),
    }).toEqual({
      outcome: { ok: false, written: false, message: 'Close Elite Dangerous to apply.' },
      start: START,
      custom: null,
      shipped: true,
      folder: ['StartPreset.4.start'],
      copies: [],
    });
  });
});

describe('Elite with no file of its own: a failure at any step leaves StartPreset and no new file', () => {
  const LEFT = ', so the game was left as it was.';
  const cases: [string, Parameters<typeof failing>[0], string][] = [
    [
      'keeping the copy of StartPreset',
      { write: (path) => path.startsWith(backups) },
      "Elite Dangerous's controls file wasn't made: helmArray couldn't keep a copy of StartPreset.4.start first (the disk is full).",
    ],
    [
      'writing the new file',
      { write: (path, nth) => path === customPath && nth === 1 },
      `Elite Dangerous's controls file couldn't be written (the disk is full)${LEFT}`,
    ],
    [
      'writing the bindings into it',
      { write: (path, nth) => path === customPath && nth === 2 },
      `Elite Dangerous's controls file couldn't be written (the disk is full)${LEFT}`,
    ],
    [
      'reading it back',
      {
        read: (path, nth) =>
          path === customPath && nth === 1 ? new TextEncoder().encode(SHIPPED) : 'real',
      },
      `Elite Dangerous's controls file didn't read back as it was written${LEFT}`,
    ],
    [
      'reading it back, not there',
      { read: (path, nth) => (path === customPath && nth === 1 ? null : 'real') },
      `Elite Dangerous's controls file didn't read back as it was written${LEFT}`,
    ],
    [
      'reading it back, not text',
      {
        read: (path, nth) =>
          path === customPath && nth === 1 ? Uint8Array.from([0xff, 0xfe]) : 'real',
      },
      `Elite Dangerous's controls file didn't read back as it was written${LEFT}`,
    ],
    [
      'pointing StartPreset at it',
      { write: (path) => path === startPath },
      `StartPreset.4.start couldn't be written (the disk is full)${LEFT}`,
    ],
    [
      'reading StartPreset back',
      {
        // The first read is the write's own look; the second, the read back after pointing it.
        read: (path, nth) =>
          path === startPath && nth === 2 ? new TextEncoder().encode(START) : 'real',
      },
      `StartPreset.4.start didn't read back as it was written${LEFT}`,
    ],
  ];

  for (const [step, fail, message] of cases) {
    it(`at ${step}`, async () => {
      const outcome = await target({ disk: failing(fail) }).write(GAME, MOVED);
      expect({ outcome, ...(await disk()) }).toEqual({
        outcome: { ok: false, written: false, message },
        start: START,
        custom: null,
        shipped: true,
        folder: ['StartPreset.4.start'],
      });
    });
  }

  it('says so when the new file can’t be removed after a failure: the game still reads its preset', async () => {
    const outcome = await target({
      disk: failing({
        write: (path, nth) => path === customPath && nth === 2,
        remove: (path) => path === customPath,
      }),
    }).write(GAME, MOVED);
    expect({ outcome, start: (await disk()).start }).toEqual({
      outcome: {
        ok: false,
        written: false,
        message:
          "Elite Dangerous's controls file couldn't be written (the disk is full), and helmArray couldn't remove the Custom.4.1.binds it began, though the game doesn't read it.",
      },
      start: START,
    });
  });

  it("says where the copy is when StartPreset can't be put back", async () => {
    // StartPreset reads back as neither what was meant nor what it was, however often it is put back.
    const partly = failing({
      read: (path, nth) =>
        path === startPath && nth >= 2 ? new TextEncoder().encode('Custom\r\n') : 'real',
    });
    const lost = await target({ disk: partly }).write(GAME, MOVED);
    const copies = await backupsOf();
    expect({ lost, custom: (await disk()).custom }).toEqual({
      lost: {
        ok: false,
        written: false,
        message: `StartPreset.4.start didn't read back as it was written, and couldn't be put back: a copy of it is in helmArray's backups folder, as “${copies.at(-1) ?? ''}”.`,
      },
      custom: null,
    });
  });
});

describe('Elite with no file of its own: what the log says, and the edges of putting things back', () => {
  it('notes the copy kept and the file made', async () => {
    await target().write(GAME, MOVED);
    const [copy] = await backupsOf();
    expect(lines).toEqual([
      `elite-dangerous: kept a copy of ${startPath} as ${copy ?? ''}`,
      `elite-dangerous: made ${customPath} from ${shippedPath}, and pointed ${startPath} at it`,
    ]);
  });

  it('notes why no copy could be kept', async () => {
    await target({ disk: failing({ write: (path) => path.startsWith(backups) }) }).write(
      GAME,
      MOVED,
    );
    expect(lines).toEqual([
      `elite-dangerous: no copy of ${startPath} could be kept: the disk is full`,
    ]);
  });

  it('notes what failed, and why the new file could not be removed', async () => {
    await target({
      disk: failing({
        write: (path, nth) => path === customPath && nth === 2,
        remove: (path) => path === customPath,
      }),
    }).write(GAME, MOVED);
    expect(lines.slice(1)).toEqual([
      "elite-dangerous: Elite Dangerous's controls file couldn't be written (the disk is full)",
      `elite-dangerous: couldn't remove ${customPath}: the file is in use`,
    ]);
  });

  it('never touches StartPreset to put it back when it failed before pointing it', async () => {
    // StartPreset can't be read once the write began: putting it back would say it is lost.
    const outcome = await target({
      disk: failing({
        write: (path, nth) => path === customPath && nth === 2,
        read: (path, nth) => {
          if (path === startPath && nth >= 2) throw new Error('locked');
          return 'real';
        },
      }),
    }).write(GAME, MOVED);
    expect(outcome.message).toBe(
      "Elite Dangerous's controls file couldn't be written (the disk is full), so the game was left as it was.",
    );
  });

  it('says so when the new file is still there after it was removed', async () => {
    const outcome = await target({
      disk: failing({
        write: (path, nth) => path === customPath && nth === 2,
        remove: (path) => (path === customPath ? 'stays' : false),
      }),
    }).write(GAME, MOVED);
    expect(outcome.message).toBe(
      "Elite Dangerous's controls file couldn't be written (the disk is full), and helmArray couldn't remove the Custom.4.1.binds it began, though the game doesn't read it.",
    );
  });

  it("refuses to write when the game's preset can't be read, and says why", async () => {
    const disk: GameFileDisk = {
      ...nodeGameFileDisk,
      read: (path) =>
        path === shippedPath
          ? Promise.reject(new Error('access denied'))
          : nodeGameFileDisk.read(path),
    };
    expect(await target({ disk }).write(GAME, MOVED)).toEqual({
      ok: false,
      written: false,
      message: "helmArray couldn't read the game's keyboard and mouse preset (access denied).",
    });
  });

  it('says why when the new file can’t be made for a reason of its own', async () => {
    const elite = KINDS['elite-binds'];
    const kinds = {
      ...KINDS,
      'elite-binds': {
        ...elite,
        make: (
          where: Parameters<NonNullable<GameFileKind['make']>>[0],
          folders: Parameters<NonNullable<GameFileKind['make']>>[1],
        ) => {
          const made = elite.make?.(where, folders) ?? null;
          return made === null
            ? null
            : {
                ...made,
                build: () => {
                  throw new Error('The preset is broken.');
                },
              };
        },
      },
    };
    expect((await target({ kinds }).look(GAME, MOVED)).checks[1]?.text).toBe(
      "Elite Dangerous's controls file can't be made: the preset is broken.",
    );
  });

  it("never asks to make a file when the game's own is found", async () => {
    await writeFile(customPath, MADE_TEXT);
    await writeFile(startPath, POINTED);
    const kinds = {
      ...KINDS,
      'elite-binds': {
        ...KINDS['elite-binds'],
        make: () => {
          throw new Error('asked to make a file');
        },
      },
    };
    expect(await target({ kinds }).look(GAME, MOVED)).toMatchObject({
      via: 'file',
      note: null,
      same: true,
    });
  });
});
