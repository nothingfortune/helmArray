import { describe, expect, it } from 'vitest';
import { LOG_LINES, logText } from './log';

describe('logText', () => {
  it('shows the lines oldest first, one to a row', () => {
    expect(logText({ kind: 'ready', lines: ['a', 'b', 'c'] })).toBe('a\nb\nc');
  });

  it('says so when nothing has been logged', () => {
    expect(logText({ kind: 'ready', lines: [] })).toBe('Nothing logged yet.');
  });

  it('says so when the log could not be read', () => {
    expect(logText({ kind: 'failed' })).toBe("Couldn't read the log.");
  });

  it('says it is reading while it waits', () => {
    expect(logText({ kind: 'loading' })).toBe('Reading the log...');
  });

  it('asks for 200 lines', () => {
    expect(LOG_LINES).toBe(200);
  });
});
