// Elite's own file made when the player has none, on small files written here: the root line,
// StartPreset pointed at the new file (byte safe), and where both are found. The game's own
// preset, made byte for byte, is test/game-file-elite-new.test.ts.

import { describe, expect, it } from 'vitest';
import { findEliteNewBinds, newEliteBinds, writeStartPreset } from './elite-binds';
import type { FolderReader } from './game-file';
import { GameFileError } from './game-file';

const errorOf = (run: () => unknown): GameFileError | null => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof GameFileError ? error : null;
  }
};

describe("Elite: the new file's root", () => {
  it("keeps the root line's indent and ending, and the lines around it, as they were", () => {
    const small = '\uFEFF<?xml version="1.0"?>\n  <Root PresetName="X" SortOrder="2">\n\t<A />\n';
    expect(newEliteBinds(small)).toBe(
      '\uFEFF<?xml version="1.0"?>\n  <Root PresetName="Custom" MajorVersion="4" MinorVersion="1">\n\t<A />\n',
    );
  });

  it('changes only the first root line, and not a control whose name starts with Root', () => {
    const small = '<Rooted />\r\n<Root>\r\n<Root PresetName="Y">\r\n';
    expect(newEliteBinds(small)).toBe(
      '<Rooted />\r\n<Root PresetName="Custom" MajorVersion="4" MinorVersion="1">\r\n<Root PresetName="Y">\r\n',
    );
  });

  it('takes no line for the root that has something before it', () => {
    expect(newEliteBinds('<X /><Root PresetName="Y">\r\n<Root>\r\n')).toBe(
      '<X /><Root PresetName="Y">\r\n<Root PresetName="Custom" MajorVersion="4" MinorVersion="1">\r\n',
    );
  });

  it('refuses a file with no root, in a sentence', () => {
    expect(
      errorOf(() => newEliteBinds('<?xml version="1.0"?>\r\n<Rooted />\r\n'))?.problems,
    ).toEqual(["The game's preset has no Root line to make the new file from."]);
  });
});

describe('Elite: StartPreset pointed at the new file', () => {
  it('keeps a byte order mark at the start', () => {
    expect(writeStartPreset('\uFEFFKeyboardMouseOnly\r\nGenericJoystick\r\n', 'Custom')).toBe(
      '\uFEFFCustom\r\nCustom\r\n',
    );
  });

  it('keeps a line that names the preset already as it was, spaces and all', () => {
    expect(writeStartPreset(' Custom \r\nKeyboardMouseOnly', 'Custom')).toBe(' Custom \r\nCustom');
  });

  it('keeps no mark but the one that starts the file: a later line is named whole', () => {
    expect(writeStartPreset('A\r\n\uFEFFB\r\n', 'Custom')).toBe('Custom\r\nCustom\r\n');
  });

  it('keeps a line of nothing but a byte order mark as it was', () => {
    expect(writeStartPreset('\uFEFF\r\nA\r\n', 'Custom')).toBe('\uFEFF\r\nCustom\r\n');
  });
});

