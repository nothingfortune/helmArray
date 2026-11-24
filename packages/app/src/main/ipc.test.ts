import { blankKeysScheme } from '@helmarray/core';
import type { Game } from '@helmarray/core';
import { describe, expect, it, vi } from 'vitest';
import type { AppState, ApplyPreview, ApplyUnitChange } from '../shared/api';
import { CHANNELS } from '../shared/api';
import { MAX_LOG_LINES, registerHelmIpc } from './ipc';
import type { HelmHandlers, IpcRegistry } from './ipc';

const STATE: AppState = {
  devices: [],
  sync: { label: 'Units not connected', tone: 'warning' },
  writeBlock: null,
  question: null,
  activeGameId: null,
  activeSchemeId: null,
  onUnits: { left: null, right: null },
};

const GAME: Game = {
  id: 'skiff',
  name: 'Skiff',
  modes: [{ id: 'ship', name: 'Ship' }],
  actions: [],
};
const SCHEME = blankKeysScheme(GAME);
const UNIT: Omit<ApplyUnitChange, 'hand'> = {
  used: true,
  connected: true,
  differs: false,
  inputsChanged: 0,
  write: null,
  deletes: [],
  changes: [],
  problem: null,
};
const PREVIEW: ApplyPreview = {
  schemeId: SCHEME.id,
  schemeName: 'Skiff',
  gameName: 'Skiff',
  fingerprint: 'abc',
  ready: true,
  azeronOpen: false,
  busy: false,
  checks: [],
  anyChange: false,
  left: { hand: 'left', ...UNIT },
  right: { hand: 'right', ...UNIT },
  game: { via: 'sheet', rows: [] },
};

function setup() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const registry: IpcRegistry = {
    handle: (channel, listener) => void handlers.set(channel, listener),
    removeHandler: (channel) => void handlers.delete(channel),
  };
  const calls = {
    chooseHand: vi.fn(() => Promise.resolve()),
    recentLog: vi.fn((lines: number) => Promise.resolve([`${lines}`])),
    openLogFolder: vi.fn(() => Promise.resolve()),
    listGames: vi.fn(() => Promise.resolve([{ game: GAME, builtIn: true }])),
    listLibrary: vi.fn<HelmHandlers['listLibrary']>(() => Promise.resolve([])),
    getScheme: vi.fn<HelmHandlers['getScheme']>(() => Promise.resolve(SCHEME)),
    listSchemes: vi.fn<HelmHandlers['listSchemes']>(() => Promise.resolve([SCHEME])),
    createScheme: vi.fn<HelmHandlers['createScheme']>(() => Promise.resolve(SCHEME)),
    copyScheme: vi.fn<HelmHandlers['copyScheme']>(() => Promise.resolve(SCHEME)),
    deleteScheme: vi.fn<HelmHandlers['deleteScheme']>(() => Promise.resolve()),
    saveScheme: vi.fn<HelmHandlers['saveScheme']>(() => Promise.resolve()),
    setActive: vi.fn<HelmHandlers['setActive']>(() => Promise.resolve()),
    previewApply: vi.fn<HelmHandlers['previewApply']>(() => Promise.resolve(PREVIEW)),
    apply: vi.fn<HelmHandlers['apply']>(() =>
      Promise.resolve({ ok: true, message: 'Done.', units: [] }),
    ),
    saveGame: vi.fn<HelmHandlers['saveGame']>(() => Promise.resolve()),
    deleteGame: vi.fn<HelmHandlers['deleteGame']>(() => Promise.resolve()),
  };
  const off = registerHelmIpc(registry, { state: () => STATE, ...calls });
  const call = (channel: string, ...args: unknown[]) =>
    Promise.resolve().then(() => handlers.get(channel)?.({}, ...args));
  return { handlers, calls, call, off };
}

