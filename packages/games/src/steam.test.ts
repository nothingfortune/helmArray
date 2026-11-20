import { describe, expect, it } from 'vitest';
import { VdfError } from './kv';
import { parseAppManifest, parseAssetCache, parseLibraryFolders, pickPortrait } from './steam';

// Binary KeyValues, built here from the documented layout (see vdf-binary.test.ts for the
// byte-by-byte check of the layout itself).
const cstr = (s: string): number[] => [...s].map((c) => c.charCodeAt(0)).concat(0);
const str = (key: string, value: string): number[] => [0x01, ...cstr(key), ...cstr(value)];
const int = (key: string, value: number): number[] => [
  0x02,
  ...cstr(key),
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  (value >>> 24) & 0xff,
];
const sec = (key: string, ...children: number[][]): number[] => [
  0x00,
  ...cstr(key),
  ...children.flat(),
  0x08,
];
const file = (...children: number[][]): Uint8Array => Uint8Array.from([...children.flat(), 0x08]);

describe('parseLibraryFolders', () => {
  it('reads the current layout: one numbered section per library, with its path', () => {
    const text = String.raw`
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"label"		""
		"apps"
		{
			"228980"		"1234"
			"620"		"5678"
		}
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
		"apps"
		{
			"1245620"		"9"
		}
	}
}`;
    expect(parseLibraryFolders(text)).toEqual([
      String.raw`C:\Program Files (x86)\Steam`,
      String.raw`D:\SteamLibrary`,
    ]);
  });

  it('reads the older layout: numbered keys holding the path itself', () => {
    const text = String.raw`"LibraryFolders" { "TimeNextStatsReport" "1500000000" "ContentStatsID" "-123" "1" "E:\\Games\\Steam" }`;
    expect(parseLibraryFolders(text)).toEqual([String.raw`E:\Games\Steam`]);
  });

  it('lists a library once, skips an entry without a path, and says [] for no libraries', () => {
    expect(
      parseLibraryFolders(
        '"libraryfolders" { "0" { "path" "C:\\\\S" } "1" { "path" "C:\\\\S" } "2" { "label" "x" } }',
      ),
    ).toEqual(['C:\\S']);
    expect(parseLibraryFolders('"other" { }')).toEqual([]);
    expect(parseLibraryFolders('')).toEqual([]);
  });

  it('throws VdfError for a file that is cut short', () => {
    expect(() => parseLibraryFolders('"libraryfolders" { "0" {')).toThrow(VdfError);
  });
});

describe('parseAppManifest', () => {
  const lib = String.raw`D:\SteamLibrary`;
  const manifest = (body: string): string => `"AppState"\n{\n${body}\n}`;

  it('takes the app id, name and install folder', () => {
    const text = manifest(
      '"appid" "620"\n"Universe" "1"\n"name" "Portal 2"\n"StateFlags" "4"\n"installdir" "Portal 2"',
    );
    expect(parseAppManifest(text, lib)).toEqual({
      appId: '620',
      name: 'Portal 2',
      installDir: 'Portal 2',
      libraryPath: lib,
    });
  });

  it('keeps app ids of any length', () => {
    expect(
      parseAppManifest(manifest('"appid" "3"\n"name" "A"\n"installdir" "a"'), lib)?.appId,
    ).toBe('3');
    expect(
      parseAppManifest(manifest('"appid" "2183900"\n"name" "A"\n"installdir" "a"'), lib)?.appId,
    ).toBe('2183900');
  });

  it('reads older manifests that write "AppID" and "InstallDir"', () => {
    const text = manifest(
      '"AppID" "440"\n"name" "Team Fortress 2"\n"InstallDir" "Team Fortress 2"',
    );
    expect(parseAppManifest(text, lib)).toMatchObject({
      appId: '440',
      installDir: 'Team Fortress 2',
    });
  });

  it('keeps UTF-8 in a name and a folder', () => {
    const text = manifest('"appid" "1"\n"name" "Caf\u00e9 Tycoon\u2122"\n"installdir" "Caf\u00e9"');
    expect(parseAppManifest(text, lib)).toMatchObject({
      name: 'Caf\u00e9 Tycoon\u2122',
      installDir: 'Caf\u00e9',
    });
  });

  it('falls back to the install folder when the name is missing', () => {
    expect(parseAppManifest(manifest('"appid" "5"\n"installdir" "Folder"'), lib)?.name).toBe(
      'Folder',
    );
  });

  it.each([
    ['no app id', '"name" "X"\n"installdir" "x"'],
    ['no install folder', '"appid" "5"\n"name" "X"'],
    ['a non-numeric app id', '"appid" "abc"\n"name" "X"\n"installdir" "x"'],
  ])('says undefined for %s', (_name, body) => {
    expect(parseAppManifest(manifest(body), lib)).toBeUndefined();
  });

  it('says undefined for a file with no AppState section', () => {
    expect(parseAppManifest('"Other" { "appid" "1" }', lib)).toBeUndefined();
  });
});

