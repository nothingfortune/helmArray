import { describe, expect, it, vi } from 'vitest';
import type { AppState } from '../shared/api';
import { CHANNELS } from '../shared/api';
import { MAX_LOG_LINES, registerHelmIpc } from './ipc';
import type { IpcRegistry } from './ipc';

const STATE: AppState = {
  devices: [],
  sync: { label: 'Units not connected', tone: 'warning' },
  writeBlock: null,
  question: null,
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
      [CHANNELS.state, CHANNELS.chooseHand, CHANNELS.recentLog, CHANNELS.openLogFolder].sort(),
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

  it('takes every channel off again', () => {
    const { handlers, off } = setup();
    off();
    expect(handlers.size).toBe(0);
  });
});
