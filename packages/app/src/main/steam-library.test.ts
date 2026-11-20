import { describe, expect, it } from 'vitest';
import type { SteamReaders } from './steam-library';
import { HIDDEN_STEAM_APPS, parseSteamPathFromReg, readSteamLibrary } from './steam-library';

// Binary KeyValues for assetcache.vdf, laid out from the documented format (type byte, key and
// string value ending in 0, section closed by 0x08). The parser's own byte-level tests are in
// packages/games.
const cstr = (s: string): number[] => [...s].map((c) => c.charCodeAt(0)).concat(0);
const str = (key: string, value: string): number[] => [0x01, ...cstr(key), ...cstr(value)];
const sec = (key: string, ...children: number[][]): number[] => [
  0x00,
  ...cstr(key),
  ...children.flat(),
  0x08,
];
const index = (...apps: number[][]): Uint8Array =>
  Uint8Array.from([...sec('assetcache', ...apps), 0x08]);

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const STEAM = 'c:/program files (x86)/steam';
const LIB2 = 'D:/SteamLibrary';

const manifest = (appId: string, name: string, installDir = name): string =>
  `"AppState"\n{\n\t"appid"\t"${appId}"\n\t"name"\t"${name}"\n\t"installdir"\t"${installDir}"\n}\n`;

/** An in-memory disk. Files are keyed by path; folders are whatever the paths imply. */
function fakeDisk(files: Record<string, string | Uint8Array>, steamPath: string | null = STEAM) {
  const calls = { readFile: [] as string[], listDir: [] as string[] };
  const readers: SteamReaders = {
    readRegistrySteamPath: () => Promise.resolve(steamPath ?? undefined),
    readFile(path) {
      calls.readFile.push(path);
      const file = files[path];
      return Promise.resolve(typeof file === 'string' ? bytes(file) : file);
    },
    listDir(path) {
      calls.listDir.push(path);
      const prefix = `${path.replace(/\/$/, '')}/`;
      const names = new Set<string>();
      for (const file of Object.keys(files)) {
        if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split('/')[0] as string);
      }
      return Promise.resolve(names.size > 0 ? [...names] : undefined);
    },
  };
  return { readers, calls };
}

const LIBRARYFOLDERS = String.raw`"libraryfolders"
{
	"0" { "path" "C:\\Program Files (x86)\\Steam" }
	"1" { "path" "D:\\SteamLibrary" }
}`;

const CACHE = `${STEAM}/appcache/librarycache`;

