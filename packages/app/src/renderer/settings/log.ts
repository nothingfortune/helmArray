export const LOG_LINES = 200;

export type LogState =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; lines: string[] };

/** What the log box shows: the lines, or one plain sentence saying why there are none. */
export function logText(log: LogState): string {
  switch (log.kind) {
    case 'loading':
      return 'Reading the log...';
    case 'failed':
      return "Couldn't read the log.";
    case 'ready':
      return log.lines.length === 0 ? 'Nothing logged yet.' : log.lines.join('\n');
  }
}
