// Everspace 2's Input.ini, read and written by @helmarray/games against the game's own file
// (reference/game-files/everspace2-Input.before.ini, read only: nothing here writes to it).

import { readFileSync } from 'node:fs';
import type { GameBinding, Signal } from '@helmarray/core';
import { gameProblem } from '@helmarray/core';
import { GameFileError, harvestUnrealIni, writeUnrealIni } from '@helmarray/games';
import { describe, expect, it } from 'vitest';
import { thrown } from './thrown';

const BYTES = readFileSync(
  new URL('../reference/game-files/everspace2-Input.before.ini', import.meta.url),
);
const FILE = BYTES.toString('utf8');
const SNAPSHOT = new URL(
  '../packages/games/src/__fixtures__/everspace2.harvest.json',
  import.meta.url,
);
const ES2 = { id: 'everspace2', name: 'Everspace 2' };

const key = (code: string): Signal => ({ kind: 'key', code }) as Signal;
const pad = (control: string): Signal => ({ kind: 'pad', control }) as Signal;
const row = (
  action: string,
  set: GameBinding['set'],
  signal: Signal | null,
  mode = 'flight',
): GameBinding => ({ set, mode, action, signal, native: null });

/** The lines that differ, as [line number, before, after]; the files must have as many lines. */
function diff(before: string, after: string): [number, string, string][] {
  const a = before.split('\r\n');
  const b = after.split('\r\n');
  expect(b.length, 'line count').toBe(a.length);
  return a.flatMap((line, i) => (line === b[i] ? [] : [[i + 1, line, b[i] ?? '']]));
}

const harvest = harvestUnrealIni(FILE, ES2);
const action = (id: string) => harvest.game.actions.find((a) => a.id === id);

describe('Everspace 2: harvest', () => {
  it('matches the reviewed snapshot', () => {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as unknown;
    expect(harvest).toEqual(snapshot);
  });

  it('is a game helmArray can save', () => {
    expect(gameProblem(harvest.game)).toBeNull();
  });

  it('has the three modes: flight, the menus and photo mode', () => {
    expect(harvest.game.modes).toEqual([
      { id: 'flight', name: 'Flight' },
      { id: 'menus', name: 'Menus' },
      { id: 'photo', name: 'Photo mode' },
    ]);
  });

  it('reads every row that is not an axis as an action: 111', () => {
    expect(harvest.game.actions).toHaveLength(111);
  });

  it('has the movement on W, S, A and D, as the file has them', () => {
    const keys = ['MoveForward', 'MoveForward.neg', 'MoveRight.neg', 'MoveRight'].map((id) => [
      action(id)?.name,
      action(id)?.native?.key,
    ]);
    expect(keys).toEqual([
      ['Thrust forward', key('W')],
      ['Thrust backward', key('S')],
      ['Strafe left', key('D')],
      ['Strafe right', key('A')],
    ]);
  });

  it('puts thrust on the left stick through its axis row', () => {
    expect([action('MoveForward')?.native?.pad, action('MoveForward.neg')?.native?.pad]).toEqual([
      'LS_UP',
      'LS_DOWN',
    ]);
  });

  it("reads a row's own controller line ahead of its axis", () => {
    // Scroll's axis row says the right stick, inverted to the halves the rows bind themselves.
    expect([action('Scroll')?.native?.pad, action('Scroll.neg')?.native?.pad]).toEqual([
      'RS_DOWN',
      'RS_UP',
    ]);
  });

  it("names actions in the game's words and reads the mouse and the pad", () => {
    expect(action('FirePrimary')).toEqual({
      id: 'FirePrimary',
      name: 'Fire primary weapon',
      mode: 'flight',
      role: 'combat',
      required: true,
      native: { key: { kind: 'mouse', button: 'left' }, pad: 'RT' },
    });
  });

  it('marks thrust, strafe and the primary weapon required, and nothing else', () => {
    expect(harvest.game.actions.filter((a) => a.required).map((a) => a.id)).toEqual([
      'FirePrimary',
      'MoveForward.neg',
      'MoveForward',
      'MoveRight.neg',
      'MoveRight',
    ]);
  });

  it('sets aside the second keys the game data cannot hold, and nothing else', () => {
    expect(harvest.kept.map((k) => `${k.action} ${k.set} ${k.text}`)).toEqual([
      'NavigateRight.neg keyboard Left',
      'NavigateRight keyboard Right',
      'NavigateUp.neg keyboard Down',
      'NavigateUp keyboard Up',
      'OK keyboard Enter',
    ]);
  });
});

