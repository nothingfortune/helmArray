// Whether an action is placed: one function for the checks, the editor's lists and the stick.
import { describe, expect, it } from 'vitest';
import { BUILT_IN_DEVICES } from './devices/index';
import { helldivers2 } from './games/helldivers2';
import type { Scheme } from './model';
import { isPlaced, placedIn, stickActions } from './placed';
import { blankKeysScheme, gameKeysPreset } from './presets/keys';
import { xboxControllerPreset } from './presets/xbox';
import { resolve } from './resolve';

const MOVES = ['move_forward', 'move_back', 'strafe_left', 'strafe_right'];

const plan = (scheme: Scheme) => resolve(scheme, helldivers2, BUILT_IN_DEVICES);
const onSticks = (scheme: Scheme) =>
  stickActions(scheme, plan(scheme)).map((s) => `${s.stick} ${s.direction} ${s.action}`);

describe('stickActions', () => {
  it('reads an Xbox stick from the controller bindings: the left stick does the movement', () => {
    const scheme = xboxControllerPreset(helldivers2);
    expect(onSticks(scheme)).toEqual([
      'L.stick up move_forward',
      'L.stick down move_back',
      'L.stick left strafe_left',
      'L.stick right strafe_right',
    ]);
  });

  it('reads a key stick from the keyboard bindings: W, S, A and D are the movement', () => {
    expect(onSticks(gameKeysPreset(helldivers2))).toEqual([
      'L.stick up move_forward',
      'L.stick down move_back',
      'L.stick left strafe_left',
      'L.stick right strafe_right',
    ]);
  });

  it('finds nothing on a stick that sends nothing, or moves the mouse', () => {
    const blank = blankKeysScheme(helldivers2);
    const mouse: Scheme = {
      ...blank,
      behaviour: {
        'L.stick': { stick: { mode: 'mouse' } },
        'R.stick': { stick: { mode: 'mouse' } },
      },
    };
    expect([onSticks(blank), onSticks(mouse)]).toEqual([[], []]);
  });

  it('reads the controller’s own left stick when the setup has a controller', () => {
    const scheme: Scheme = {
      ...xboxControllerPreset(helldivers2),
      devices: { azerons: 'none', keyboard: false, mouse: false, controller: true },
    };
    expect(onSticks(scheme).filter((s) => s.startsWith('pad.'))).toEqual([
      'pad.left_stick up move_forward',
      'pad.left_stick down move_back',
      'pad.left_stick left strafe_left',
      'pad.left_stick right strafe_right',
    ]);
  });

  it('follows the game’s bindings, not the shipped ones: an action put on a stick key is on it', () => {
    // Melee put on a button that sends W, the key the stick sends: the stick now does it too.
    const keys = gameKeysPreset(helldivers2);
    const scheme: Scheme = { ...keys, ledger: { 'R.ring_2': { tap: { kind: 'key', code: 'W' } } } };
    scheme.map = { default: { ...scheme.map['default'], 'R.ring_2': { tap: 'push_to_talk' } } };
    expect(onSticks(scheme)).toContain('L.stick up push_to_talk');
  });
});

describe('placedIn and isPlaced', () => {
  it('puts the stick’s actions in the list of what is placed, on the stick', () => {
    const scheme = xboxControllerPreset(helldivers2);
    const placed = placedIn(scheme, helldivers2, plan(scheme), 'default', 'controller');
    expect(MOVES.map((a) => placed.get(a))).toEqual(['L.stick', 'L.stick', 'L.stick', 'L.stick']);
  });

  it('puts an action on a control of the setup in the list, on the control', () => {
    const scheme = xboxControllerPreset(helldivers2);
    const placed = placedIn(scheme, helldivers2, plan(scheme), 'default', 'controller');
    expect(placed.get('fire_primary')).toBe('L.index_2');
  });

  it('leaves out a control of a device the setup doesn’t use', () => {
    const scheme: Scheme = {
      ...blankKeysScheme(helldivers2),
      map: { default: { 'key.R': { tap: 'reload' } } },
    };
    expect(isPlaced(scheme, helldivers2, plan(scheme), 'default', 'reload')).toBe(false);
  });

  it('counts an action placed in a binding set the setup uses, and only those', () => {
    const scheme = xboxControllerPreset(helldivers2);
    const p = plan(scheme);
    expect([
      isPlaced(scheme, helldivers2, p, 'default', 'move_forward'),
      isPlaced(scheme, helldivers2, p, 'default', 'grenade'),
      placedIn(scheme, helldivers2, p, 'default', 'keyboard').size,
    ]).toEqual([true, false, 0]);
  });
});