describe('Elite: where the new file goes, and the preset it is made from', () => {
  const ROOT = 'C:/Users/p/AppData/Local';
  const FOLDER = `${ROOT}/Frontier Developments/Elite Dangerous/Options/Bindings`;
  const INSTALL = 'D:/Steam/steamapps/common/Elite Dangerous';
  const SCHEMES = `${INSTALL}/Products/elite-dangerous-odyssey-64/ControlSchemes`;
  const START = `${FOLDER}/StartPreset.4.start`;

  /** A folder tree in memory: paths joined with `/`. */
  function fakeDisk(files: Record<string, string>): FolderReader {
    return {
      list: (dir) => {
        const prefix = `${dir}/`;
        const names = Object.keys(files)
          .filter((path) => path.startsWith(prefix))
          .map((path) => path.slice(prefix.length).split('/')[0] as string);
        return [...new Set(names)];
      },
      read: (path) => files[path] ?? null,
      join: (dir, ...names) => [dir, ...names].join('/'),
    };
  }
  const find = (files: Record<string, string>, installDir: string | null = INSTALL) =>
    findEliteNewBinds({ installDir, localAppData: ['C:/none', ROOT] }, fakeDisk(files));

  it('makes Custom.4.1.binds beside StartPreset, from KeyboardMouseOnly', () => {
    expect(
      find({
        [START]: 'KeyboardMouseOnly\r\nKeyboardMouseOnly\r\n',
        [`${SCHEMES}/KeyboardMouseOnly.binds`]: '',
        [`${SCHEMES}/GenericJoystick.binds`]: '',
      }),
    ).toEqual({
      folder: FOLDER,
      startPreset: START,
      from: `${SCHEMES}/KeyboardMouseOnly.binds`,
      path: `${FOLDER}/Custom.4.1.binds`,
    });
  });

  it('starts from KeyboardMouseOnly whichever shipped preset StartPreset names, whatever the case', () => {
    expect(
      find({
        [`${FOLDER}/startpreset.4.start`]: 'GenericJoystick\n',
        [`${INSTALL}/products/Elite-Dangerous-Odyssey-64/controlschemes/keyboardmouseonly.binds`]:
          '',
      })?.from,
    ).toBe(`${INSTALL}/products/Elite-Dangerous-Odyssey-64/controlschemes/keyboardmouseonly.binds`);
  });

  it('makes one when StartPreset names Custom but there is no Custom file', () => {
    expect(find({ [START]: 'Custom\r\n', [`${SCHEMES}/KeyboardMouseOnly.binds`]: '' })?.path).toBe(
      `${FOLDER}/Custom.4.1.binds`,
    );
  });

  it("makes none when StartPreset names the player's own file", () => {
    expect(
      find({
        [START]: 'Custom\r\n',
        [`${FOLDER}/Custom.4.1.binds`]: '',
        [`${SCHEMES}/KeyboardMouseOnly.binds`]: '',
      }),
    ).toBeNull();
  });

  it('makes none when one line of several names a file of the player', () => {
    expect(
      find({
        [START]: 'KeyboardMouseOnly\r\nMine\r\n',
        [`${FOLDER}/Mine.4.0.binds`]: '',
        [`${SCHEMES}/KeyboardMouseOnly.binds`]: '',
      }),
    ).toBeNull();
  });

  it('makes none over a Custom file of any version that StartPreset no longer names', () => {
    expect(
      ['Custom.4.1.binds', 'custom.3.0.binds', 'Custom.4.2.binds'].map((name) =>
        find({
          [START]: 'KeyboardMouseOnly\r\n',
          [`${FOLDER}/${name}`]: '',
          [`${SCHEMES}/KeyboardMouseOnly.binds`]: '',
        }),
      ),
    ).toEqual([null, null, null]);
  });

  it('makes none without the install folder, or without the shipped preset in it', () => {
    expect([
      find({ [START]: 'KeyboardMouseOnly\r\n', [`${SCHEMES}/KeyboardMouseOnly.binds`]: '' }, null),
      find({ [START]: 'KeyboardMouseOnly\r\n', [`${SCHEMES}/GenericJoystick.binds`]: '' }),
    ]).toEqual([null, null]);
  });

  it('makes none when StartPreset names no preset at all: nothing would point the game at it', () => {
    expect([
      find({ [START]: '', [`${SCHEMES}/KeyboardMouseOnly.binds`]: '' }),
      find({ [START]: '\r\n  \r\n', [`${SCHEMES}/KeyboardMouseOnly.binds`]: '' }),
    ]).toEqual([null, null]);
  });

  it('makes none before the game has run: no StartPreset', () => {
    expect(find({ [`${SCHEMES}/KeyboardMouseOnly.binds`]: '' })).toBeNull();
  });
});