describe('readSteamLibrary', () => {
  it('lists the games of every library, sorted by name, with covers from the index', async () => {
    const { readers } = fakeDisk({
      [`${STEAM}/steamapps/libraryfolders.vdf`]: LIBRARYFOLDERS,
      [`${STEAM}/steamapps/appmanifest_620.acf`]: manifest('620', 'Portal 2'),
      [`${LIB2}/steamapps/appmanifest_359320.acf`]: manifest('359320', 'Elite Dangerous'),
      [`${LIB2}/steamapps/appmanifest_3.acf`]: manifest('3', 'Aardvark'),
      [`${CACHE}/assetcache.vdf`]: index(
        sec('620', str('0f', 'library_600x900.jpg'), str('3f', 'header.jpg')),
        sec('359320', str('0f', 'ab12/library_capsule.jpg'), str('3f', 'cd34/header.jpg')),
      ),
      [`${CACHE}/620/library_600x900.jpg`]: 'jpg',
      [`${CACHE}/620/header.jpg`]: 'jpg',
      [`${CACHE}/359320/ab12/library_capsule.jpg`]: 'jpg',
      [`${CACHE}/359320/cd34/header.jpg`]: 'jpg',
    });
    expect(await readSteamLibrary(readers)).toEqual({
      games: [
        { appId: '3', name: 'Aardvark' },
        {
          appId: '359320',
          name: 'Elite Dangerous',
          cover: `${CACHE}/359320/ab12/library_capsule.jpg`,
          header: `${CACHE}/359320/cd34/header.jpg`,
        },
        {
          appId: '620',
          name: 'Portal 2',
          cover: `${CACHE}/620/library_600x900.jpg`,
          header: `${CACHE}/620/header.jpg`,
        },
      ],
    });
  });

  it('joins paths with forward slashes whatever slashes the registry and the library file use', async () => {
    const { readers } = fakeDisk(
      {
        [`${STEAM}/steamapps/libraryfolders.vdf`]: LIBRARYFOLDERS,
        [`${LIB2}/steamapps/appmanifest_1.acf`]: manifest('1', 'One'),
        [`${CACHE}/assetcache.vdf`]: index(sec('1', str('0f', 'x\\library_capsule.jpg'))),
        [`${CACHE}/1/x/library_capsule.jpg`]: 'jpg',
      },
      'c:\\program files (x86)\\steam\\',
    );
    expect((await readSteamLibrary(readers)).games).toEqual([
      { appId: '1', name: 'One', cover: `${CACHE}/1/x/library_capsule.jpg` },
    ]);
  });

  it('scans the folder when the index lacks the game, at any depth', async () => {
    const hash = 'f'.repeat(40);
    const { readers } = fakeDisk({
      [`${STEAM}/steamapps/appmanifest_10.acf`]: manifest('10', 'Flat'),
      [`${STEAM}/steamapps/appmanifest_20.acf`]: manifest('20', 'Hashed'),
      [`${STEAM}/steamapps/appmanifest_30.acf`]: manifest('30', 'Deep'),
      [`${CACHE}/assetcache.vdf`]: index(sec('999', str('0f', 'unrelated.jpg'))),
      [`${CACHE}/10/library_600x900.jpg`]: 'jpg',
      [`${CACHE}/10/library_hero.jpg`]: 'jpg',
      [`${CACHE}/20/${hash}/library_capsule.jpg`]: 'jpg',
      [`${CACHE}/30/a/b/c/library_600x900.jpg`]: 'jpg',
    });
    expect((await readSteamLibrary(readers)).games).toEqual([
      { appId: '30', name: 'Deep', cover: `${CACHE}/30/a/b/c/library_600x900.jpg` },
      { appId: '10', name: 'Flat', cover: `${CACHE}/10/library_600x900.jpg` },
      { appId: '20', name: 'Hashed', cover: `${CACHE}/20/${hash}/library_capsule.jpg` },
    ]);
  });

  it('scans when the index names a file that is not on disk', async () => {
    const { readers } = fakeDisk({
      [`${STEAM}/steamapps/appmanifest_5.acf`]: manifest('5', 'Moved'),
      [`${CACHE}/assetcache.vdf`]: index(
        sec('5', str('0f', 'old/library_capsule.jpg'), str('3f', 'gone.jpg')),
      ),
      [`${CACHE}/5/new/library_capsule.jpg`]: 'jpg',
    });
    expect((await readSteamLibrary(readers)).games).toEqual([
      { appId: '5', name: 'Moved', cover: `${CACHE}/5/new/library_capsule.jpg` },
    ]);
  });

  it('gives a game with no art no cover and no header, so the UI shows its placeholder', async () => {
    const { readers } = fakeDisk({
      [`${STEAM}/steamapps/appmanifest_7.acf`]: manifest('7', 'By Hand'),
      [`${CACHE}/7/icon.jpg`]: 'jpg',
    });
    const [game] = (await readSteamLibrary(readers)).games;
    expect(game).toEqual({ appId: '7', name: 'By Hand' });
    expect(game && 'cover' in game).toBe(false);
    expect(game && 'header' in game).toBe(false);
  });

  it('works with no assetcache.vdf at all, scanning for every game', async () => {
    const { readers } = fakeDisk({
      [`${STEAM}/steamapps/appmanifest_1.acf`]: manifest('1', 'One'),
      [`${CACHE}/1/library_600x900.jpg`]: 'jpg',
    });
    expect((await readSteamLibrary(readers)).games[0]?.cover).toBe(
      `${CACHE}/1/library_600x900.jpg`,
    );
  });

  it('falls back to scanning when assetcache.vdf cannot be read', async () => {
    const { readers } = fakeDisk({
      [`${STEAM}/steamapps/appmanifest_1.acf`]: manifest('1', 'One'),
      [`${CACHE}/assetcache.vdf`]: Uint8Array.from([0x09, 0x61, 0x00]),
      [`${CACHE}/1/library_600x900.jpg`]: 'jpg',
    });
    expect((await readSteamLibrary(readers)).games[0]?.cover).toBe(
      `${CACHE}/1/library_600x900.jpg`,
    );
  });

  it('matches file names without regard to case, as Windows does', async () => {
    const { readers } = fakeDisk({
      [`${STEAM}/steamapps/appmanifest_1.acf`]: manifest('1', 'One'),
      [`${CACHE}/assetcache.vdf`]: index(sec('1', str('0f', 'library_600x900.jpg'))),
      [`${CACHE}/1/Library_600x900.JPG`]: 'jpg',
    });
    expect((await readSteamLibrary(readers)).games[0]?.cover).toBe(
      `${CACHE}/1/library_600x900.jpg`,
    );
  });

  it('never reads outside the app folder for an index path that tries to leave it', async () => {
    const { readers } = fakeDisk({
      [`${STEAM}/steamapps/appmanifest_1.acf`]: manifest('1', 'One'),
      [`${CACHE}/assetcache.vdf`]: index(sec('1', str('0f', '../2/library_600x900.jpg'))),
      [`${CACHE}/2/library_600x900.jpg`]: 'jpg',
    });
    expect((await readSteamLibrary(readers)).games).toEqual([{ appId: '1', name: 'One' }]);
  });

  it("uses Steam's own folder as a library even when libraryfolders.vdf is missing or lacks it", async () => {
    const missing = fakeDisk({ [`${STEAM}/steamapps/appmanifest_1.acf`]: manifest('1', 'One') });
    expect((await readSteamLibrary(missing.readers)).games.map((g) => g.appId)).toEqual(['1']);

    const other = fakeDisk({
      [`${STEAM}/steamapps/libraryfolders.vdf`]: String.raw`"libraryfolders" { "0" { "path" "D:\\SteamLibrary" } }`,
      [`${STEAM}/steamapps/appmanifest_1.acf`]: manifest('1', 'One'),
      [`${LIB2}/steamapps/appmanifest_2.acf`]: manifest('2', 'Two'),
    });
    expect((await readSteamLibrary(other.readers)).games.map((g) => g.appId)).toEqual(['1', '2']);
  });

  it('lists a game once when several libraries or manifests mention it', async () => {
    const { readers } = fakeDisk({
      [`${STEAM}/steamapps/libraryfolders.vdf`]: String.raw`"libraryfolders" { "0" { "path" "C:\\Program Files (x86)\\Steam" } "1" { "path" "d:\\steamlibrary" } "2" { "path" "D:\\SteamLibrary" } }`,
      [`${STEAM}/steamapps/appmanifest_1.acf`]: manifest('1', 'One'),
      [`${LIB2}/steamapps/appmanifest_1.acf`]: manifest('1', 'One'),
    });
    expect((await readSteamLibrary(readers)).games).toHaveLength(1);
  });

  it('leaves out Steam tools that are not games', async () => {
    expect(HIDDEN_STEAM_APPS).toEqual(['228980', '250820']);
    const { readers } = fakeDisk({
      [`${STEAM}/steamapps/appmanifest_228980.acf`]: manifest(
        '228980',
        'Steamworks Common Redistributables',
      ),
      [`${STEAM}/steamapps/appmanifest_250820.acf`]: manifest('250820', 'SteamVR'),
      [`${STEAM}/steamapps/appmanifest_2289800.acf`]: manifest('2289800', 'Almost Hidden'),
      [`${STEAM}/steamapps/appmanifest_620.acf`]: manifest('620', 'Portal 2'),
    });
    expect((await readSteamLibrary(readers)).games.map((g) => g.appId)).toEqual(['2289800', '620']);
  });

  it('keeps app ids of every length', async () => {
    const { readers } = fakeDisk({
      [`${STEAM}/steamapps/appmanifest_3.acf`]: manifest('3', 'Three'),
      [`${STEAM}/steamapps/appmanifest_620.acf`]: manifest('620', 'Portal 2'),
      [`${STEAM}/steamapps/appmanifest_2183900.acf`]: manifest('2183900', 'Seven'),
    });
    expect((await readSteamLibrary(readers)).games.map((g) => g.appId).sort()).toEqual([
      '2183900',
      '3',
      '620',
    ]);
  });

  it('skips a manifest it cannot read and carries on; ignores files that are not manifests', async () => {
    const { readers } = fakeDisk({
      [`${STEAM}/steamapps/appmanifest_1.acf`]: '"AppState" { "appid" "1"',
      [`${STEAM}/steamapps/appmanifest_2.acf`]: manifest('2', 'Two'),
      [`${STEAM}/steamapps/appmanifest_x.acf`]: manifest('3', 'Not a manifest name'),
      [`${STEAM}/steamapps/appmanifest_4.acf.bak`]: manifest('4', 'Backup'),
      [`${STEAM}/steamapps/common/Two/appmanifest_5.acf`]: manifest('5', 'Nested'),
    });
    expect((await readSteamLibrary(readers)).games.map((g) => g.name)).toEqual(['Two']);
  });

  it('says no games when Steam is not installed, without touching the disk', async () => {
    const none = fakeDisk({ [`${STEAM}/steamapps/appmanifest_1.acf`]: manifest('1', 'One') }, null);
    expect(await readSteamLibrary(none.readers)).toEqual({ games: [] });
    expect(none.calls).toEqual({ readFile: [], listDir: [] });
    const blank = fakeDisk({}, '  ');
    expect(await readSteamLibrary(blank.readers)).toEqual({ games: [] });
  });

  it('says no games when Steam has no steamapps folder', async () => {
    const { readers } = fakeDisk({});
    expect(await readSteamLibrary(readers)).toEqual({ games: [] });
  });

  it('keeps UTF-8 names whole', async () => {
    const { readers } = fakeDisk({
      [`${STEAM}/steamapps/appmanifest_1.acf`]: manifest('1', 'Caf\u00e9 \u2122'),
    });
    expect((await readSteamLibrary(readers)).games[0]?.name).toBe('Caf\u00e9 \u2122');
  });

  it('asks the disk for each folder once, however many covers it checks', async () => {
    const { readers, calls } = fakeDisk({
      [`${STEAM}/steamapps/appmanifest_1.acf`]: manifest('1', 'One'),
      [`${CACHE}/assetcache.vdf`]: index(sec('1', str('0f', 'a.jpg'), str('3f', 'b.jpg'))),
      [`${CACHE}/1/a.jpg`]: 'jpg',
      [`${CACHE}/1/b.jpg`]: 'jpg',
    });
    await readSteamLibrary(readers);
    expect(calls.listDir.filter((p) => p === `${CACHE}/1`)).toHaveLength(1);
  });
});

describe('parseSteamPathFromReg', () => {
  it('takes the value of the SteamPath line, spaces and all', () => {
    const output =
      '\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n\r\n';
    expect(parseSteamPathFromReg(output)).toBe('c:/program files (x86)/steam');
  });

  it('turns backslashes into slashes and drops a trailing one', () => {
    expect(parseSteamPathFromReg('    SteamPath    REG_SZ    D:\\Games\\Steam\\\r\n')).toBe(
      'D:/Games/Steam',
    );
  });

  it('is not fooled by other values, and says undefined when there is none', () => {
    expect(
      parseSteamPathFromReg('    SteamExe    REG_SZ    c:/steam/steam.exe\r\n'),
    ).toBeUndefined();
    expect(parseSteamPathFromReg('    SteamPath    REG_DWORD    0x1\r\n')).toBeUndefined();
    expect(parseSteamPathFromReg('')).toBeUndefined();
  });
});
