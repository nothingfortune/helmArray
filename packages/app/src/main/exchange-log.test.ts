import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExchangeLog, diskLogFiles, type LogFiles } from './exchange-log';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'helmarray-log-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const at = (iso: string) => () => new Date(iso);
const UNIT = 'HID\\VID_16D0&PID_12F7&MI_04';

describe('exchange log', () => {
  it('writes a line with the time and the unit', async () => {
    const log = createExchangeLog({ dir, now: at('2026-11-19T10:00:00.123Z') });
    log.write(UNIT, '→ identify 00 01');
    await log.flush();
    expect(await readFile(join(dir, 'exchange.log'), 'utf8')).toBe(
      `2026-11-19T10:00:00.123Z [${UNIT}] → identify 00 01\n`,
    );
  });

  it('makes the folder when it is missing', async () => {
    const log = createExchangeLog({ dir: join(dir, 'a', 'b'), now: at('2026-11-19T10:00:00Z') });
    log.write('left', 'hello');
    await log.flush();
    expect(await log.recent(10)).toHaveLength(1);
  });

  it('gives a session a trace that writes for its unit', async () => {
    const log = createExchangeLog({ dir, now: at('2026-11-19T10:00:00.000Z') });
    const trace = log.trace('left');
    trace('one');
    trace('two');
    expect(await log.recent(10)).toEqual([
      '2026-11-19T10:00:00.000Z [left] one',
      '2026-11-19T10:00:00.000Z [left] two',
    ]);
  });

  it('stamps each line with the clock at the time it was traced', async () => {
    const times = ['2026-11-19T10:00:00.000Z', '2026-11-19T10:00:01.000Z'];
    const log = createExchangeLog({ dir, now: () => new Date(times.shift() ?? '') });
    log.write('left', 'a');
    log.write('left', 'b');
    expect(await log.recent(2)).toEqual([
      '2026-11-19T10:00:00.000Z [left] a',
      '2026-11-19T10:00:01.000Z [left] b',
    ]);
  });

  it('keeps a line with a line break in it as one line', async () => {
    const log = createExchangeLog({ dir, now: at('2026-11-19T10:00:00.000Z') });
    log.write('left', 'one\r\ntwo\nthree');
    expect(await log.recent(10)).toEqual(['2026-11-19T10:00:00.000Z [left] one two three']);
  });

  it('loses no line and mixes none when traced rapidly from two units', async () => {
    const log = createExchangeLog({ dir, now: at('2026-11-19T10:00:00.000Z') });
    const left = log.trace('left');
    const right = log.trace('right');
    for (let i = 0; i < 300; i++) {
      left(`l${i}`);
      right(`r${i}`);
    }
    const lines = await log.recent(1000);
    expect(lines).toHaveLength(600);
    const lefts = lines.filter((line) => line.includes('[left]')).map((l) => l.split('] ')[1]);
    const rights = lines.filter((line) => line.includes('[right]')).map((l) => l.split('] ')[1]);
    expect(lefts).toEqual(Array.from({ length: 300 }, (_, i) => `l${i}`));
    expect(rights).toEqual(Array.from({ length: 300 }, (_, i) => `r${i}`));
  });

  describe('rotating', () => {
    it('moves the full file to exchange.1.log and starts a new one', async () => {
      const log = createExchangeLog({ dir, maxBytes: 100, now: at('2026-11-19T10:00:00.000Z') });
      for (let i = 0; i < 6; i++) log.write('left', `line ${i}`);
      await log.flush();
      const previous = await readFile(join(dir, 'exchange.1.log'), 'utf8');
      const current = await readFile(join(dir, 'exchange.log'), 'utf8');
      expect(previous.length).toBeGreaterThan(0);
      expect(current.length).toBeGreaterThan(0);
      expect(`${previous}${current}`.split('\n').filter(Boolean)).toHaveLength(6);
      expect(`${previous}${current}`).toContain('line 0');
      expect(`${previous}${current}`).toContain('line 5');
    });

    it('does not rotate below the limit', async () => {
      const log = createExchangeLog({ dir, maxBytes: 10_000, now: at('2026-11-19T10:00:00.000Z') });
      for (let i = 0; i < 20; i++) log.write('left', `line ${i}`);
      await log.flush();
      expect(await readdir(dir)).toEqual(['exchange.log']);
    });

    it('keeps only the current file and one previous, dropping the older ones', async () => {
      const log = createExchangeLog({ dir, maxBytes: 100, now: at('2026-11-19T10:00:00.000Z') });
      for (let i = 0; i < 100; i++) log.write('left', `line ${i}`);
      await log.flush();
      expect((await readdir(dir)).sort()).toEqual(['exchange.1.log', 'exchange.log']);
      const text =
        (await readFile(join(dir, 'exchange.1.log'), 'utf8')) +
        (await readFile(join(dir, 'exchange.log'), 'utf8'));
      expect(text).not.toContain('] line 0\n');
      expect(text).toContain('] line 99\n');
    });

    it('stays bounded: no file grows past the limit plus one line', async () => {
      const maxBytes = 500;
      const log = createExchangeLog({ dir, maxBytes, now: at('2026-11-19T10:00:00.000Z') });
      for (let i = 0; i < 500; i++) log.write('left', `exchange number ${i}`);
      await log.flush();
      const oneLine = '2026-11-19T10:00:00.000Z [left] exchange number 499\n'.length;
      for (const name of await readdir(dir)) {
        const size = (await readFile(join(dir, name))).length;
        expect(size).toBeLessThan(maxBytes + oneLine);
      }
    });

    it('rotates on bytes, not characters', async () => {
      const log = createExchangeLog({ dir, maxBytes: 100, now: at('2026-11-19T10:00:00.000Z') });
      log.write('left', '→'.repeat(40)); // 120 bytes
      log.write('left', 'next');
      await log.flush();
      expect(await readFile(join(dir, 'exchange.1.log'), 'utf8')).toContain('→');
      expect(await readFile(join(dir, 'exchange.log'), 'utf8')).toContain('next');
    });

    it('carries on from files already on disk', async () => {
      await writeFile(join(dir, 'exchange.log'), 'x'.repeat(200), 'utf8');
      const log = createExchangeLog({ dir, maxBytes: 100, now: at('2026-11-19T10:00:00.000Z') });
      log.write('left', 'after restart');
      await log.flush();
      expect(await readFile(join(dir, 'exchange.1.log'), 'utf8')).toBe('x'.repeat(200));
      expect(await readFile(join(dir, 'exchange.log'), 'utf8')).toContain('after restart');
    });
  });

  describe('recent', () => {
    it('gives the last n lines, oldest first, across both files', async () => {
      const log = createExchangeLog({ dir, maxBytes: 100, now: at('2026-11-19T10:00:00.000Z') });
      for (let i = 0; i < 10; i++) log.write('left', `line ${i}`);
      const lines = await log.recent(4);
      expect(lines.map((l) => l.split('] ')[1])).toEqual(['line 6', 'line 7', 'line 8', 'line 9']);
    });

    it('gives what there is when asked for more', async () => {
      const log = createExchangeLog({ dir, now: at('2026-11-19T10:00:00.000Z') });
      log.write('left', 'only');
      expect(await log.recent(50)).toHaveLength(1);
    });

    it('is empty before anything is written, and for no lines', async () => {
      const log = createExchangeLog({ dir, now: at('2026-11-19T10:00:00.000Z') });
      expect(await log.recent(5)).toEqual([]);
      log.write('left', 'a');
      expect(await log.recent(0)).toEqual([]);
      expect(await log.recent(-2)).toEqual([]);
    });

    it('waits for lines still being written', async () => {
      const log = createExchangeLog({ dir, now: at('2026-11-19T10:00:00.000Z') });
      log.write('left', 'just now');
      expect(await log.recent(1)).toEqual(['2026-11-19T10:00:00.000Z [left] just now']);
    });
  });

  describe('when the disk fails', () => {
    const failing = (fail: Set<string>): LogFiles => ({
      ...diskLogFiles,
      append: (path, text) =>
        fail.has('append')
          ? Promise.reject(new Error('disk full'))
          : diskLogFiles.append(path, text),
    });

    it('does not throw into the caller, reports it, and keeps going', async () => {
      const fail = new Set(['append']);
      const errors: unknown[] = [];
      const log = createExchangeLog({
        dir,
        files: failing(fail),
        now: at('2026-11-19T10:00:00.000Z'),
        onError: (error) => errors.push(error),
      });
      expect(() => {
        log.write('left', 'lost');
      }).not.toThrow();
      await log.flush();
      expect(errors).toHaveLength(1);
      fail.clear();
      log.write('left', 'kept');
      expect(await log.recent(10)).toEqual(['2026-11-19T10:00:00.000Z [left] kept']);
    });
  });
});
