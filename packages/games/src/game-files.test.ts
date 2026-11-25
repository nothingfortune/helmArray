// The adapters on small files written here: hostile names, finding the files, StartPreset, and the
// edges the game's own files don't show.

import { gameProblem } from '@helmarray/core';
import type { GameBinding, Signal } from '@helmarray/core';
import { describe, expect, it } from 'vitest';
import {
  findEliteBinds,
  harvestEliteBinds,
  readStartPreset,
  writeEliteBinds,
  writeStartPreset,
} from './elite-binds';
import type { FolderReader } from './game-file';
import { GameFileError, idMaker, linesOf } from './game-file';
import { findEverspace2Ini, harvestUnrealIni, writeUnrealIni } from './unreal-ini';

const GAME = { id: 'g', name: 'G' };
const row = (action: string, set: GameBinding['set'], signal: Signal | null): GameBinding => ({
  set,
  mode: 'ship',
  action,
  signal,
  native: null,
});
const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;
const errorOf = (run: () => unknown): GameFileError | null => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof GameFileError ? error : null;
  }
};

/** A folder tree in memory: paths joined with `/`, names as written. */
function fakeDisk(files: Record<string, string>): FolderReader {
  return {
    list: (dir) => {
      const prefix = `${dir}/`;
      const names = Object.keys(files)
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length).split('/')[0] ?? '');
      return [...new Set(names)];
    },
    read: (path) => (Object.hasOwn(files, path) ? (files[path] ?? null) : null),
    join: (dir, ...names) => [dir, ...names].join('/'),
  };
}

// --- Elite --------------------------------------------------------------------------------

const binds = (...controls: string[]): string =>
  [
    '<?xml version="1.0" encoding="UTF-8" ?>',
    '<Root PresetName="Custom" MajorVersion="4" MinorVersion="1">',
    ...controls,
    '</Root>',
    '',
  ].join('\r\n');
const control = (
  tag: string,
  primary: string,
  secondary = '<Secondary Device="{NoDevice}" Key="" />',
) => [`\t<${tag}>`, `\t\t${primary}`, `\t\t${secondary}`, `\t</${tag}>`].join('\r\n');

describe('Elite: hostile names', () => {
  const file = binds(
    control('__proto__', '<Primary Device="Keyboard" Key="Key_A" />'),
    control('constructor', '<Primary Device="Keyboard" Key="Key_B" />'),
    control('toString', '<Primary Device="Keyboard" Key="Key_C" />'),
  );
  const harvest = () => harvestEliteBinds(file, GAME);

  it('harvests them as actions with ids helmArray can use', () => {
    expect(harvest().game.actions.map((a) => [a.id, a.native?.key])).toEqual([
      ['proto__', key('A')],
      ['constructor_2', key('B')],
      ['toString_2', key('C')],
    ]);
  });

  it('gives a game helmArray can save', () => {
    expect(gameProblem(harvest().game)).toBeNull();
  });

  it('writes them by those ids', () => {
    const after = writeEliteBinds(file, [
      row('proto__', 'keyboard', key('X')),
      row('constructor_2', 'keyboard', key('Y')),
    ]);
    expect(harvestEliteBinds(after, GAME).game.actions.map((a) => a.native?.key)).toEqual([
      key('X'),
      key('Y'),
      key('C'),
    ]);
  });

  it('refuses a row naming an inherited name', () => {
    expect(
      errorOf(() => writeEliteBinds(file, [row('constructor', 'keyboard', key('X'))]))?.problems,
    ).toEqual(['The file has no action "constructor".']);
  });
});

