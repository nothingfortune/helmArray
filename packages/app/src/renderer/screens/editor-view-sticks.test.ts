// The stick agrees with the action list (the UI audit, summary item 4): what a stick does is read
// from the bindings the plan resolves, in every view.
import { describe, expect, it } from 'vitest';
import type { Scheme } from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
  blankKeysScheme,
  gameKeysPreset,
  helldivers2,
  resolve,
  xboxControllerPreset,
} from '@helmarray/core';
import { editorView } from './editor-view';
import type { DeviceTabId } from './editor-view';

const MOVES = ['Move forward', 'Move back', 'Strafe left', 'Strafe right'];

const view = (scheme: Scheme, selected?: string, tab?: DeviceTabId) =>
  editorView({
    scheme,
    game: helldivers2,
    plan: resolve(scheme, helldivers2, BUILT_IN_DEVICES),
    mode: 'default',
    selected,
    tab,
  });

const listed = (scheme: Scheme, selected?: string) =>
  view(scheme, selected).lists.flatMap((l) => l.actions.map((a) => a.name));

describe('the stick’s chips', () => {
  it('carry the actions on the left stick’s directions with controller output', () => {
    const { up, down, left, right, role } =
      view(xboxControllerPreset(helldivers2)).left.stick ?? {};
    expect([up, down, left, right, role]).toEqual([...MOVES, 'movement']);
  });

  it('carry the actions on the left stick’s keys with key output', () => {
    const { up, down, left, right } = view(gameKeysPreset(helldivers2)).left.stick ?? {};
    expect([up, down, left, right]).toEqual(MOVES);
  });

  it('stay as drawn on a stick with nothing on its directions: the right stick', () => {
    expect([
      view(xboxControllerPreset(helldivers2)).right.stick,
      view(gameKeysPreset(helldivers2)).right.stick,
    ]).toEqual([undefined, undefined]);
  });

  it('show a key stick’s key where no action is on it', () => {
    const scheme: Scheme = {
      ...blankKeysScheme(helldivers2),
      behaviour: {
        'L.stick': {
          stick: { mode: 'keys', directions: { up: { kind: 'key', code: 'I' } } },
        },
      },
    };
    expect(view(scheme).left.stick).toEqual({ up: 'I' });
  });
});

describe('the action list', () => {
  it('doesn’t list the stick’s actions as on no button, with either output', () => {
    expect({
      pad: listed(xboxControllerPreset(helldivers2)).filter((n) => MOVES.includes(n)),
      keys: listed(gameKeysPreset(helldivers2)).filter((n) => MOVES.includes(n)),
    }).toEqual({ pad: [], keys: [] });
  });

  it('lists them as on the stick, where to pick or drag them onto a button too', () => {
    expect(view(gameKeysPreset(helldivers2)).onStick.map((a) => [a.name, a.where])).toEqual(
      MOVES.map((n) => [n, 'Left · Stick']),
    );
  });

  it('lists the stick’s actions as on no button when the stick sends nothing', () => {
    expect(listed(blankKeysScheme(helldivers2)).filter((n) => MOVES.includes(n))).toEqual(MOVES);
  });

  it('doesn’t offer a stick’s action as one to move off another button', () => {
    expect(
      view(xboxControllerPreset(helldivers2), 'L.index_1').moves.filter((m) =>
        MOVES.includes(m.name),
      ),
    ).toEqual([]);
  });
});

describe('the stick’s side panel', () => {
  it('names the four directions, each with its action and what it sends', () => {
    const panel = view(xboxControllerPreset(helldivers2), 'L.stick').panel;
    expect(panel?.directions.map((d) => [d.word, d.action?.name, d.sends])).toEqual([
      ['Up', 'Move forward', 'Xbox Left stick up'],
      ['Down', 'Move back', 'Xbox Left stick down'],
      ['Left', 'Strafe left', 'Xbox Left stick left'],
      ['Right', 'Strafe right', 'Xbox Left stick right'],
    ]);
  });

  it('says a key stick’s keys, and nothing for a stick moving the mouse', () => {
    const scheme = gameKeysPreset(helldivers2);
    expect([
      view(scheme, 'L.stick').panel?.directions.map((d) => d.sends),
      view(scheme, 'R.stick').panel?.directions.map((d) => [d.action, d.sends]),
    ]).toEqual([
      ['W', 'S', 'A', 'D'],
      [
        [undefined, null],
        [undefined, null],
        [undefined, null],
        [undefined, null],
      ],
    ]);
  });

  it('has no direction rows for a button', () => {
    expect(view(xboxControllerPreset(helldivers2), 'L.index_1').panel?.directions).toEqual([]);
  });
});

describe('the controller’s sticks, on the Controller tab', () => {
  it('name the actions on their directions in one line; a stick with none isn’t listed', () => {
    const scheme: Scheme = {
      ...xboxControllerPreset(helldivers2),
      devices: { azerons: 'none', keyboard: false, mouse: false, controller: true },
    };
    const fixed = view(scheme, undefined, 'controller').fixed;
    expect([fixed['pad.left_stick'], fixed['pad.right_stick']]).toEqual([
      { label: MOVES.join(', '), role: 'movement' },
      undefined,
    ]);
  });
});
