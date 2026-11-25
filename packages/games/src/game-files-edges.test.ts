// The edges of both formats that the game's own files don't reach: what the parsers take and
// leave, how a stick turns, the error words, and the order of things.

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
import { GameFileError, idMaker } from './game-file';
import { harvestUnrealIni, writeUnrealIni } from './unreal-ini';

const GAME = { id: 'g', name: 'G' };
const row = (
  action: string,
  set: GameBinding['set'],
  signal: Signal | null,
  mode = 'm',
): GameBinding => ({ set, mode, action, signal, native: null });
const key = (code: string, mods?: string[]): Signal =>
  (mods === undefined ? { kind: 'key', code } : { kind: 'key', code, mods }) as Signal;
const pad = (control: string): Signal => ({ kind: 'pad', control }) as Signal;
const problemsOf = (run: () => unknown): readonly string[] | null => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof GameFileError ? error.problems : null;
  }
};

describe('the error and the ids', () => {
  it('is a GameFileError whose message is every problem in turn', () => {
    const error = new GameFileError(['One.', 'Two.']);
    expect([error.name, error.message, error.problems]).toEqual([
      'GameFileError',
      'One. Two.',
      ['One.', 'Two.'],
    ]);
  });

  it('counts on past a clash: _2, then _3', () => {
    const id = idMaker();
    expect([id('x'), id('x'), id('x')]).toEqual(['x', 'x_2', 'x_3']);
  });
});

// --- Unreal -------------------------------------------------------------------------------

const ini = (...lines: string[]): string =>
  ['[/Script/ES2.CustomPlayerInput]', ...lines, ''].join('\r\n');
interface LineOptions {
  action?: string;
  category?: string;
  axis?: boolean;
  key1?: string;
  mod1?: string;
  key2?: string;
  scale?: string;
  invert?: string;
  display?: string;
  extra?: string;
}
const line = (group: string, o: LineOptions = {}): string =>
  `KeybindingsConfig=(Action=${o.action ?? 'Fire'},ActionName="",AxisName="",` +
  `Category=${o.category ?? '1'},bIsAxis=${o.axis === true ? 'True' : 'False'},` +
  `Key1=${o.key1 ?? 'None'},Key1Mod=${o.mod1 ?? 'None'},Key2=${o.key2 ?? 'None'},Key2Mod=None,` +
  `Scale=${o.scale ?? '1.000000'},bInvert=${o.invert ?? 'False'},` +
  `DisplayName=${o.display ?? 'NSLOCTEXT("K", "X", "Fire it")'}${o.extra ?? ''},GroupName="${group}")`;
const one = (file: string) => harvestUnrealIni(file, GAME).game.actions;