describe('the IPC channels', () => {
  it('registers every channel the windows use', () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual(
      [
        CHANNELS.state,
        CHANNELS.chooseHand,
        CHANNELS.recentLog,
        CHANNELS.openLogFolder,
        CHANNELS.listGames,
        CHANNELS.listLibrary,
        CHANNELS.getScheme,
        CHANNELS.listSchemes,
        CHANNELS.createScheme,
        CHANNELS.copyScheme,
        CHANNELS.deleteScheme,
        CHANNELS.saveScheme,
        CHANNELS.setActive,
        CHANNELS.previewApply,
        CHANNELS.apply,
        CHANNELS.saveGame,
        CHANNELS.deleteGame,
      ].sort(),
    );
  });

  it('answers the state', async () => {
    expect(await setup().call(CHANNELS.state)).toEqual(STATE);
  });

  it('passes a hand choice through', async () => {
    const { call, calls } = setup();
    await call(CHANNELS.chooseHand, 49229, 'left');
    expect(calls.chooseHand).toHaveBeenCalledWith(49229, 'left');
  });

  it.each([
    ['a unit id that is not a number', '49229', 'left'],
    ['a unit id that is not whole', 1.5, 'left'],
    ['a hand that is not one', 49229, 'middle'],
    ['no hand', 49229, undefined],
  ])('refuses %s', async (_name, unitId, hand) => {
    const { call, calls } = setup();
    await expect(call(CHANNELS.chooseHand, unitId, hand)).rejects.toThrow(TypeError);
    expect(calls.chooseHand).not.toHaveBeenCalled();
  });

  it('asks for the lines it is told, within bounds', async () => {
    const { call, calls } = setup();
    await call(CHANNELS.recentLog, 50.9);
    await call(CHANNELS.recentLog, 1_000_000);
    await call(CHANNELS.recentLog, -3);
    await call(CHANNELS.recentLog, 'lots');
    await call(CHANNELS.recentLog, Number.NaN);
    expect(calls.recentLog.mock.calls.map(([lines]) => lines)).toEqual([
      50,
      MAX_LOG_LINES,
      0,
      0,
      0,
    ]);
  });

  it('opens the log folder', async () => {
    const { call, calls } = setup();
    await call(CHANNELS.openLogFolder);
    expect(calls.openLogFolder).toHaveBeenCalledTimes(1);
  });

  it('lists the games', async () => {
    expect(await setup().call(CHANNELS.listGames)).toEqual([{ game: GAME, builtIn: true }]);
  });

  it('lists the library, asking for a fresh read only when told to with `true`', async () => {
    const { call, calls } = setup();
    expect(await call(CHANNELS.listLibrary)).toEqual([]);
    await call(CHANNELS.listLibrary, true);
    await call(CHANNELS.listLibrary, 'yes');
    await call(CHANNELS.listLibrary, 1);
    expect(calls.listLibrary.mock.calls).toEqual([[false], [true], [false], [false]]);
  });

  it('passes ids and presets through', async () => {
    const { call, calls } = setup();
    expect(await call(CHANNELS.getScheme, 'skiff-own-keys')).toEqual(SCHEME);
    expect(await call(CHANNELS.listSchemes, 'skiff')).toEqual([SCHEME]);
    await call(CHANNELS.createScheme, 'skiff', 'xbox');
    await call(CHANNELS.createScheme, 'skiff', 'keys');
    await call(CHANNELS.setActive, 'skiff', 'skiff-own-keys');
    await call(CHANNELS.setActive, 'skiff', null);
    expect(calls.getScheme).toHaveBeenCalledWith('skiff-own-keys');
    expect(calls.listSchemes).toHaveBeenCalledWith('skiff');
    expect(calls.createScheme.mock.calls).toEqual([
      ['skiff', 'xbox'],
      ['skiff', 'keys'],
    ]);
    expect(calls.setActive.mock.calls).toEqual([
      ['skiff', 'skiff-own-keys'],
      ['skiff', null],
    ]);
  });

  it('passes a scheme id to Apply and its preview, and refuses what is not an id', async () => {
    const { call, calls } = setup();
    expect(await call(CHANNELS.previewApply, 'skiff-own-keys')).toEqual(PREVIEW);
    expect(await call(CHANNELS.apply, 'skiff-own-keys', 'abc')).toEqual({
      ok: true,
      message: 'Done.',
      units: [],
    });
    expect(calls.previewApply).toHaveBeenCalledWith('skiff-own-keys');
    expect(calls.apply).toHaveBeenCalledWith('skiff-own-keys', 'abc');
    await expect(call(CHANNELS.apply, '../x', 'abc')).rejects.toThrow(TypeError);
    await expect(call(CHANNELS.apply, 'skiff-own-keys')).rejects.toThrow(TypeError);
    await expect(call(CHANNELS.apply, 'skiff-own-keys', 7)).rejects.toThrow(TypeError);
    await expect(call(CHANNELS.previewApply, 42)).rejects.toThrow(TypeError);
    expect(calls.apply).toHaveBeenCalledTimes(1);
  });

  it('takes the Apply channels off with the rest', () => {
    const { handlers, off } = setup();
    off();
    expect(handlers.size).toBe(0);
  });

  it('passes the scheme to copy or delete through', async () => {
    const { call, calls } = setup();
    expect(await call(CHANNELS.copyScheme, 'skiff-own-keys')).toEqual(SCHEME);
    await call(CHANNELS.deleteScheme, 'skiff-xbox-1');
    expect([calls.copyScheme.mock.calls, calls.deleteScheme.mock.calls]).toEqual([
      [['skiff-own-keys']],
      [['skiff-xbox-1']],
    ]);
  });

  it('passes a scheme to be saved through', async () => {
    const { call, calls } = setup();
    await call(CHANNELS.saveScheme, SCHEME);
    expect(calls.saveScheme).toHaveBeenCalledWith(SCHEME);
  });

  it.each([
    ['getScheme', ['../settings']],
    ['getScheme', ['__proto__']],
    ['listSchemes', ['con']],
    ['getScheme', [42]],
    ['listSchemes', ['a/b']],
    ['createScheme', ['skiff', 'mine']],
    ['createScheme', ['skiff']],
    ['createScheme', ['..', 'xbox']],
    ['copyScheme', ['../x']],
    ['copyScheme', [undefined]],
    ['deleteScheme', ['con']],
    ['deleteScheme', [7]],
    ['saveScheme', [{ id: 'x' }]],
    ['saveScheme', [null]],
    ['saveScheme', [{ ...SCHEME, id: '../escape' }]],
    ['setActive', ['skiff', 42]],
    ['setActive', ['skiff', 'a b']],
    ['setActive', [undefined, null]],
  ] as const)('refuses %s with %j', async (name, args) => {
    const { call, calls } = setup();
    await expect(call(CHANNELS[name], ...args)).rejects.toThrow(TypeError);
    for (const fn of Object.values(calls)) expect(fn).not.toHaveBeenCalled();
  });

  it('takes every channel off again', () => {
    const { handlers, off } = setup();
    off();
    expect(handlers.size).toBe(0);
  });
});