describe('Elite: what the reference files do not show', () => {
  it('keeps a slot on another device: a new binding takes the free one', () => {
    const file = binds(control('Fire', '<Primary Device="T16000M" Key="Joy_1" />'));
    expect(writeEliteBinds(file, [row('Fire', 'keyboard', key('F'))])).toBe(
      file.replace(
        '<Secondary Device="{NoDevice}" Key="" />',
        '<Secondary Device="Keyboard" Key="Key_F" />',
      ),
    );
  });

  it('refuses a binding with no slot left beside another device', () => {
    const file = binds(control('Fire', '<Primary Device="T16000M" Key="Joy_1" />'));
    expect(
      errorOf(() =>
        writeEliteBinds(file, [
          row('Fire', 'keyboard', key('F')),
          row('Fire', 'keyboard', key('G')),
        ]),
      )?.problems,
    ).toEqual(["Fire: a control holds two bindings, so G doesn't fit."]);
  });

  it('never lists a slot on another device as kept', () => {
    const file = binds(control('Fire', '<Primary Device="T16000M" Key="Joy_1" />'));
    expect(harvestEliteBinds(file, GAME).kept).toEqual([]);
  });

  it('keeps a slot with a child it does not know, and reads no default from it', () => {
    const file = binds(
      control(
        'Fire',
        '<Primary Device="Keyboard" Key="Key_F">\r\n\t\t\t<Mystery Value="1" />\r\n\t\t</Primary>',
      ),
    );
    const harvested = harvestEliteBinds(file, GAME);
    expect([harvested.game.actions[0]?.native, harvested.kept]).toEqual([
      undefined,
      [{ action: 'Fire', set: 'keyboard', text: 'Key_F' }],
    ]);
  });

  it('reads a slot held with Hold as its key, and keeps the Hold while the key stays', () => {
    const file = binds(
      control(
        'Fire',
        '<Primary Device="Keyboard" Key="Key_F">\r\n\t\t\t<Hold Value="1" />\r\n\t\t</Primary>',
      ),
    );
    expect([
      harvestEliteBinds(file, GAME).game.actions[0]?.native,
      writeEliteBinds(file, [row('Fire', 'keyboard', key('F'))]) === file,
    ]).toEqual([{ key: key('F') }, true]);
  });

  it('is not an action without both a Primary and a Secondary', () => {
    const file = binds(
      ['\t<Yaw>', '\t\t<Binding Device="{NoDevice}" Key="" />', '\t</Yaw>'].join('\r\n'),
      [
        '\t<Odd>',
        '\t\t<Secondary Device="{NoDevice}" Key="" />',
        '\t\t<Primary Device="{NoDevice}" Key="" />',
        '\t</Odd>',
      ].join('\r\n'),
      ['\t<One>', '\t\t<Primary Device="{NoDevice}" Key="" />', '\t</One>'].join('\r\n'),
    );
    expect(harvestEliteBinds(file, GAME).game.actions).toEqual([]);
  });

  it("indents a modifier one step deeper than its slot, by the file's own step", () => {
    const file = binds(control('Fire', '<Primary Device="Keyboard" Key="Key_F" />'))
      .replaceAll('\t\t<', '    <')
      .replaceAll('\t<', '  <');
    expect(
      writeEliteBinds(file, [row('Fire', 'keyboard', { kind: 'key', code: 'G', mods: ['alt'] })]),
    ).toBe(
      file.replace(
        '    <Primary Device="Keyboard" Key="Key_F" />',
        '    <Primary Device="Keyboard" Key="Key_G">\r\n      <Modifier Device="Keyboard" Key="Key_LeftAlt" />\r\n    </Primary>',
      ),
    );
  });

  it('writes into a file with LF endings in LF', () => {
    const file = binds(control('Fire', '<Primary Device="Keyboard" Key="Key_F" />')).replaceAll(
      '\r\n',
      '\n',
    );
    expect(
      writeEliteBinds(file, [row('Fire', 'keyboard', { kind: 'key', code: 'G', mods: ['ctrl'] })]),
    ).toBe(
      file.replace(
        '\t\t<Primary Device="Keyboard" Key="Key_F" />',
        '\t\t<Primary Device="Keyboard" Key="Key_G">\n\t\t\t<Modifier Device="Keyboard" Key="Key_LeftControl" />\n\t\t</Primary>',
      ),
    );
  });

  it('refuses a signal put in the other set', () => {
    const file = binds(control('Fire', '<Primary Device="Keyboard" Key="Key_F" />'));
    expect(
      errorOf(() => writeEliteBinds(file, [row('Fire', 'controller', key('F'))]))?.problems,
    ).toEqual(["Fire: F isn't a controller binding."]);
  });
});

describe('Elite: StartPreset', () => {
  it('reads one preset per line', () => {
    expect(
      readStartPreset(
        'ClassicKeyboardOnly\r\nGenericJoystick\r\nKeyboardMouseOnly\r\nKeyboardMouseOnly\r\n',
      ),
    ).toEqual(['ClassicKeyboardOnly', 'GenericJoystick', 'KeyboardMouseOnly', 'KeyboardMouseOnly']);
  });

  it('names one preset on every line, keeping the lines and their endings', () => {
    expect(writeStartPreset('A\r\nB\r\n\r\nC', 'Custom')).toBe('Custom\r\nCustom\r\n\r\nCustom');
  });
});