describe('parseAssetCache', () => {
  it('takes slots 0f, 3f and 4f of each app, at any depth', () => {
    const bytes = file(
      sec(
        'assetcache',
        sec(
          'wrapper',
          sec(
            '620',
            str('0f', 'library_600x900.jpg'),
            str('1f', 'library_hero.jpg'),
            str('3f', 'header.jpg'),
            str('4f', 'ab12/icon.jpg'),
          ),
        ),
        sec('3', str('0f', 'cd34/library_capsule.jpg')),
      ),
    );
    expect(parseAssetCache(bytes)).toEqual(
      new Map([
        ['620', { portrait: 'library_600x900.jpg', header: 'header.jpg', icon: 'ab12/icon.jpg' }],
        ['3', { portrait: 'cd34/library_capsule.jpg' }],
      ]),
    );
  });

  it('reads slots by their exact name: 0f is the portrait, 3f the header, 4f the icon', () => {
    const bytes = file(sec('1', str('0f', 'p'), str('3f', 'h'), str('4f', 'i'), str('5f', 'x')));
    expect(parseAssetCache(bytes).get('1')).toEqual({ portrait: 'p', header: 'h', icon: 'i' });
  });

  it('keeps app ids as written, short or long, without filtering by length', () => {
    const bytes = file(
      sec('3', str('0f', 'a')),
      sec('620', str('0f', 'b')),
      sec('2183900', str('0f', 'c')),
    );
    expect([...parseAssetCache(bytes).keys()]).toEqual(['3', '620', '2183900']);
  });

  it('works when the index holds other kinds of values beside the strings', () => {
    const bytes = file(
      sec('620', int('version', 7), str('0f', 'p'), int('0g', 1)),
      int('stamp', 1_700_000_000),
    );
    expect(parseAssetCache(bytes).get('620')).toEqual({ portrait: 'p' });
  });

  it('leaves out an app with none of the slots we use, and a section that is not an app', () => {
    const bytes = file(
      sec('620', str('1f', 'hero.jpg')),
      sec('notanumber', str('0f', 'x')),
      sec('7', str('name', 'no slots at all')),
    );
    expect(parseAssetCache(bytes).size).toBe(0);
  });

  it('turns backslashes into slashes and refuses a path that would leave the app folder', () => {
    const bytes = file(
      sec('1', str('0f', String.raw`ab\library_capsule.jpg`)),
      sec('2', str('0f', '../other/library_capsule.jpg')),
      sec('3', str('0f', '/etc/passwd')),
      sec('4', str('0f', 'C:/Windows/x.jpg')),
      sec('5', str('0f', String.raw`\\server\share\x.jpg`)),
      sec('6', str('0f', ''), str('3f', 'header.jpg')),
    );
    expect(parseAssetCache(bytes)).toEqual(
      new Map([
        ['1', { portrait: 'ab/library_capsule.jpg' }],
        ['6', { header: 'header.jpg' }],
      ]),
    );
  });

  it('reads a hand-laid-out index: the first value after a string is not lost', () => {
    // "620" { "0f" "p.jpg" "3f" "h.jpg" } and then "7" { "0f" "q.jpg" }, every byte written out.
    const bytes = Uint8Array.from([
      0x00,
      0x36,
      0x32,
      0x30,
      0x00, // section "620"
      0x01,
      0x30,
      0x66,
      0x00,
      0x70,
      0x2e,
      0x6a,
      0x70,
      0x67,
      0x00, // 0f = p.jpg
      0x01,
      0x33,
      0x66,
      0x00,
      0x68,
      0x2e,
      0x6a,
      0x70,
      0x67,
      0x00, // 3f = h.jpg
      0x08, // end of 620
      0x00,
      0x37,
      0x00, // section "7"
      0x01,
      0x30,
      0x66,
      0x00,
      0x71,
      0x2e,
      0x6a,
      0x70,
      0x67,
      0x00, // 0f = q.jpg
      0x08, // end of 7
      0x08, // end of the top level
    ]);
    expect(parseAssetCache(bytes)).toEqual(
      new Map([
        ['620', { portrait: 'p.jpg', header: 'h.jpg' }],
        ['7', { portrait: 'q.jpg' }],
      ]),
    );
  });

  it('throws VdfError for an index it cannot read, so the caller can scan instead', () => {
    expect(() => parseAssetCache(Uint8Array.from([0x03, 0x61, 0x00]))).toThrow(VdfError);
  });
});

describe('pickPortrait', () => {
  it('finds library_600x900.jpg or library_capsule.jpg directly in the folder', () => {
    expect(pickPortrait(['header.jpg', 'library_600x900.jpg'])).toBe('library_600x900.jpg');
    expect(pickPortrait(['library_capsule.jpg'])).toBe('library_capsule.jpg');
  });

  it('finds one inside a hashed subfolder, at any depth', () => {
    const hash = 'a'.repeat(40);
    expect(pickPortrait([`${hash}/library_capsule.jpg`])).toBe(`${hash}/library_capsule.jpg`);
    expect(pickPortrait(['x/y/z/library_600x900.jpg'])).toBe('x/y/z/library_600x900.jpg');
  });

  it('prefers 600x900 over capsule, then the shallower, then the earlier name', () => {
    expect(pickPortrait(['library_capsule.jpg', 'ab/library_600x900.jpg'])).toBe(
      'ab/library_600x900.jpg',
    );
    expect(pickPortrait(['ab/cd/library_600x900.jpg', 'ef/library_600x900.jpg'])).toBe(
      'ef/library_600x900.jpg',
    );
    expect(pickPortrait(['zz/library_600x900.jpg', 'aa/library_600x900.jpg'])).toBe(
      'aa/library_600x900.jpg',
    );
  });

  it('matches the whole file name, ignoring case', () => {
    expect(pickPortrait(['my_library_capsule.jpg', 'library_capsule.jpg.bak'])).toBeUndefined();
    expect(pickPortrait(['AB/Library_Capsule.JPG'])).toBe('AB/Library_Capsule.JPG');
  });

  it('accepts backslash paths and says undefined for none or for an escaping path', () => {
    expect(pickPortrait([String.raw`ab\library_capsule.jpg`])).toBe('ab/library_capsule.jpg');
    expect(pickPortrait([])).toBeUndefined();
    expect(pickPortrait(['header.jpg', 'library_hero.jpg'])).toBeUndefined();
    expect(pickPortrait(['../library_capsule.jpg'])).toBeUndefined();
  });
});