describe('the game channels', () => {
  const ROVER: Game = {
    id: 'rover',
    name: 'Rover',
    modes: [{ id: 'default', name: 'Default' }],
    actions: [
      {
        id: 'jump',
        name: 'Jump',
        mode: 'default',
        role: 'movement',
        required: false,
        native: { key: { kind: 'key', code: 'Space' }, pad: 'A' },
      },
    ],
  };

  it('passes a game to be saved through', async () => {
    const { call, calls } = setup();
    await call(CHANNELS.saveGame, ROVER);
    expect(calls.saveGame).toHaveBeenCalledWith(ROVER);
  });

  it('passes a game id to be deleted through', async () => {
    const { call, calls } = setup();
    await call(CHANNELS.deleteGame, 'rover');
    expect(calls.deleteGame).toHaveBeenCalledWith('rover');
  });

  it.each([
    ['saveGame', [null], "saveGame: this isn't a game helmArray can read."],
    [
      'saveGame',
      [{ ...ROVER, id: '../settings' }],
      "saveGame: this game's id can't be used as a file name.",
    ],
    [
      'saveGame',
      [{ ...ROVER, modes: [{ id: '__proto__', name: 'Ship' }] }],
      "saveGame: the mode Ship has an id helmArray can't use.",
    ],
    [
      'saveGame',
      [{ ...ROVER, actions: [{ ...ROVER.actions[0], native: { pad: 'Z' } }] }],
      "saveGame: Jump's default controller button isn't one an Xbox controller has.",
    ],
    ['deleteGame', ['con'], "deleteGame: that isn't an id."],
    ['deleteGame', [7], "deleteGame: that isn't an id."],
  ] as const)('refuses %s with %j, saying why', async (name, args, message) => {
    const { call, calls } = setup();
    await expect(call(CHANNELS[name], ...args)).rejects.toThrow(message);
    for (const fn of Object.values(calls)) expect(fn).not.toHaveBeenCalled();
  });
});
