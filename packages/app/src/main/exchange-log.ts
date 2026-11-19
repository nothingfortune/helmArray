// The rolling log of every exchange with a unit, opened from Settings when something fails.
// Two files in a folder: `exchange.log` (current) and `exchange.1.log` (the one before). When
// the current one is full it becomes the previous one and the old previous is dropped, so the
// log never grows past about twice its limit.
//
// Pure apart from the file operations it is handed. A write never throws into the caller: the
// log is a witness, and a full disk must not stop a layout being written to a unit.

import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface LogFiles {
  /** Makes the folder if it isn't there. */
  ensureDir(dir: string): Promise<void>;
  append(path: string, text: string): Promise<void>;
  /** Bytes in the file; 0 when there is none. */
  size(path: string): Promise<number>;
  /** Moves a file, replacing whatever is at the target. */
  rename(from: string, to: string): Promise<void>;
  /** The whole file; empty when there is none. */
  read(path: string): Promise<string>;
}

const missing = (error: unknown) => (error as { code?: string } | null)?.code === 'ENOENT';

/** The file operations over the real disk. */
export const diskLogFiles: LogFiles = {
  ensureDir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  append: (path, text) => appendFile(path, text, 'utf8'),
  size: async (path) => {
    try {
      return (await stat(path)).size;
    } catch (error) {
      if (missing(error)) return 0;
      throw error;
    }
  },
  rename: (from, to) => rename(from, to),
  read: async (path) => {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (missing(error)) return '';
      throw error;
    }
  },
};

export const DEFAULT_MAX_BYTES = 1024 * 1024;

export interface ExchangeLogOptions {
  /** The folder the two files live in. */
  dir: string;
  files?: LogFiles;
  /** The clock, for the timestamp on each line. */
  now?: () => Date;
  /** The current file is rotated once it holds this many bytes. */
  maxBytes?: number;
  /** Told when the log itself can't be written. Never throws into the caller. */
  onError?: (error: unknown) => void;
}

export interface ExchangeLog {
  readonly currentPath: string;
  readonly previousPath: string;
  /** Appends one line for a unit: `<ISO time> [<unit>] <line>`. Returns at once. */
  write(unit: string, line: string): void;
  /** A `trace` for one unit's session: `new UnitSession(transport, log.trace(path))`. */
  trace(unit: string): (line: string) => void;
  /** The last `count` lines, oldest first, across both files. Waits for pending writes. */
  recent(count: number): Promise<string[]>;
  /** Resolves when every line written so far is on disk (or has failed). */
  flush(): Promise<void>;
}

/** One entry is one line: a line break inside the text would read as two entries. */
const oneLine = (text: string) => text.replace(/\r\n|\r|\n/g, ' ');

export function createExchangeLog(options: ExchangeLogOptions): ExchangeLog {
  const { dir, files = diskLogFiles, now = () => new Date() } = options;
  // A reporter that throws must not poison the queue.
  const onError = (error: unknown) => {
    try {
      options.onError?.(error);
    } catch {
      // Nothing more can be done about a log that can't say it is failing.
    }
  };
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const currentPath = join(dir, 'exchange.log');
  const previousPath = join(dir, 'exchange.1.log');

  // Every write waits for the one before it, so lines land in the order they were traced and
  // the size check and the rotation never interleave with another append.
  let queue: Promise<void> = Promise.resolve();
  let dirReady = false;

  const enqueue = (work: () => Promise<void>): Promise<void> => {
    queue = queue.then(work).catch(onError);
    return queue;
  };

  const append = async (text: string) => {
    if (!dirReady) {
      await files.ensureDir(dir);
      dirReady = true;
    }
    if ((await files.size(currentPath)) >= maxBytes) {
      try {
        await files.rename(currentPath, previousPath);
      } catch (error) {
        // A viewer holding the file open can refuse the move. Say so, and still write the
        // line: a log that stops while full is lost exactly when it is wanted.
        onError(error);
      }
    }
    await files.append(currentPath, text);
  };

  const write = (unit: string, line: string) => {
    const text = `${now().toISOString()} [${oneLine(unit)}] ${oneLine(line)}\n`;
    void enqueue(() => append(text));
  };

  const flush = () => enqueue(() => Promise.resolve());
  const linesOf = (text: string) => text.split('\n').filter((line) => line !== '');

  return {
    currentPath,
    previousPath,
    write,
    trace: (unit) => (line) => {
      write(unit, line);
    },
    flush,
    // The read takes its turn in the queue like a write, so no rotation can move lines from one
    // file to the other between reading the two.
    recent: (count) =>
      new Promise<string[]>((resolve) => {
        if (!(count > 0)) return void flush().then(() => resolve([]));
        const lines: string[] = [];
        void enqueue(async () => {
          try {
            for (const path of [previousPath, currentPath]) {
              try {
                lines.push(...linesOf(await files.read(path)));
              } catch (error) {
                onError(error);
              }
            }
          } finally {
            resolve(lines.slice(-Math.floor(count)));
          }
        });
      }),
  };
}