describe('Everspace 2: reading a line', () => {
  it('takes commas, parentheses and escaped quotes inside quotes as text', () => {
    const file = ini(
      line('Keyboard', {
        key1: 'F',
        display: 'NSLOCTEXT("K", "X", "Fire (left, \\"hard\\")")',
        extra: ',Note="a,b)"',
      }),
    );
    expect(one(file).map((a) => [a.name, a.native?.key])).toEqual([
      ['Fire (left, \\"hard\\")', key('F')],
    ]);
  });

  it('reads past a quote escaped inside a quoted value, commas and all', () => {
    const file = ini(line('Keyboard', { key1: 'F', extra: ',Note="a\\",Key1=X"' }));
    expect(one(file)[0]?.native?.key).toEqual(key('F'));
  });

  it('takes quotes off a value only when they are its first and last characters', () => {
    const file = ini(
      line('Keyboard', { action: 'F"x"', key1: 'F' }),
      line('Keyboard', { action: '"a"b', key1: 'G' }),
    );
    expect(one(file).map((a) => a.id)).toEqual(['F_x_', 'a_b']);
  });

  it('makes a usable mode id of any category', () => {
    expect(harvestUnrealIni(ini(line('Keyboard', { category: '-1' })), GAME).game.modes).toEqual([
      { id: 'category_1', name: 'Category -1' },
    ]);
  });

  it('passes over a part with no = in it', () => {
    const file = ini(line('Keyboard', { key1: 'F', extra: ',Key1X' }));
    expect(one(file)[0]?.native?.key).toEqual(key('F'));
  });

  it('names an action by its Action when the display name says nothing', () => {
    const names = ['Plain', 'NSLOCTEXT("K", "X", "")', 'NSLOCTEXT("K", "X", "   ")'].map(
      (display) => one(ini(line('Keyboard', { display })))[0]?.name,
    );
    expect(names).toEqual(['Fire', 'Fire', 'Fire']);
  });

  it('trims the display name', () => {
    expect(
      one(ini(line('Keyboard', { display: 'NSLOCTEXT("K", "X", "  Fire  ")' })))[0]?.name,
    ).toBe('Fire');
  });

  it("names an action by its keyboard line's words, else the first line's", () => {
    const keyboardSecond = ini(
      line('Gamepad', { display: 'NSLOCTEXT("K", "X", "Pad words")' }),
      line('Keyboard', { display: 'NSLOCTEXT("K", "X", "Key words")' }),
    );
    const noKeyboard = ini(
      line('Gamepad', { display: 'NSLOCTEXT("K", "X", "Pad words")' }),
      line('Joystick', { display: 'NSLOCTEXT("K", "X", "Stick words")' }),
    );
    expect([one(keyboardSecond)[0]?.name, one(noKeyboard)[0]?.name]).toEqual([
      'Key words',
      'Pad words',
    ]);
  });

  it('names an action with no display name at all by its Action', () => {
    const file = ini(line('Keyboard').replace(/DisplayName=NSLOCTEXT\([^)]*\),/, ''));
    expect(one(file)[0]?.name).toBe('Fire');
  });

  it('reads the section by its header, spaces after it or not', () => {
    const file = ini(line('Keyboard', { key1: 'F' })).replace(
      '[/Script/ES2.CustomPlayerInput]',
      '[/Script/ES2.CustomPlayerInput]  ',
    );
    expect(one(file)).toHaveLength(1);
  });

  it('leaves a line that lacks a field it needs, and keeps it as it is', () => {
    const noCategory = line('Keyboard', { key1: 'F' }).replace('Category=1,', '');
    const noKey2 = line('Keyboard', { action: 'Jump', key1: 'J' }).replace('Key2=None,', '');
    const file = ini(noCategory, noKey2);
    expect([one(file), writeUnrealIni(file, [])]).toEqual([[], file]);
  });

  it('reads the first line a group has for a row, and writes that one', () => {
    const file = ini(line('Keyboard', { key1: 'F' }), line('Keyboard', { key1: 'G' }));
    const after = writeUnrealIni(file, [row('Fire', 'keyboard', key('H'))]);
    expect([
      one(file)[0]?.native?.key,
      after.split('\r\n').map((l) => /Key1=\w+/.exec(l)?.[0]),
    ]).toEqual([key('F'), [undefined, 'Key1=H', 'Key1=G', undefined]]);
  });

  it('keeps a key of the wrong kind for its group', () => {
    const file = ini(
      line('Keyboard', { key1: 'Gamepad_FaceButton_Bottom' }),
      line('Gamepad', { key1: 'A' }),
    );
    expect([one(file)[0]?.native, harvestUnrealIni(file, GAME).kept]).toEqual([
      undefined,
      [
        { action: 'Fire', set: 'keyboard', text: 'Gamepad_FaceButton_Bottom' },
        { action: 'Fire', set: 'controller', text: 'A' },
      ],
    ]);
  });

  it('reads a key after one it keeps as the first, not a second', () => {
    const file = ini(line('Keyboard', { key1: 'MouseX', key2: 'G' }));
    expect([one(file)[0]?.native?.key, harvestUnrealIni(file, GAME).kept]).toEqual([
      key('G'),
      [{ action: 'Fire', set: 'keyboard', text: 'MouseX' }],
    ]);
  });

  it('gives a half at scale 0 the positive end, and no .neg', () => {
    const file = ini(
      line('Gamepad', { action: 'Move', axis: true, key1: 'Gamepad_LeftY' }),
      line('Gamepad', { action: 'Move', scale: '0.000000' }),
    );
    expect(one(file).map((a) => [a.id, a.native?.pad])).toEqual([['Move', 'LS_UP']]);
  });
});