describe('Everspace 2: write', () => {
  it('gives the file back byte for byte when nothing changes', () => {
    expect(Buffer.from(writeUnrealIni(FILE, []), 'utf8').equals(BYTES)).toBe(true);
  });

  it('gives the file back byte for byte when every row is what it has', () => {
    const rows = harvest.game.actions.flatMap((a) => [
      row(a.id, 'keyboard', a.native?.key ?? null, a.mode),
      row(a.id, 'controller', a.native?.pad === undefined ? null : pad(a.native.pad), a.mode),
    ]);
    expect(Buffer.from(writeUnrealIni(FILE, rows), 'utf8').equals(BYTES)).toBe(true);
  });

  it("moves one key: only the Key1 of that action's keyboard line changes", () => {
    const after = writeUnrealIni(FILE, [row('Boost', 'keyboard', key('Space'))]);
    const [[line, before, now] = [0, '', '']] = diff(FILE, after);
    expect(diff(FILE, after)).toHaveLength(1);
    expect([line, now]).toEqual([line, before.replace('Key1=LeftShift,', 'Key1=SpaceBar,')]);
  });

  it("the one changed line is Boost's keyboard line, and its ending is still CRLF", () => {
    const after = writeUnrealIni(FILE, [row('Boost', 'keyboard', key('Space'))]);
    expect(diff(FILE, after).map(([n]) => n)).toEqual([7]);
    expect(after.endsWith('\r\n\r\n')).toBe(true);
  });

  it("writes a modifier into the slot's Mod", () => {
    const after = writeUnrealIni(FILE, [
      row('Boost', 'keyboard', { kind: 'key', code: 'B', mods: ['ctrl'] }),
    ]);
    expect(diff(FILE, after).map(([, , now]) => /Key1=[^,]*,Key1Mod=[^,]*/.exec(now)?.[0])).toEqual(
      ['Key1=B,Key1Mod=LeftControl'],
    );
  });

  it('clears an action with a null row', () => {
    const after = writeUnrealIni(FILE, [row('Boost', 'keyboard', null)]);
    expect(diff(FILE, after).map(([, , now]) => /Key1=[^,]*/.exec(now)?.[0])).toEqual([
      'Key1=None',
    ]);
  });

  it('writes two keys into Key1 and Key2, keeping the one already there in place', () => {
    const after = writeUnrealIni(FILE, [
      row('Boost', 'keyboard', key('X')),
      row('Boost', 'keyboard', key('LShift')),
    ]);
    expect(
      diff(FILE, after).map(([, , now]) => /Key1=[^,]*,Key1Mod=None,Key2=[^,]*/.exec(now)?.[0]),
    ).toEqual(['Key1=LeftShift,Key1Mod=None,Key2=X']);
  });

  it('moves a controller button: only the Gamepad line changes', () => {
    const after = writeUnrealIni(FILE, [row('FirePrimary', 'controller', pad('RB'))]);
    expect(
      diff(FILE, after).map(([, before, now]) => [
        /GroupName="\w+"/.exec(now)?.[0],
        now === before.replace('Key1=Gamepad_RightTrigger,', 'Key1=Gamepad_RightShoulder,'),
      ]),
    ).toEqual([['GroupName="Gamepad"', true]]);
  });

  it('leaves a stick alone when both halves stay on it', () => {
    const after = writeUnrealIni(FILE, [
      row('MoveForward', 'controller', pad('LS_UP')),
      row('MoveForward.neg', 'controller', pad('LS_DOWN')),
    ]);
    expect(diff(FILE, after)).toEqual([]);
  });

  it('moves half a stick: the axis row lets go and each half binds on its own line', () => {
    const after = writeUnrealIni(FILE, [row('MoveForward', 'controller', pad('DPAD_UP'))]);
    const changed = diff(FILE, after).map(
      ([, , now]) => /AxisName="\w+",Category=\d,bIsAxis=\w+,Key1=[^,]*/.exec(now)?.[0],
    );
    expect(changed.sort()).toEqual([
      'AxisName="MoveFwd",Category=0,bIsAxis=False,Key1=Gamepad_DPad_Up',
      'AxisName="MoveFwd",Category=0,bIsAxis=False,Key1=Gamepad_LeftStick_Down',
      'AxisName="MoveFwd",Category=0,bIsAxis=True,Key1=None',
    ]);
  });

  it('after half a stick moves, harvest reads both halves where they were put', () => {
    const after = harvestUnrealIni(
      writeUnrealIni(FILE, [row('MoveForward', 'controller', pad('DPAD_UP'))]),
      ES2,
    );
    const pads = ['MoveForward', 'MoveForward.neg'].map(
      (id) => after.game.actions.find((a) => a.id === id)?.native?.pad,
    );
    expect(pads).toEqual(['DPAD_UP', 'LS_DOWN']);
  });

  it('never touches a Joystick line', () => {
    const after = writeUnrealIni(FILE, [
      row('MoveForward', 'controller', pad('DPAD_UP')),
      row('Boost', 'keyboard', key('Space')),
      row('FirePrimary', 'controller', pad('RB')),
    ]);
    expect(diff(FILE, after).filter(([, line]) => line.includes('GroupName="Joystick"'))).toEqual(
      [],
    );
  });

  it('keeps a second key when its action moves', () => {
    const after = writeUnrealIni(FILE, [row('NavigateRight', 'keyboard', key('L'), 'menus')]);
    expect(
      diff(FILE, after).map(([, , now]) => /Key1=[^,]*,Key1Mod=None,Key2=[^,]*/.exec(now)?.[0]),
    ).toEqual(['Key1=L,Key1Mod=None,Key2=Right']);
  });

  it('clears a second key when its action is put on nothing', () => {
    const after = writeUnrealIni(FILE, [row('NavigateRight', 'keyboard', null, 'menus')]);
    expect(
      diff(FILE, after).map(([, , now]) => /Key1=[^,]*,Key1Mod=None,Key2=[^,]*/.exec(now)?.[0]),
    ).toEqual(['Key1=None,Key1Mod=None,Key2=None']);
  });

  it('clears a second key another action of its mode is put on', () => {
    const after = writeUnrealIni(FILE, [
      row('NavigateRight', 'keyboard', key('D'), 'menus'),
      row('Cancel', 'keyboard', key('Right'), 'menus'),
    ]);
    expect(
      diff(FILE, after).map(([, , now]) =>
        /Action=\w+.*Key1=[^,]*,Key1Mod=None,Key2=[^,]*/
          .exec(now)?.[0]
          .replace(/,ActionName.*Key1=/, ' Key1='),
      ),
    ).toEqual([
      'Action=Cancel Key1=Right,Key1Mod=None,Key2=None',
      'Action=NavigateRight Key1=D,Key1Mod=None,Key2=None',
    ]);
  });

  it('keeps a second key an action of another mode is put on', () => {
    const after = writeUnrealIni(FILE, [
      row('NavigateRight', 'keyboard', key('D'), 'menus'),
      row('Boost', 'keyboard', key('Right')),
    ]);
    expect(diff(FILE, after).filter(([, line]) => line.includes('Action=NavigateRight'))).toEqual(
      [],
    );
  });

  it('refuses, naming each, what it cannot write', () => {
    const error = thrown(() =>
      writeUnrealIni(FILE, [
        row('Boost', 'keyboard', key('F13')),
        row('FirePrimary', 'keyboard', pad('A')),
        row('Nothing', 'keyboard', key('A')),
        row('Interact', 'keyboard', { kind: 'scroll', dir: 'left', speed: 1 }),
      ]),
    );
    expect(error).toBeInstanceOf(GameFileError);
    expect((error as GameFileError).problems).toEqual([
      'Boost [HOLD]: Unreal has no name for F13.',
      "Fire primary weapon: the controller's A isn't a keyboard binding.",
      'The file has no action "Nothing".',
      'Interact: Unreal has no name for scroll left.',
    ]);
  });

  it('refuses a third key: a line holds two', () => {
    const error = thrown(() =>
      writeUnrealIni(
        FILE,
        ['A', 'B', 'C'].map((code) => row('Boost', 'keyboard', key(code))),
      ),
    );
    expect((error as GameFileError).problems).toEqual([
      "Boost [HOLD]: a line holds two bindings, so C doesn't fit.",
    ]);
  });
});
