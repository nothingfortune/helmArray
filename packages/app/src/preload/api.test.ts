import { blankKeysScheme } from '@helmarray/core';
import type { Game } from '@helmarray/core';
import { describe, expect, it } from 'vitest';
import type { AppState } from '../shared/api';
import { CHANNELS } from '../shared/api';
import { createHelmApi } from './api';
import type { IpcBridge } from './api';

const STATE: AppState = {
  devices: [],
  sync: { label: 'Not checked yet', tone: 'warning' },
  writeBlock: null,
  question: null,
  activeGameId: null,
  activeSchemeId: null,
  onUnits: { left: null, right: null },
  sheets: [],
};

function bridge() {
  const invoked: [string, unknown[]][] = [];
  const listeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>();
  const ipc: IpcBridge = {
    invoke: (channel, ...args) => {
      invoked.push([channel, args]);
      return Promise.resolve(channel === CHANNELS.recentLog ? ['a line'] : STATE);
    },
    on: (channel, listener) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
    },
    removeListener: (channel, listener) => void listeners.get(channel)?.delete(listener),
  };
  const emit = (channel: string, ...args: unknown[]) => {
    for (const listener of [...(listeners.get(channel) ?? [])])
      listener({ sender: 'electron' }, ...args);
  };
  return { ipc, invoked, listeners, emit };
}

describe('window.helm', () => {
  it('asks the state over its channel', async () => {
    const b = bridge();
    expect(await createHelmApi(b.ipc).state()).toEqual(STATE);
    expect(b.invoked).toEqual([[CHANNELS.state, []]]);
  });

  it('gives a listener the state, never the event', () => {
    const b = bridge();
    const seen: unknown[][] = [];
    createHelmApi(b.ipc).onState((...args: unknown[]) => void seen.push(args));
    b.emit(CHANNELS.stateChanged, STATE);
    expect(seen).toEqual([[STATE]]);
  });

  it('stops listening when told to', () => {
    const b = bridge();
    const seen: unknown[] = [];
    const stop = createHelmApi(b.ipc).onState((state) => void seen.push(state));
    stop();
    b.emit(CHANNELS.stateChanged, STATE);
    expect(seen).toEqual([]);
    expect(b.listeners.get(CHANNELS.stateChanged)?.size).toBe(0);
  });

  it('keeps two listeners apart', () => {
    const b = bridge();
    const api = createHelmApi(b.ipc);
    const first: unknown[] = [];
    const second: unknown[] = [];
    const stopFirst = api.onState((state) => void first.push(state));
    api.onState((state) => void second.push(state));
    stopFirst();
    b.emit(CHANNELS.stateChanged, STATE);
    expect([first.length, second.length]).toEqual([0, 1]);
  });

  it('sends a hand choice with the unit and the hand', async () => {
    const b = bridge();
    await createHelmApi(b.ipc).chooseHand(49229, 'left');
    expect(b.invoked).toEqual([[CHANNELS.chooseHand, [49229, 'left']]]);
  });

  it('asks for the log lines, and gets them', async () => {
    const b = bridge();
    expect(await createHelmApi(b.ipc).recentLog(20)).toEqual(['a line']);
    expect(b.invoked).toEqual([[CHANNELS.recentLog, [20]]]);
  });

  it('asks to open the log folder', async () => {
    const b = bridge();
    await createHelmApi(b.ipc).openLogFolder();
    expect(b.invoked).toEqual([[CHANNELS.openLogFolder, []]]);
  });

  it('resolves chooseHand and openLogFolder with nothing', async () => {
    const api = createHelmApi(bridge().ipc);
    expect(await api.chooseHand(1, 'right')).toBeUndefined();
    expect(await api.openLogFolder()).toBeUndefined();
  });

  it('asks for the library over its own channel, asking for a fresh read only with `true`', async () => {
    const b = bridge();
    const api = createHelmApi(b.ipc);
    await api.listLibrary();
    await api.listLibrary(true);
    expect(b.invoked).toEqual([
      [CHANNELS.listLibrary, [false]],
      [CHANNELS.listLibrary, [true]],
    ]);
  });

  describe('the games and schemes', () => {
    const game: Game = {
      id: 'skiff',
      name: 'Skiff',
      modes: [{ id: 'ship', name: 'Ship' }],
      actions: [],
    };
    const scheme = blankKeysScheme(game);

    it('asks each question over its own channel, with its arguments', async () => {
      const b = bridge();
      const api = createHelmApi(b.ipc);
      await api.listGames();
      await api.getScheme('skiff-own-keys');
      await api.listSchemes('skiff');
      await api.createScheme('skiff', 'xbox');
      await api.copyScheme('skiff-own-keys');
      await api.deleteScheme('skiff-own-keys');
      await api.saveScheme(scheme);
      await api.setActive('skiff', 'skiff-own-keys');
      await api.setActive('skiff', null);
      await api.previewApply('skiff-own-keys');
      await api.apply('skiff-own-keys', 'abc');
      await api.saveGame(game);
      await api.deleteGame('skiff');
      await api.dismissSheet('skiff');
      await api.readGameFile('skiff');
      expect(b.invoked).toEqual([
        [CHANNELS.listGames, []],
        [CHANNELS.getScheme, ['skiff-own-keys']],
        [CHANNELS.listSchemes, ['skiff']],
        [CHANNELS.createScheme, ['skiff', 'xbox']],
        [CHANNELS.copyScheme, ['skiff-own-keys']],
        [CHANNELS.deleteScheme, ['skiff-own-keys']],
        [CHANNELS.saveScheme, [scheme]],
        [CHANNELS.setActive, ['skiff', 'skiff-own-keys']],
        [CHANNELS.setActive, ['skiff', null]],
        [CHANNELS.previewApply, ['skiff-own-keys']],
        [CHANNELS.apply, ['skiff-own-keys', 'abc']],
        [CHANNELS.saveGame, [game]],
        [CHANNELS.deleteGame, ['skiff']],
        [CHANNELS.dismissSheet, ['skiff']],
        [CHANNELS.readGameFile, ['skiff']],
      ]);
    });

    it('gives back what main answers, and nothing from the writes', async () => {
      const answers = new Map<string, unknown>([
        [CHANNELS.listGames, [{ game: { id: 'skiff' }, builtIn: true }]],
        [CHANNELS.getScheme, scheme],
        [CHANNELS.createScheme, scheme],
        [CHANNELS.copyScheme, scheme],
      ]);
      const ipc: IpcBridge = {
        invoke: (channel) => Promise.resolve(answers.get(channel) ?? 'something'),
        on: () => undefined,
        removeListener: () => undefined,
      };
      const api = createHelmApi(ipc);
      expect(await api.listGames()).toEqual([{ game: { id: 'skiff' }, builtIn: true }]);
      expect(await api.getScheme('x')).toBe(scheme);
      expect(await api.createScheme('skiff', 'keys')).toBe(scheme);
      expect(await api.copyScheme('x')).toBe(scheme);
      expect(await api.saveScheme(scheme)).toBeUndefined();
      expect(await api.deleteScheme('x')).toBeUndefined();
      expect(await api.setActive('skiff', null)).toBeUndefined();
      expect([
        await api.saveGame(game),
        await api.deleteGame('skiff'),
        await api.dismissSheet('skiff'),
      ]).toEqual([undefined, undefined, undefined]);
    });
  });
});