describe('Elite: find', () => {
  const ROOT = 'C:/Users/p/AppData/Local';
  const FOLDER = `${ROOT}/Frontier Developments/Elite Dangerous/Options/Bindings`;
  const INSTALL = 'D:/Steam/steamapps/common/Elite Dangerous';
  const SCHEMES = `${INSTALL}/Products/elite-dangerous-odyssey-64/ControlSchemes`;

  it("follows StartPreset to the player's own file, the highest version", () => {
    const disk = fakeDisk({
      [`${FOLDER}/StartPreset.4.start`]: 'Custom\r\nCustom\r\nCustom\r\nCustom\r\n',
      [`${FOLDER}/Custom.3.0.binds`]: '',
      [`${FOLDER}/Custom.4.1.binds`]: '',
      [`${FOLDER}/Custom.4.0.binds`]: '',
      [`${FOLDER}/Other.4.2.binds`]: '',
    });
    expect(findEliteBinds({ installDir: INSTALL, localAppData: ['C:/none', ROOT] }, disk)).toEqual({
      folder: FOLDER,
      startPreset: `${FOLDER}/StartPreset.4.start`,
      presets: Array.from({ length: 4 }, () => ({
        name: 'Custom',
        path: `${FOLDER}/Custom.4.1.binds`,
      })),
      binds: `${FOLDER}/Custom.4.1.binds`,
    });
  });

  it('finds a shipped preset under the install folder, whatever the case', () => {
    const disk = fakeDisk({
      [`${FOLDER}/startpreset.4.start`]: 'KeyboardMouseOnly\n',
      [`${SCHEMES}/keyboardmouseonly.binds`]: '',
    });
    expect(findEliteBinds({ installDir: INSTALL, localAppData: [ROOT] }, disk)?.binds).toBe(
      `${SCHEMES}/keyboardmouseonly.binds`,
    );
  });

  it('names no one file when the lines name different presets, and says which is missing', () => {
    const disk = fakeDisk({
      [`${FOLDER}/StartPreset.4.start`]: 'Custom\r\nGenericJoystick\r\n',
      [`${FOLDER}/Custom.4.1.binds`]: '',
    });
    expect(findEliteBinds({ installDir: null, localAppData: [ROOT] }, disk)).toEqual({
      folder: FOLDER,
      startPreset: `${FOLDER}/StartPreset.4.start`,
      presets: [
        { name: 'Custom', path: `${FOLDER}/Custom.4.1.binds` },
        { name: 'GenericJoystick', path: null },
      ],
      binds: null,
    });
  });

  it('finds nothing before the game has run', () => {
    const disk = fakeDisk({ [`${FOLDER}/Custom.4.1.binds`]: '' });
    expect(findEliteBinds({ installDir: INSTALL, localAppData: [ROOT] }, disk)).toBeNull();
  });
});

// --- Unreal -------------------------------------------------------------------------------

const ini = (...rows: string[]): string =>
  ['[/Script/ES2.CustomPlayerInput]', ...rows, ''].join('\r\n');
const line = (action: string, group: string, key1 = 'None', extra = '') =>
  `KeybindingsConfig=(Action=${action},ActionName="${action}",AxisName="",Category=1,bIsAxis=False,Key1=${key1},Key1Mod=None,Key2=None,Key2Mod=None,Scale=1.000000,bInvert=False,DisplayName=NSLOCTEXT("KEY_BINDINGS", "KEYS_X", "${action}, said plainly")${extra},GroupName="${group}")`;

describe('Everspace 2: hostile names', () => {
  const file = ini(
    line('__proto__', 'Keyboard', 'A'),
    line('constructor', 'Keyboard', 'B'),
    line('hasOwnProperty', 'Keyboard', 'C'),
  );
  const harvest = () => harvestUnrealIni(file, GAME);

  it("harvests them as actions with ids helmArray can use, named in the game's words", () => {
    expect(harvest().game.actions.map((a) => [a.id, a.name, a.native?.key])).toEqual([
      ['proto__', '__proto__, said plainly', key('A')],
      ['constructor_2', 'constructor, said plainly', key('B')],
      ['hasOwnProperty_2', 'hasOwnProperty, said plainly', key('C')],
    ]);
  });

  it('gives a game helmArray can save', () => {
    expect(gameProblem(harvest().game)).toBeNull();
  });

  it('writes them by those ids', () => {
    const after = writeUnrealIni(file, [
      row('proto__', 'keyboard', key('X')),
      row('constructor_2', 'keyboard', key('Y')),
    ]);
    expect(harvestUnrealIni(after, GAME).game.actions.map((a) => a.native?.key)).toEqual([
      key('X'),
      key('Y'),
      key('C'),
    ]);
  });
});