describe('Everspace 2: how a stick turns', () => {
  const stick = (axis: LineOptions) =>
    ini(
      line('Gamepad', { action: 'Move', axis: true, key1: 'Gamepad_LeftY', ...axis }),
      line('Gamepad', { action: 'Move', scale: '1.000000' }),
      line('Gamepad', { action: 'Move', scale: '-1.000000' }),
    );
  const ends = (file: string) => one(file).map((a) => a.native?.pad);

  it('as the axis has it, at scale 0 too', () => {
    expect(ends(stick({ scale: '0.000000' }))).toEqual(['LS_UP', 'LS_DOWN']);
  });

  it('as the axis has it', () => {
    expect(ends(stick({}))).toEqual(['LS_UP', 'LS_DOWN']);
  });

  it('the other way round when the axis is inverted', () => {
    expect(ends(stick({ invert: 'True' }))).toEqual(['LS_DOWN', 'LS_UP']);
  });

  it('the other way round when the axis scale is negative', () => {
    expect(ends(stick({ scale: '-1.000000' }))).toEqual(['LS_DOWN', 'LS_UP']);
  });

  it('back again when it is both', () => {
    expect(ends(stick({ invert: 'True', scale: '-1.000000' }))).toEqual(['LS_UP', 'LS_DOWN']);
  });

  it('not at all when the axis line holds a second binding', () => {
    expect(ends(stick({ key2: 'Gamepad_FaceButton_Bottom' }))).toEqual([undefined, undefined]);
  });

  it('not for the same action in another category', () => {
    const file = ini(
      line('Gamepad', { action: 'Move', axis: true, key1: 'Gamepad_LeftY', category: '4' }),
      line('Gamepad', { action: 'Move', category: '1' }),
    );
    expect(ends(file)).toEqual([undefined]);
  });

  it('lets go of the stick when a half asks for it and another button', () => {
    const after = writeUnrealIni(stick({}), [
      row('Move', 'controller', pad('LS_UP')),
      row('Move', 'controller', pad('DPAD_UP')),
    ]);
    expect(after.split('\r\n').map((l) => /Key1=\w+,Key1Mod=None,Key2=\w+/.exec(l)?.[0])).toEqual([
      undefined,
      'Key1=None,Key1Mod=None,Key2=None',
      'Key1=Gamepad_LeftStick_Up,Key1Mod=None,Key2=Gamepad_DPad_Up',
      'Key1=Gamepad_LeftStick_Down,Key1Mod=None,Key2=None',
      undefined,
    ]);
  });

  it('says once what does not fit, when both halves ask', () => {
    expect(
      problemsOf(() =>
        writeUnrealIni(stick({}), [
          row('Move', 'controller', pad('A')),
          row('Move', 'controller', pad('B')),
          row('Move', 'controller', pad('X')),
          row('Move.neg', 'controller', pad('Y')),
        ]),
      ),
    ).toEqual(["Fire it: a line holds two bindings, so the controller's X doesn't fit."]);
  });
});

describe('Everspace 2: the words of an error', () => {
  it('says what each kind of signal is when it is in the wrong set', () => {
    const file = ini(line('Keyboard', { key1: 'F' }), line('Gamepad'));
    const problems = problemsOf(() =>
      writeUnrealIni(file, [
        row('Fire', 'controller', { kind: 'mouse', button: 'back' }),
        row('Fire', 'controller', { kind: 'scroll', dir: 'down', speed: 1 }),
        row('Fire', 'controller', { kind: 'macro', trigger: 'A' }),
        row('Fire', 'keyboard', key('A', ['ctrl', 'shift'])),
      ]),
    );
    expect(problems?.filter((p) => p.includes("isn't"))).toEqual([
      "Fire it: the mouse's back button isn't a controller binding.",
      "Fire it: scroll down isn't a controller binding.",
      "Fire it: a macro on A isn't a controller binding.",
    ]);
  });

  it('names a key with its modifiers', () => {
    const file = ini(line('Keyboard', { key1: 'F' }), line('Gamepad'));
    expect(
      problemsOf(() =>
        writeUnrealIni(file, [row('Fire', 'controller', key('A', ['ctrl', 'shift']))]),
      ),
    ).toEqual([
      "Fire it: Ctrl+Shift+A isn't a controller binding.",
      'Fire it: A row holds one modifier, not two.',
    ]);
  });
});

// --- Elite --------------------------------------------------------------------------------

const binds = (...controls: string[]): string =>
  ['<Root PresetName="Custom" MajorVersion="4" MinorVersion="1">', ...controls, '</Root>', ''].join(
    '\r\n',
  );
const control = (tag: string, ...slots: string[]) =>
  [`\t<${tag}>`, ...slots.map((s) => `\t\t${s}`), `\t</${tag}>`].join('\r\n');
const EMPTY2 = '<Secondary Device="{NoDevice}" Key="" />';
const elite = (file: string) => harvestEliteBinds(file, GAME);

