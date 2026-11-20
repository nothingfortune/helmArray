// The real disk and registry behind steam-library.ts. Never imported by tests: they give the
// service an in-memory fake instead. Read-only, and every failure (a missing file, no
// permission, no Steam) is an `undefined`, so the library just shows less.

import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { parseSteamPathFromReg } from './steam-library';
import type { SteamReaders } from './steam-library';

export const steamReaders: SteamReaders = {
  readRegistrySteamPath() {
    return new Promise((resolve) => {
      execFile(
        'reg',
        ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
        { windowsHide: true, timeout: 10_000, encoding: 'utf8' },
        (error, stdout) => resolve(error ? undefined : parseSteamPathFromReg(stdout)),
      );
    });
  },

  async readFile(path) {
    try {
      return await readFile(path);
    } catch {
      return undefined;
    }
  },

  async listDir(path) {
    try {
      return await readdir(path);
    } catch {
      return undefined;
    }
  },
};
