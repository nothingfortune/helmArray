// The game-file target with controller bindings Elite's file can't hold: a file with no controller
// in it (the one made from the game's keyboard and mouse preset, or a player's own never bound to a
// controller) names no device id for one, and helmArray never makes one up. Those rows are set by
// hand (`padByHand`); the rest is written. A file with a controller in it takes them all. Copies of
// reference/game-files in a temp folder.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Game, GameBinding, GameFileFormat, Plan, Signal } from '@helmarray/core';
import { harvestEliteBinds } from '@helmarray/games';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeGameFileDisk } from './game-file-disk';
import type { GameFileKind } from './game-file';
import { GAME_FILE_KINDS, createGameFileTarget } from './game-file';

const REFERENCE = new URL('../../../../reference/game-files/', import.meta.url);
const SHIPPED_BYTES = await readFile(new URL('elite-KeyboardMouseOnly.binds', REFERENCE));
const CUSTOM_BYTES = await readFile(new URL('elite-Custom.4.1.binds', REFERENCE));
const CUSTOM = CUSTOM_BYTES.toString('utf8');
/** The player's own file with every controller binding taken off: it has no controller in it. */
const PADLESS = CUSTOM.replace(
  /<(Primary|Secondary) Device="[^"]*" Key="(Pos_|Neg_)?GamePad_[^"]*"/g,
  '<$1 Device="{NoDevice}" Key=""',
);
const START =
  'KeyboardMouseOnly\r\nKeyboardMouseOnly\r\nKeyboardMouseOnly\r\nKeyboardMouseOnly\r\n';
const PROGRAM = 'Elite-test.exe';
const ELITE = { id: 'elite-dangerous', name: 'Elite Dangerous' };
const GAME: Game = harvestEliteBinds(CUSTOM, ELITE).game;
const KINDS: Record<GameFileFormat, GameFileKind> = {
  'unreal-ini': { ...GAME_FILE_KINDS['unreal-ini'], processNames: ['ES2-test.exe'] },
  'elite-binds': { ...GAME_FILE_KINDS['elite-binds'], processNames: [PROGRAM] },
};

const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;
const pad = (control: string): Signal => ({ kind: 'pad', control }) as Signal;
const row = (set: GameBinding['set'], action: string, signal: Signal | null): GameBinding => ({
  set,
  mode: 'ship',
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
/** Boost on B. */
const KEYS = row('keyboard', 'UseBoostJuice', key('B'));
/** Fire on the controller's RB. */
const PAD = row('controller', 'PrimaryFire', pad('RB'));

let root: string;
let local: string;
let bindings: string;
let install: string;
let customPath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'helm-game-file-pad-'));
  local = join(root, 'local');
  bindings = join(local, 'Frontier Developments', 'Elite Dangerous', 'Options', 'Bindings');
  install = join(root, 'steam', 'steamapps', 'common', 'Elite Dangerous');
  const schemes = join(install, 'Products', 'elite-dangerous-odyssey-64', 'ControlSchemes');
  await mkdir(bindings, { recursive: true });
  await mkdir(schemes, { recursive: true });
  await writeFile(join(schemes, 'KeyboardMouseOnly.binds'), SHIPPED_BYTES);
  customPath = join(bindings, 'Custom.4.1.binds');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const target = () => {
  let clock = Date.UTC(2026, 10, 25, 9, 0, 0, 0);
  return createGameFileTarget({
    disk: nodeGameFileDisk,
    localAppData: [local],
    backupsDir: join(root, 'data', 'backups'),
    listProcesses: () => Promise.resolve(['explorer.exe']),
    now: () => (clock += 1000),
    kinds: KINDS,
    installDir: () => Promise.resolve(install),
  });
};

type FileCase = 'made' | 'no controller' | 'controller';
/** Elite's bindings folder as each case has it. */
async function given(file: FileCase): Promise<void> {
  if (file === 'made') {
    await writeFile(join(bindings, 'StartPreset.4.start'), START);
    return;
  }
  await writeFile(join(bindings, 'StartPreset.4.start'), 'Custom\r\nCustom\r\nCustom\r\nCustom');
  await writeFile(customPath, file === 'controller' ? CUSTOM : PADLESS);
}

