import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTasklistCsv } from './process-list';
import type { ProcessState } from './processes';
import { azeronAppRunning, programRunning, watchProcesses, writeBlock } from './processes';

describe('azeronAppRunning', () => {
  it.each([
    ['Azeron Software.exe'],
    ['azeron software.exe'],
    ['AZERON SOFTWARE.EXE'],
    ['Azeron Software'],
    [' Azeron Software.exe '],
  ])('knows %s', (name) => {
    expect(azeronAppRunning(['explorer.exe', name])).toBe(true);
  });

  it.each([[[]], [['explorer.exe', 'EliteDangerous64.exe']], [['Azeron Software Helper.exe']]])(
    'is false when it is not there: %j',
    (names) => {
      expect(azeronAppRunning(names)).toBe(false);
    },
  );
});

describe('programRunning', () => {
  it.each([['Game.exe'], ['game.EXE'], ['GAME'], [' Game.exe ']])(
    'knows a program of the list as %s, in any case, with or without .exe',
    (name) => {
      expect(programRunning(['explorer.exe', name], ['Other.exe', 'Game.exe'])).toBe(true);
    },
  );

  it.each([
    [['explorer.exe'], ['Game.exe']],
    [['Game Launcher.exe'], ['Game.exe']],
    [['Game.exe'], []],
  ])('is false when none of them is there: %j for %j', (names, wanted) => {
    expect(programRunning(names, wanted)).toBe(false);
  });
});

describe('writeBlock', () => {
  it('says why in one plain sentence while the Azeron app runs', () => {
    expect(writeBlock(['Azeron Software.exe'])).toEqual({
      reason: 'Close the Azeron app first: it talks to the units too.',
    });
  });

  it('blocks nothing otherwise', () => {
    expect(writeBlock(['explorer.exe'])).toBeNull();
  });
});

describe('parseTasklistCsv', () => {
  it('takes the first column, names with spaces whole', () => {
    const output = [
      '"System Idle Process","0","Services","0","8 K"',
      '"Azeron Software.exe","1234","Console","1","120,552 K"',
      '"explorer.exe","4321","Console","1","90,000 K"',
      '',
    ].join('\r\n');
    expect(parseTasklistCsv(output)).toEqual([
      'System Idle Process',
      'Azeron Software.exe',
      'explorer.exe',
    ]);
  });

  it('unescapes doubled quotes, and skips blank lines and notices', () => {
    const output = 'INFO: something\n\n"odd ""name"".exe","1","Console","1","1 K"\n';
    expect(parseTasklistCsv(output)).toEqual(['odd "name".exe']);
  });

  it('gives nothing for nothing', () => {
    expect(parseTasklistCsv('')).toEqual([]);
  });

  it('feeds azeronAppRunning', () => {
    const names = parseTasklistCsv('"Azeron Software.exe","1234","Console","1","1 K"\r\n');
    expect(azeronAppRunning(names)).toBe(true);
  });
});

describe('watchProcesses', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const app = () => Promise.resolve(['Azeron Software.exe']);
  const none = () => Promise.resolve(['explorer.exe']);

  const setup = (lists: (() => Promise<string[]>)[]) => {
    const listProcesses = vi.fn<() => Promise<string[]>>();
    for (const list of lists) listProcesses.mockImplementationOnce(list);
    // After the scripted answers, the app is not running.
    listProcesses.mockImplementation(none);
    const changes: ProcessState[] = [];
    const errors: unknown[] = [];
    const watcher = watchProcesses(
      { listProcesses, onChange: (s) => changes.push(s), onError: (e) => errors.push(e) },
      1000,
    );
    return { listProcesses, changes, errors, watcher };
  };

  it('says what it finds at once, then only when the Azeron app starts or stops', async () => {
    const { changes, watcher } = setup([none, none, app, app, none]);
    await vi.advanceTimersByTimeAsync(0);
    expect(changes.map((c) => c.azeronRunning)).toEqual([false]);
    await vi.advanceTimersByTimeAsync(1000); // still none
    expect(changes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000); // started
    expect(changes.map((c) => c.azeronRunning)).toEqual([false, true]);
    expect(changes[1]?.block?.reason).toBe(
      'Close the Azeron app first: it talks to the units too.',
    );
    await vi.advanceTimersByTimeAsync(1000); // still running
    expect(changes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000); // closed
    expect(changes.map((c) => c.azeronRunning)).toEqual([false, true, false]);
    expect(changes[2]?.block).toBeNull();
    expect(watcher.current()).toEqual(changes[2]);
    watcher.stop();
  });

  it('knows nothing before the first list arrives', () => {
    const { watcher } = setup([() => new Promise(() => undefined)]);
    expect(watcher.current()).toBeNull();
    watcher.stop();
  });

  it('never has two reads going: a slow one holds the next back', async () => {
    let finish: (names: string[]) => void = () => undefined;
    const slow = () => new Promise<string[]>((resolve) => (finish = resolve));
    const { listProcesses, watcher } = setup([slow]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(listProcesses).toHaveBeenCalledTimes(1);
    finish(['explorer.exe']);
    await vi.advanceTimersByTimeAsync(0);
    expect(listProcesses).toHaveBeenCalledTimes(1); // the next waits its interval after this
    await vi.advanceTimersByTimeAsync(1000);
    expect(listProcesses).toHaveBeenCalledTimes(2);
    watcher.stop();
  });

  it('survives a list that fails: reports it, keeps the last state, goes on', async () => {
    const boom = new Error('tasklist failed');
    const { changes, errors, watcher, listProcesses } = setup([
      app,
      () => Promise.reject(boom),
      app,
      none,
    ]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors).toEqual([boom]);
    expect(watcher.current()?.azeronRunning).toBe(true); // not guessed away
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(listProcesses).toHaveBeenCalledTimes(4);
    expect(changes.map((c) => c.azeronRunning)).toEqual([true, false]);
    watcher.stop();
  });

  it('survives a list that fails with nobody listening for errors', async () => {
    const listProcesses = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('nope'))
      .mockImplementation(app);
    const changes: ProcessState[] = [];
    const watcher = watchProcesses({ listProcesses, onChange: (s) => changes.push(s) }, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(changes.map((c) => c.azeronRunning)).toEqual([true]);
    watcher.stop();
  });

  it('refresh reads now and returns what it found', async () => {
    const { listProcesses, watcher } = setup([none, app]);
    await vi.advanceTimersByTimeAsync(0);
    expect(await watcher.refresh()).toMatchObject({ azeronRunning: true });
    expect(listProcesses).toHaveBeenCalledTimes(2);
    watcher.stop();
  });

  it('refresh joins a read already under way instead of starting another', async () => {
    let finish: (names: string[]) => void = () => undefined;
    const { listProcesses, watcher } = setup([
      () => new Promise<string[]>((resolve) => (finish = resolve)),
    ]);
    const refreshed = watcher.refresh();
    finish(['Azeron Software.exe']);
    expect(await refreshed).toMatchObject({ azeronRunning: true });
    expect(listProcesses).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('stop ends the polling, and drops a read still under way', async () => {
    let finish: (names: string[]) => void = () => undefined;
    const { listProcesses, changes, watcher } = setup([
      () => new Promise<string[]>((resolve) => (finish = resolve)),
    ]);
    watcher.stop();
    finish(['Azeron Software.exe']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(changes).toEqual([]);
    expect(listProcesses).toHaveBeenCalledTimes(1);
  });
});