describe('Everspace 2: what the reference file does not show', () => {
  it('reads only its own section', () => {
    const file = ['[Other]', line('Fire', 'Keyboard', 'F'), ''].join('\r\n');
    expect(harvestUnrealIni(file, GAME).game.actions).toEqual([]);
  });

  it('skips a line it cannot read, and keeps it', () => {
    const file = ini('KeybindingsConfig=(Action=Fire,Key1=F', line('Fire', 'Keyboard', 'F'));
    expect([
      harvestUnrealIni(file, GAME).game.actions.length,
      writeUnrealIni(file, [row('Fire', 'keyboard', key('G'))]).split('\r\n')[1],
    ]).toEqual([1, 'KeybindingsConfig=(Action=Fire,Key1=F']);
  });

  it('puts a game category it does not know in a mode of its own', () => {
    const file = ini(line('Fire', 'Keyboard', 'F').replace('Category=1', 'Category=9'));
    expect(harvestUnrealIni(file, GAME).game.modes).toEqual([
      { id: 'category_9', name: 'Category 9' },
    ]);
  });

  it('refuses a binding for a group the file has no line for', () => {
    const file = ini(line('Fire', 'Keyboard', 'F'));
    expect(
      errorOf(() =>
        writeUnrealIni(file, [row('Fire', 'controller', { kind: 'pad', control: 'A' })]),
      )?.problems,
    ).toEqual(['Fire, said plainly: the file has no controller line for it.']);
  });

  it('lets a null row for a group with no line pass', () => {
    const file = ini(line('Fire', 'Keyboard', 'F'));
    expect(writeUnrealIni(file, [row('Fire', 'controller', null)])).toBe(file);
  });

  it('keeps a slot it cannot name, and a new binding takes the other', () => {
    const file = ini(line('Fire', 'Keyboard', 'MouseX'));
    const after = writeUnrealIni(file, [
      row('Fire', 'keyboard', null),
      row('Fire', 'keyboard', key('G')),
    ]);
    expect([
      harvestUnrealIni(file, GAME).kept,
      /Key1=\w+,Key1Mod=None,Key2=\w+/.exec(after)?.[0],
    ]).toEqual([
      [{ action: 'Fire', set: 'keyboard', text: 'MouseX' }],
      'Key1=MouseX,Key1Mod=None,Key2=G',
    ]);
  });

  it('lists a controller chord as kept, with what is held', () => {
    const file = ini(
      line('Fire', 'Gamepad', 'Gamepad_FaceButton_Bottom').replace(
        'Key1Mod=None',
        'Key1Mod=Gamepad_LeftShoulder',
      ),
    );
    expect(harvestUnrealIni(file, GAME).kept).toEqual([
      {
        action: 'Fire',
        set: 'controller',
        text: 'Gamepad_FaceButton_Bottom with Gamepad_LeftShoulder held',
      },
    ]);
  });
});

describe('Everspace 2: find', () => {
  const ROOT = 'C:/Users/p/AppData/Local';

  it('finds Input.ini under the first local app data folder that has one', () => {
    const disk = fakeDisk({ [`${ROOT}/ES2/Saved/Config/Windows/Input.ini`]: '' });
    expect(findEverspace2Ini(['C:/none', ROOT], disk)).toBe(
      `${ROOT}/ES2/Saved/Config/Windows/Input.ini`,
    );
  });

  it('finds nothing when the game has not written one', () => {
    const disk = fakeDisk({ [`${ROOT}/ES2/Saved/Config/Windows/Engine.ini`]: '' });
    expect(findEverspace2Ini([ROOT], disk)).toBeNull();
  });
});

// --- shared -------------------------------------------------------------------------------

describe('ids and lines', () => {
  it('makes an id of a name with nothing usable in it, and of a long one', () => {
    const id = idMaker();
    expect([id('!!!'), id('!!!'), id('a b/c'), id('x'.repeat(80)).length]).toEqual([
      'action',
      'action_2',
      'a_b_c',
      60,
    ]);
  });

  it('keeps every line ending, and a last line with none', () => {
    expect(linesOf('a\r\nb\nc\rd')).toEqual([
      { text: 'a', end: '\r\n' },
      { text: 'b', end: '\n' },
      { text: 'c', end: '\r' },
      { text: 'd', end: '' },
    ]);
  });
});
