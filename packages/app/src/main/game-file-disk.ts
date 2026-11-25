// The disk as the game-file target sees it (game-file.ts): the game's folders for finding its
// file, the file's bytes, and helmArray's own backups. The one module of the target that touches
// the disk; tests run it over temp folders, and wrap it to make a write fail.

import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FolderReader } from '@helmarray/games';

export interface GameFileDisk {
  /** What the adapters' `find` reads: folder listings and small text files, as they are now. */
  folders: FolderReader;
  /** A file's bytes; null when there is no such file. Throws when it is there but can't be read. */
  read(path: string): Promise<Uint8Array | null>;
  /**
   * Puts the bytes in place of the file: written beside it first, then moved over it, so the file
   * is never left half written by this.
   */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** The names in a folder; empty when there is no such folder. */
  list(dir: string): Promise<string[]>;
  remove(path: string): Promise<void>;
  /** Makes a folder and the folders above it, as needed. */
  makeDir(dir: string): Promise<void>;
}

const code = (error: unknown): unknown =>
  typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;

/** The real disk. */
export const nodeGameFileDisk: GameFileDisk = {
  folders: {
    list: (dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    },
    read: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    join: (dir, ...names) => join(dir, ...names),
  },
  read: async (path) => {
    try {
      return new Uint8Array(await readFile(path));
    } catch (error) {
      if (code(error) === 'ENOENT') return null;
      throw error;
    }
  },
  write: async (path, bytes) => {
    const beside = `${path}.helmarray-new`;
    try {
      await writeFile(beside, bytes);
      await rename(beside, path);
    } catch (error) {
      await rm(beside, { force: true }).catch(() => undefined);
      throw error;
    }
  },
  list: async (dir) => {
    try {
      return await readdir(dir);
    } catch (error) {
      if (code(error) === 'ENOENT') return [];
      throw error;
    }
  },
  remove: (path) => rm(path, { force: true }),
  makeDir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
};
