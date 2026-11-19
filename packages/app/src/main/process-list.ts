// The real list of running programs, from Windows' own `tasklist`. Never imported by tests:
// they use the pure parser below and fake listers.

import { execFile } from 'node:child_process';

/** The first column of each line of `tasklist /fo csv /nh`: the image name. */
export function parseTasklistCsv(output: string): string[] {
  const names: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    // Every row starts with a quoted name; anything else (a notice, a blank line) isn't one.
    if (!line.startsWith('"')) continue;
    let name = '';
    for (let i = 1; i < line.length; i++) {
      if (line[i] !== '"') {
        name += line[i];
      } else if (line[i + 1] === '"') {
        name += '"';
        i++;
      } else {
        break;
      }
    }
    if (name) names.push(name);
  }
  return names;
}

export function listProcesses(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'tasklist',
      ['/fo', 'csv', '/nh'],
      { windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(parseTasklistCsv(stdout))),
    );
  });
}
