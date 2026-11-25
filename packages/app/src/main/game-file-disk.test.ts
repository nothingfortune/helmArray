// The real disk under the game-file target, over a temp folder.

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeGameFileDisk as disk } from './game-file-disk';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'helm-game-disk-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);

describe('the game-file disk', () => {
  it("reads a file's bytes as they are, a BOM included", async () => {
    await writeFile(join(root, 'a.binds'), Buffer.from([0xef, 0xbb, 0xbf, 0x3c, 0x0d, 0x0a]));
    expect(await disk.read(join(root, 'a.binds'))).toEqual(
      new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x0d, 0x0a]),
    );
  });

  it('reads nothing for a file that is not there', async () => {
    expect(await disk.read(join(root, 'none.ini'))).toBeNull();
  });

  it("throws for a path that is there and can't be read as a file", async () => {
    await mkdir(join(root, 'folder.ini'));
    await expect(disk.read(join(root, 'folder.ini'))).rejects.toThrow('EISDIR');
  });

  it('puts the new bytes in place of the file, and leaves nothing beside it', async () => {
    await writeFile(join(root, 'Input.ini'), 'old');
    await disk.write(join(root, 'Input.ini'), bytes('new'));
    expect({
      text: await readFile(join(root, 'Input.ini'), 'utf8'),
      names: await readdir(root),
    }).toEqual({ text: 'new', names: ['Input.ini'] });
  });

  it('takes away what it wrote beside the file when it cannot move it over', async () => {
    await mkdir(join(root, 'Input.ini'));
    await writeFile(join(root, 'Input.ini', 'inside'), 'x');
    await expect(disk.write(join(root, 'Input.ini'), bytes('new'))).rejects.toThrow(/E[A-Z]+/);
    expect(await readdir(root)).toEqual(['Input.ini']);
  });

  it('lists a folder, and nothing for one that is not there', async () => {
    await writeFile(join(root, 'b'), '');
    expect({ there: await disk.list(root), none: await disk.list(join(root, 'none')) }).toEqual({
      there: ['b'],
      none: [],
    });
  });

  it("throws when a folder is there but can't be listed", async () => {
    await writeFile(join(root, 'file'), '');
    await expect(disk.list(join(root, 'file'))).rejects.toThrow('ENOTDIR');
  });

  it('makes a folder with the folders above it, and removes a file', async () => {
    await disk.makeDir(join(root, 'backups', 'everspace2'));
    await writeFile(join(root, 'backups', 'everspace2', 'copy'), '');
    await disk.remove(join(root, 'backups', 'everspace2', 'copy'));
    expect(await readdir(join(root, 'backups', 'everspace2'))).toEqual([]);
  });

  it("gives find the folders' names and the files' text, and nothing for what isn't there", async () => {
    await writeFile(join(root, 'StartPreset.4.start'), 'Custom');
    expect({
      list: disk.folders.list(root),
      none: disk.folders.list(join(root, 'none')),
      read: disk.folders.read(join(root, 'StartPreset.4.start')),
      missing: disk.folders.read(join(root, 'none')),
      join: disk.folders.join(root, 'a', 'b'),
    }).toEqual({
      list: ['StartPreset.4.start'],
      none: [],
      read: 'Custom',
      missing: null,
      join: join(root, 'a', 'b'),
    });
  });
});