describe('Elite: reading a slot', () => {
  it('is no slot with anything before or after it on its line', () => {
    const file = binds(
      control('A', 'x<Primary Device="Keyboard" Key="Key_A" />', EMPTY2),
      control('B', '<Primary Device="Keyboard" Key="Key_B" /> x', EMPTY2),
      control('C', '<Primary Device="Keyboard" Key="Key_C" />x', EMPTY2),
    );
    expect(elite(file).game.actions).toEqual([]);
  });

  it('is no control with anything before its tag', () => {
    const file = binds(
      [
        '\tx<Fire>',
        '\t\t<Primary Device="Keyboard" Key="Key_F" />',
        `\t\t${EMPTY2}`,
        '\t</Fire>',
      ].join('\r\n'),
    );
    expect(elite(file).game.actions).toEqual([]);
  });

  it('is no action with a third slot', () => {
    const file = binds(
      control(
        'Fire',
        '<Primary Device="Keyboard" Key="Key_F" />',
        EMPTY2,
        '<Primary Device="Keyboard" Key="Key_G" />',
      ),
    );
    expect(elite(file).game.actions).toEqual([]);
  });

  it('reads a modifier written with no space before its close', () => {
    const file = binds(
      control(
        'Fire',
        '<Primary Device="Keyboard" Key="Key_F">\r\n\t\t\t<Modifier Device="Keyboard" Key="Key_LeftShift"/>\r\n\t\t</Primary>',
        EMPTY2,
      ),
    );
    expect(elite(file).game.actions[0]?.native?.key).toEqual(key('F', ['shift']));
  });

  it('keeps a slot whose Modifier or Hold has anything after it', () => {
    const child = (c: string) =>
      binds(
        control(
          'Fire',
          `<Primary Device="Keyboard" Key="Key_F">\r\n\t\t\t${c}\r\n\t\t</Primary>`,
          EMPTY2,
        ),
      );
    expect(
      [
        '<Modifier Device="Keyboard" Key="Key_LeftShift" /> x',
        'x<Modifier Device="Keyboard" Key="Key_LeftShift" />',
        '<Modifier Device="Keyboard" Key="Key_LeftShift" />x',
        '<Hold Value="1" /> x',
        'x<Hold Value="1" />',
        '<Hold Value="1" />x',
      ].map((c) => elite(child(c)).kept.length),
    ).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('is empty on no device, or with no key', () => {
    const file = binds(
      control('A', '<Primary Device="{NoDevice}" Key="Key_A" />', EMPTY2),
      control('B', '<Primary Device="Keyboard" Key="" />', EMPTY2),
    );
    expect([elite(file).game.actions.map((a) => a.native), elite(file).kept]).toEqual([
      [undefined, undefined],
      [],
    ]);
  });

  it('is free on no device whatever key it names', () => {
    const file = binds(control('A', '<Primary Device="{NoDevice}" Key="Key_A" />', EMPTY2));
    expect(
      writeEliteBinds(file, [row('A', 'keyboard', key('B')), row('A', 'keyboard', key('C'))]),
    ).toBe(
      binds(
        control(
          'A',
          '<Primary Device="Keyboard" Key="Key_B" />',
          '<Secondary Device="Keyboard" Key="Key_C" />',
        ),
      ),
    );
  });

  it('reads the first of two keys, and keeps the second aside', () => {
    const file = binds(
      control(
        'A',
        '<Primary Device="Keyboard" Key="Key_A" />',
        '<Secondary Device="Keyboard" Key="Key_B" />',
      ),
    );
    expect([elite(file).game.actions[0]?.native, elite(file).kept]).toEqual([
      { key: key('A') },
      [{ action: 'A', set: 'keyboard', text: 'Key_B' }],
    ]);
  });

  it('reads the first of two controller buttons, and keeps the second aside', () => {
    const file = binds(
      control(
        'A',
        '<Primary Device="GamePad" Key="GamePad_FaceDown" />',
        '<Secondary Device="GamePad" Key="GamePad_FaceUp" />',
      ),
    );
    expect([elite(file).game.actions[0]?.native, elite(file).kept]).toEqual([
      { pad: 'A' },
      [{ action: 'A', set: 'controller', text: 'GamePad_FaceUp' }],
    ]);
  });

  it('is kept, not empty, when it holds a modifier and no key', () => {
    const file = binds(
      control(
        'A',
        '<Primary Device="{NoDevice}" Key="">\r\n\t\t\t<Modifier Device="Keyboard" Key="Key_LeftShift" />\r\n\t\t</Primary>',
        EMPTY2,
      ),
    );
    expect(
      problemsOf(() =>
        writeEliteBinds(file, [row('A', 'keyboard', key('B')), row('A', 'keyboard', key('C'))]),
      ),
    ).toEqual(["A: a control holds two bindings, so C doesn't fit."]);
  });

  it('lists a mouse button held with a key as kept, in the keyboard set', () => {
    const file = binds(
      control(
        'Fire',
        '<Primary Device="Mouse" Key="Mouse_1">\r\n\t\t\t<Modifier Device="Keyboard" Key="Key_LeftShift" />\r\n\t\t\t<Modifier Device="Keyboard" Key="Key_LeftAlt" />\r\n\t\t</Primary>',
        EMPTY2,
      ),
    );
    expect(elite(file).kept).toEqual([
      { action: 'Fire', set: 'keyboard', text: 'Mouse_1 with Key_LeftShift and Key_LeftAlt held' },
    ]);
  });

  it('lists a key named like a controller key on the keyboard in the keyboard set', () => {
    const file = binds(
      control('Fire', '<Primary Device="Keyboard" Key="Key_GamePad_X" />', EMPTY2),
    );
    expect(elite(file).kept).toEqual([{ action: 'Fire', set: 'keyboard', text: 'Key_GamePad_X' }]);
  });
});

describe('Elite: names in words', () => {
  it('splits a tag into words, keeping capitals that are all capitals', () => {
    const file = binds(
      ...[
        '__proto__',
        'UI__Up',
        'HumanoidSetSpeed100Button',
        'CamTranslateZHold_Landing',
        'SelectHumanoidTarget',
        'Fire_Buggy_Mode',
        'Target0Wingman',
      ].map((tag) => control(tag, '<Primary Device="{NoDevice}" Key="" />', EMPTY2)),
    );
    expect(elite(file).game.actions.map((a) => a.name)).toEqual([
      'proto',
      'UI up',
      'Set speed 100',
      'Cam translate Z hold',
      'Select humanoid target',
      'Fire buggy mode',
      'Target 0 wingman',
    ]);
  });
});

describe('Elite: writing', () => {
  it('keeps a key whose modifiers are the same in another order', () => {
    const file = binds(
      control(
        'Fire',
        '<Primary Device="Keyboard" Key="Key_F">\r\n\t\t\t<Modifier Device="Keyboard" Key="Key_LeftControl" />\r\n\t\t\t<Modifier Device="Keyboard" Key="Key_LeftShift" />\r\n\t\t</Primary>',
        EMPTY2,
      ),
    );
    expect(writeEliteBinds(file, [row('Fire', 'keyboard', key('F', ['shift', 'ctrl']))])).toBe(
      file,
    );
  });

  it('tells scroll up from scroll down', () => {
    const file = binds(control('Next', '<Primary Device="Mouse" Key="Pos_Mouse_ZAxis" />', EMPTY2));
    expect(
      writeEliteBinds(file, [row('Next', 'keyboard', { kind: 'scroll', dir: 'down', speed: 1 })]),
    ).toBe(file.replace('Pos_Mouse_ZAxis', 'Neg_Mouse_ZAxis'));
  });

  it('keeps a second key that an action of another mode is put on', () => {
    const file = binds(
      control(
        'UI_Up',
        '<Primary Device="Keyboard" Key="Key_W" />',
        '<Secondary Device="Keyboard" Key="Key_UpArrow" />',
      ),
      control('UI_Down', '<Primary Device="Keyboard" Key="Key_S" />', EMPTY2),
      control('YawLeftButton', '<Primary Device="Keyboard" Key="Key_A" />', EMPTY2),
    );
    const otherMode = writeEliteBinds(file, [
      row('UI_Up', 'keyboard', key('I')),
      row('YawLeftButton', 'keyboard', key('Up')),
    ]);
    const sameMode = writeEliteBinds(file, [
      row('UI_Up', 'keyboard', key('I')),
      row('UI_Down', 'keyboard', key('Up')),
    ]);
    const up = (text: string) => elite(text).kept.filter((k) => k.action === 'UI_Up');
    expect([up(otherMode), up(sameMode)]).toEqual([
      [{ action: 'UI_Up', set: 'keyboard', text: 'Key_UpArrow' }],
      [],
    ]);
  });

  it('keeps both keys when the write asks for both', () => {
    const file = binds(
      control(
        'UI_Up',
        '<Primary Device="Keyboard" Key="Key_W" />',
        '<Secondary Device="Keyboard" Key="Key_UpArrow" />',
      ),
    );
    expect(
      writeEliteBinds(file, [
        row('UI_Up', 'keyboard', key('I')),
        row('UI_Up', 'keyboard', key('Up')),
      ]),
    ).toBe(file.replace('Key_W', 'Key_I'));
  });

  it('indents a modifier one tab in when the slot sits level with its control', () => {
    const file = [
      '<Root PresetName="Custom">',
      '<Fire>',
      '<Primary Device="Keyboard" Key="Key_F" />',
      EMPTY2,
      '</Fire>',
      '</Root>',
    ].join('\r\n');
    expect(writeEliteBinds(file, [row('Fire', 'keyboard', key('G', ['alt']))])).toBe(
      file.replace(
        '<Primary Device="Keyboard" Key="Key_F" />',
        '<Primary Device="Keyboard" Key="Key_G">\r\n\t<Modifier Device="Keyboard" Key="Key_LeftAlt" />\r\n</Primary>',
      ),
    );
  });

  it('finds the controller on a trigger, the only controller binding there is', () => {
    const file = binds(
      control('Next', '<Primary Device="28DE11FF" Key="Pos_GamePad_RTrigger" />', EMPTY2),
      control('Fire', '<Primary Device="{NoDevice}" Key="" />', EMPTY2),
    );
    expect(writeEliteBinds(file, [row('Fire', 'controller', pad('A'))])).toBe(
      file.replace(
        '<Primary Device="{NoDevice}" Key="" />',
        '<Primary Device="28DE11FF" Key="GamePad_FaceDown" />',
      ),
    );
  });

  it('writes every slot a control changes, one after the other', () => {
    const file = binds(
      control(
        'Fire',
        '<Primary Device="Keyboard" Key="Key_F">\r\n\t\t\t<Modifier Device="Keyboard" Key="Key_LeftShift" />\r\n\t\t</Primary>',
        '<Secondary Device="Keyboard" Key="Key_G" />',
      ),
    );
    expect(writeEliteBinds(file, [row('Fire', 'keyboard', null)])).toBe(
      binds(control('Fire', '<Primary Device="{NoDevice}" Key="" />', EMPTY2)),
    );
  });
});

describe('Elite: StartPreset', () => {
  it('reads each name without the spaces around it, and passes over blank lines', () => {
    expect(readStartPreset(' Custom \r\n\r\n  \r\nKeyboardMouseOnly')).toEqual([
      'Custom',
      'KeyboardMouseOnly',
    ]);
  });

  it('leaves a line of spaces as it is', () => {
    expect(writeStartPreset('A\r\n  \r\nB', 'Custom')).toBe('Custom\r\n  \r\nCustom');
  });
});

describe("Elite: the newest of the player's files", () => {
  const FOLDER = 'L/Frontier Developments/Elite Dangerous/Options/Bindings';
  const disk = (names: string[]): FolderReader => ({
    list: (dir) =>
      dir === FOLDER
        ? [...names, 'StartPreset.4.start']
        : dir === 'L'
          ? ['Frontier Developments']
          : dir === 'L/Frontier Developments'
            ? ['Elite Dangerous']
            : dir === 'L/Frontier Developments/Elite Dangerous'
              ? ['Options']
              : dir === 'L/Frontier Developments/Elite Dangerous/Options'
                ? ['Bindings']
                : [],
    read: (path) => (path === `${FOLDER}/StartPreset.4.start` ? 'custom\r\n' : null),
    join: (dir, ...names) => [dir, ...names].join('/'),
  });
  const pick = (names: string[]) =>
    findEliteBinds({ installDir: null, localAppData: ['L'] }, disk(names))?.binds?.slice(
      FOLDER.length + 1,
    );

  it('by its version, in numbers, major first', () => {
    expect([
      pick(['Custom.4.9.binds', 'Custom.4.10.binds']),
      pick(['Custom.3.9.binds', 'Custom.4.0.binds']),
      pick(['Custom.4.0.binds', 'Custom.3.9.binds']),
      pick(['Custom.4.1.binds', 'Custom.4.0.binds']),
      pick(['Custom.9.1.binds', 'Custom.10.1.binds']),
    ]).toEqual([
      'Custom.4.10.binds',
      'Custom.4.0.binds',
      'Custom.4.0.binds',
      'Custom.4.1.binds',
      'Custom.10.1.binds',
    ]);
  });

  it('only a .binds file named for the preset', () => {
    expect([
      pick(['Custom.4.1.binds.bak']),
      pick(['MyCustom.4.1.binds']),
      pick(['Custom.binds']),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
