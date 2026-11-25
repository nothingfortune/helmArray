// Elite Dangerous's .binds, read and written by @helmarray/games against the game's own files
// (reference/game-files/elite-*.binds, read only: nothing here writes to them).

import { readFileSync } from 'node:fs';
import type { GameBinding, Signal } from '@helmarray/core';
import { gameProblem } from '@helmarray/core';
import { GameFileError, harvestEliteBinds, writeEliteBinds } from '@helmarray/games';
import { describe, expect, it } from 'vitest';
import { thrown } from './thrown';

const bytes = (name: string): Buffer =>
  readFileSync(new URL(`../reference/game-files/${name}`, import.meta.url));
const CUSTOM_BYTES = bytes('elite-Custom.4.1.binds');
const KMO_BYTES = bytes('elite-KeyboardMouseOnly.binds');
const CUSTOM = CUSTOM_BYTES.toString('utf8');
const KMO = KMO_BYTES.toString('utf8');
const ELITE = { id: 'elite', name: 'Elite Dangerous' };
const snapshot = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../packages/games/src/__fixtures__/${name}`, import.meta.url), 'utf8'),
  );

const key = (code: string, mods?: string[]): Signal =>
  (mods === undefined ? { kind: 'key', code } : { kind: 'key', code, mods }) as Signal;
const pad = (control: string): Signal => ({ kind: 'pad', control }) as Signal;
const row = (
  action: string,
  set: GameBinding['set'],
  signal: Signal | null,
  mode = 'ship',
): GameBinding => ({ set, mode, action, signal, native: null });

/** The lines that differ, as [line number, before, after]; the files must have as many lines. */
function diff(before: string, after: string): [number, string, string][] {
  const a = before.split('\r\n');
  const b = after.split('\r\n');
  return a.length !== b.length
    ? [[0, `${a.length} lines`, `${b.length} lines`]]
    : a.flatMap((line, i) => (line === b[i] ? [] : [[i + 1, line, b[i] ?? '']]));
}

const custom = harvestEliteBinds(CUSTOM, ELITE);
const kmo = harvestEliteBinds(KMO, ELITE);
const action = (id: string, harvest = custom) => harvest.game.actions.find((a) => a.id === id);

describe('Elite: harvest', () => {
  it('matches the reviewed snapshots', () => {
    expect([custom, kmo]).toEqual([
      snapshot('elite-custom.harvest.json'),
      snapshot('elite-keyboard-mouse-only.harvest.json'),
    ]);
  });

  it('gives games helmArray can save', () => {
    expect([gameProblem(custom.game), gameProblem(kmo.game)]).toEqual([null, null]);
  });

  it("has the ship, the SRV and on foot first, then the rest of the game's modes", () => {
    expect(custom.game.modes.map((m) => m.id)).toEqual([
      'ship',
      'landing',
      'srv',
      'foot',
      'fss',
      'dss',
      'fighter',
      'multicrew',
      'ui',
      'map',
      'headlook',
      'camera',
      'store',
      'general',
    ]);
  });

  it('reads every control with a Primary and a Secondary as an action', () => {
    expect([custom.game.actions.length, kmo.game.actions.length]).toEqual([334, 311]);
  });

  it('puts each control in its mode', () => {
    const modes = [
      'RollLeftButton',
      'RollLeftButton_Landing',
      'SteerLeftButton',
      'BuggyPrimaryFireButton',
      'HumanoidForwardButton',
      'ExplorationFSSEnter',
      'ExplorationFSSZoomIn',
      'UI_Up',
      'CamZoomIn',
      'Pause',
    ].map((id) => action(id)?.mode);
    expect(modes).toEqual([
      'ship',
      'landing',
      'srv',
      'srv',
      'foot',
      'ship',
      'fss',
      'ui',
      'map',
      'general',
    ]);
  });

  it('has the colony construction mode where the preset has its controls', () => {
    expect(
      ['PlaceSettlement', 'TriggerColonisationModule'].map((id) => action(id, kmo)?.mode),
    ).toEqual(['construction', 'construction']);
  });

  it('reads a key, a key with a modifier, a mouse button and a controller button', () => {
    expect(
      [
        'RollLeftButton',
        'ForwardKey',
        'PrimaryFire',
        'CycleFireGroupNext',
        'UI_Up',
        'HumanoidPrimaryFireButton',
      ].map((id) => [action(id)?.name, action(id)?.native]),
    ).toEqual([
      ['Roll left', { key: key('Q') }],
      ['Forward key', { key: key('W', ['shift']) }],
      ['Primary fire', { key: { kind: 'mouse', button: 'left' } }],
      ['Cycle fire group next', { key: { kind: 'mouse', button: 'forward' } }],
      ['UI up', { key: key('W'), pad: 'DPAD_UP' }],
      ['Primary fire', { pad: 'RT' }],
    ]);
  });

  it("reads the wheel and the backslash as the game's own preset writes them", () => {
    expect(
      [
        'HumanoidSelectNextWeaponButton',
        'HumanoidSelectPreviousWeaponButton',
        'MicrophoneMute',
      ].map((id) => action(id, kmo)?.native?.key),
    ).toEqual([
      { kind: 'scroll', dir: 'down', speed: 1 },
      { kind: 'scroll', dir: 'up', speed: 1 },
      key('\\'),
    ]);
  });

  it('gives roles where the control says what it is', () => {
    expect(
      ['RollLeftButton', 'PrimaryFire', 'Supercruise', 'UI_Up', 'LandingGearToggle'].map(
        (id) => action(id)?.role ?? 'none',
      ),
    ).toEqual(['movement', 'combat', 'travel', 'menu', 'none']);
  });

  it('sets aside the chords helmArray cannot name', () => {
    const chords = custom.kept.filter((k) => k.text.includes(' with '));
    expect(chords.slice(0, 3).map((k) => `${k.action} ${k.set} ${k.text}`)).toEqual([
      'DownThrustButton keyboard Key_LeftShift with Key_RightBracket held',
      'HeadlightsBuggyButton controller GamePad_DPadLeft with GamePad_FaceDown held',
      'BuggyCycleFireGroupNext controller GamePad_RBumper with GamePad_FaceLeft held',
    ]);
  });

  it('reads no default for an action bound only by a chord', () => {
    expect(action('DownThrustButton')?.native).toBeUndefined();
  });
});

describe('Elite: write', () => {
  it('gives both files back byte for byte when nothing changes, BOM included', () => {
    expect([
      Buffer.from(writeEliteBinds(CUSTOM, []), 'utf8').equals(CUSTOM_BYTES),
      Buffer.from(writeEliteBinds(KMO, []), 'utf8').equals(KMO_BYTES),
    ]).toEqual([true, true]);
  });

  it('gives the file back byte for byte when every row is what it has', () => {
    const rows = custom.game.actions.flatMap((a) => [
      row(a.id, 'keyboard', a.native?.key ?? null, a.mode),
      row(a.id, 'controller', a.native?.pad === undefined ? null : pad(a.native.pad), a.mode),
    ]);
    expect(Buffer.from(writeEliteBinds(CUSTOM, rows), 'utf8').equals(CUSTOM_BYTES)).toBe(true);
  });

  it("moves one key: only that slot's line changes", () => {
    expect(
      diff(CUSTOM, writeEliteBinds(CUSTOM, [row('RollLeftButton', 'keyboard', key('Z'))])),
    ).toEqual([
      [
        49,
        '\t\t<Primary Device="Keyboard" Key="Key_Q" />',
        '\t\t<Primary Device="Keyboard" Key="Key_Z" />',
      ],
    ]);
  });

  it("writes a modifier as the slot's Modifier, in the file's own shape", () => {
    const before = '\t<RollLeftButton>\r\n\t\t<Primary Device="Keyboard" Key="Key_Q" />\r\n';
    const after =
      '\t<RollLeftButton>\r\n\t\t<Primary Device="Keyboard" Key="Key_Z">\r\n' +
      '\t\t\t<Modifier Device="Keyboard" Key="Key_LeftAlt" />\r\n\t\t</Primary>\r\n';
    expect(writeEliteBinds(CUSTOM, [row('RollLeftButton', 'keyboard', key('Z', ['alt']))])).toBe(
      CUSTOM.replace(before, after),
    );
  });

  it('takes a modifier away: the slot is one line again', () => {
    const before =
      '\t<ForwardKey>\r\n\t\t<Primary Device="Keyboard" Key="Key_W">\r\n' +
      '\t\t\t<Modifier Device="Keyboard" Key="Key_LeftShift" />\r\n\t\t</Primary>\r\n';
    const after = '\t<ForwardKey>\r\n\t\t<Primary Device="Keyboard" Key="Key_W" />\r\n';
    expect(writeEliteBinds(CUSTOM, [row('ForwardKey', 'keyboard', key('W'))])).toBe(
      CUSTOM.replace(before, after),
    );
  });

  it("puts a controller button in the free slot, on the device the file's controller already is", () => {
    expect(
      diff(CUSTOM, writeEliteBinds(CUSTOM, [row('RollLeftButton', 'controller', pad('LB'))])),
    ).toEqual([
      [
        50,
        '\t\t<Secondary Device="{NoDevice}" Key="" />',
        '\t\t<Secondary Device="28DE11FF" Key="GamePad_LBumper" />',
      ],
    ]);
  });

  it('moves a controller button, leaving the keyboard slot beside it', () => {
    const lines = diff(
      CUSTOM,
      writeEliteBinds(CUSTOM, [row('UI_Up', 'controller', pad('Y'), 'ui')]),
    );
    expect(lines.map(([n, , now]) => [n, now])).toEqual([
      [557, '\t\t<Primary Device="28DE11FF" Key="GamePad_FaceUp" />'],
    ]);
  });

  it('clears an action with a null row', () => {
    const lines = diff(CUSTOM, writeEliteBinds(CUSTOM, [row('UI_Up', 'keyboard', null, 'ui')]));
    expect(lines.map(([n, , now]) => [n, now])).toEqual([
      [558, '\t\t<Secondary Device="{NoDevice}" Key="" />'],
    ]);
  });

  it('never touches a chord: a null row leaves it, and a new binding takes the other slot', () => {
    const cleared = writeEliteBinds(CUSTOM, [row('DownThrustButton', 'keyboard', null)]);
    const moved = writeEliteBinds(CUSTOM, [row('DownThrustButton', 'keyboard', key('F'))]);
    expect([diff(CUSTOM, cleared), diff(CUSTOM, moved).map(([n, , now]) => [n, now])]).toEqual([
      [],
      [[97, '\t\t<Secondary Device="Keyboard" Key="Key_F" />']],
    ]);
  });

  it('refuses a controller binding when the file names no controller and none is given', () => {
    const error = thrown(() =>
      writeEliteBinds(KMO, [row('YawLeftButton', 'controller', pad('A'))]),
    );
    expect((error as GameFileError).problems).toEqual([
      "Yaw left: the file has no controller in it to bind the controller's A to.",
    ]);
  });

  it('binds a controller on the device it is given when the file names none', () => {
    const after = writeEliteBinds(KMO, [row('YawLeftButton', 'controller', pad('A'))], {
      padDevice: 'GamePad',
    });
    expect(diff(KMO, after).map(([, , now]) => now)).toEqual([
      '\t\t<Secondary Device="GamePad" Key="GamePad_FaceDown" />',
    ]);
  });

  it('refuses, naming each, what it cannot write', () => {
    const error = thrown(() =>
      writeEliteBinds(CUSTOM, [
        row('RollLeftButton', 'keyboard', key('F13')),
        row('PrimaryFire', 'controller', pad('START')),
        row('Nothing', 'keyboard', key('A')),
        row('YawLeftButton', 'keyboard', key('A')),
        row('YawLeftButton', 'keyboard', key('B')),
        row('YawLeftButton', 'controller', pad('A')),
      ]),
    );
    expect(error).toBeInstanceOf(GameFileError);
    expect((error as GameFileError).problems).toEqual([
      'Roll left: Elite has no name for F13.',
      "Primary fire: Elite has no name for the controller's START.",
      'The file has no action "Nothing".',
      "Yaw left: a control holds two bindings, so the controller's A doesn't fit.",
    ]);
  });
});