/** What the file holds after, for the two actions: Boost's key and Fire's controller button. */
async function holds() {
  const text = await readFile(customPath, 'utf8').catch(() => null);
  const actions = text === null ? [] : harvestEliteBinds(text, ELITE).game.actions;
  const of = (id: string) => actions.find((a) => a.id === id)?.native;
  return { boost: of('UseBoostJuice')?.key ?? null, fire: of('PrimaryFire')?.pad ?? null };
}

const ROWS = { keys: [KEYS], controller: [PAD], both: [KEYS, PAD] } as const;
const FIRE = { set: 'controller', mode: 'ship', action: 'PrimaryFire' };

describe('controller rows a file with no controller in it cannot hold: set by hand, the rest written', () => {
  /** What a cell comes to: rows set by hand, whether the file was written, what it then holds. */
  const cell = (byHand: boolean, written: boolean, boost: string, fire: string | null) => ({
    padByHand: byHand ? [FIRE] : [],
    ready: true,
    ok: true,
    written,
    boost: key(boost),
    fire,
  });
  const cases: [FileCase, keyof typeof ROWS, unknown][] = [
    // A file made is always written: the game doesn't read it until StartPreset names it.
    ['made', 'keys', cell(false, true, 'B', null)],
    ['made', 'controller', cell(true, true, 'Tab', null)],
    ['made', 'both', cell(true, true, 'B', null)],
    ['no controller', 'keys', cell(false, true, 'B', null)],
    // Nothing it can hold changes: it is not written.
    ['no controller', 'controller', cell(true, false, 'Tab', null)],
    ['no controller', 'both', cell(true, true, 'B', null)],
    ['controller', 'keys', cell(false, true, 'B', null)],
    ['controller', 'controller', cell(false, true, 'Tab', 'RB')],
    ['controller', 'both', cell(false, true, 'B', 'RB')],
  ];

  it.each(cases)('a %s file, with %s rows', async (file, rows, expected) => {
    await given(file);
    const plan = planOf([...ROWS[rows]]);
    const look = await target().look(GAME, plan);
    const outcome = await target().write(GAME, plan);
    expect({
      padByHand: look.padByHand ?? [],
      ready: look.via === 'file' && look.checks.every((c) => c.ok),
      ok: outcome.ok,
      written: outcome.written,
      ...(await holds()),
    }).toEqual(expected);
  });
});

describe('what else a file with no controller in it does with a plan', () => {
  it('still refuses a key it has no name for, and names only that', async () => {
    await given('no controller');
    const plan = planOf([row('keyboard', 'UseBoostJuice', key('F13')), PAD]);
    const look = await target().look(GAME, plan);
    expect({ checks: look.checks.map((c) => c.text), padByHand: look.padByHand }).toEqual({
      checks: [
        'Elite Dangerous is closed.',
        "Elite Dangerous's controls file can't take this scheme: Use boost juice: Elite has no name for F13.",
      ],
      padByHand: undefined,
    });
  });

  it("sets by hand a controller button it couldn't name either: there is no controller to put it on", async () => {
    await given('no controller');
    const look = await target().look(
      GAME,
      planOf([row('controller', 'PrimaryFire', pad('START'))]),
    );
    expect({ ok: look.checks.every((c) => c.ok), padByHand: look.padByHand }).toEqual({
      ok: true,
      padByHand: [FIRE],
    });
  });

  it('writes a controller binding taken off: it names no controller', async () => {
    await given('no controller');
    const look = await target().look(GAME, planOf([row('controller', 'PrimaryFire', null)]));
    expect({ padByHand: look.padByHand, same: look.same }).toEqual({
      padByHand: undefined,
      same: true,
    });
  });

  it('lists an action the file lacks with the actions set by hand, never with the controller', async () => {
    await given('no controller');
    const look = await target().look(
      {
        ...GAME,
        actions: [...GAME.actions, { id: 'Mine', name: 'Mine', mode: 'ship', required: false }],
      },
      planOf([row('controller', 'Mine', pad('A')), PAD]),
    );
    expect({ byHand: look.byHand, padByHand: look.padByHand }).toEqual({
      byHand: ['Mine'],
      padByHand: [FIRE],
    });
  });

  it('sets by hand every controller binding of the action, once', async () => {
    await given('made');
    const look = await target().look(
      GAME,
      planOf([
        PAD,
        row('controller', 'PrimaryFire', pad('LB')),
        row('controller', 'SecondaryFire', pad('A')),
      ]),
    );
    expect(look.padByHand).toEqual([FIRE, { ...FIRE, action: 'SecondaryFire' }]);
  });
});
