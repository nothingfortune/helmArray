// Repeated findings, grouped by role: "4 movement actions aren't on a button".
import { describe, expect, it } from 'vitest';
import type { Scheme } from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
  blankKeysScheme,
  helldivers2,
  resolve,
  xboxControllerPreset,
} from '@helmarray/core';
import { clear } from './editor-model';
import { groupChecks } from './check-groups';
import type { CheckGroup, CheckItem } from './check-groups';
import { editorView } from './editor-view';
import { game, keysScheme } from './editor-fixture';

const checksOf = (scheme: Scheme, g = helldivers2, mode = 'default') =>
  editorView({ scheme, game: g, plan: resolve(scheme, g, BUILT_IN_DEVICES), mode }).checks;

const said = (item: CheckItem) =>
  item.kind === 'group' ? `${item.subject}${item.rest}` : item.row.finding.rule;

describe('groupChecks', () => {
  // A blank key scheme on Helldivers 2: six required actions on no button (four of them movement)
  // and two sticks sending nothing.
  const blank = checksOf(blankKeysScheme(helldivers2));

  it('says the four movement actions as one line, and leaves the others their own', () => {
    expect(blank.map(said)).toEqual([
      "4 movement actions aren't on a button.",
      'missing-required',
      'missing-required',
      'stick-no-directions',
      'stick-no-directions',
    ]);
  });

  it('keeps every finding of the group, to open and see each', () => {
    const group = blank[0];
    expect(group?.kind === 'group' ? group.rows.map((r) => r.finding.action) : []).toEqual([
      'move_forward',
      'move_back',
      'strafe_left',
      'strafe_right',
    ]);
  });

  it('gives the group one fix that puts every one of them on a button', () => {
    const group = blank[0];
    const fix = group?.kind === 'group' ? group.fix : undefined;
    const after = fix?.apply(blankKeysScheme(helldivers2)) ?? blankKeysScheme(helldivers2);
    expect({
      label: fix?.label,
      keep: group?.kind === 'group' && group.canKeep,
      left: checksOf(after).map(said),
    }).toEqual({
      label: 'Put them on buttons',
      keep: true,
      left: ['missing-required', 'missing-required', 'stick-no-directions', 'stick-no-directions'],
    });
  });

  it('names the mode in a game with several', () => {
    const scheme: Scheme = { ...keysScheme(), map: { ship: {}, srv: {} } };
    const twoRequired = {
      ...game,
      actions: game.actions.map((a) => (a.id === 'gear' ? { ...a, required: true } : a)),
    };
    expect(checksOf(scheme, twoRequired, 'ship').map(said)).toContain(
      "2 travel actions aren't on a button in Ship.",
    );
  });

  it('leaves a lone finding of a role as a row of its own', () => {
    const rows = checksOf(blankKeysScheme(helldivers2)).flatMap((item) =>
      item.kind === 'group' ? item.rows : [item.row],
    );
    const fire = rows.filter((r) => r.finding.action === 'fire_primary');
    expect(groupChecks(fire, helldivers2).map((i) => i.kind)).toEqual(['row']);
  });
});

describe('the group’s fix, through the gate', () => {
  // 16 required actions on every Xbox control a button may send, and two more on none.
  const PADS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'BACK', 'START', 'LS', 'RS'] as const;
  const DPAD = ['DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT'] as const;
  const crowded = {
    id: 'crowded',
    name: 'Crowded',
    modes: [{ id: 'default', name: 'Default' }],
    actions: [...PADS, ...DPAD, null, null].map((pad, i) => ({
      id: `a${i}`,
      name: `Action ${i}`,
      mode: 'default',
      role: 'combat' as const,
      required: true,
      native: {
        key: { kind: 'key' as const, code: 'ABCDEFGHIJKLMNOPQR'.charAt(i) as 'A' },
        ...(pad === null ? {} : { pad }),
      },
    })),
  };
  const groupOf = (scheme: Scheme) =>
    checksOf(scheme, crowded).find((i): i is CheckGroup => i.kind === 'group');

  it('offers none when every controller button is in use', () => {
    const group = groupOf(xboxControllerPreset(crowded));
    expect([group?.rows.length, group?.fix]).toEqual([2, undefined]);
  });

  it('offers none when its fixes, one after another, would leave one of them', () => {
    // One button freed (its own action, a5, joins the two): each could go on it, but not all.
    const freed = clear(xboxControllerPreset(crowded), {
      mode: 'default',
      control: 'L.index_1',
      press: 'tap',
    });
    const group = groupOf(freed);
    expect([group?.rows.map((r) => r.fix?.label), group?.fix]).toEqual([
      ['Put it on a button', 'Put it on a button', 'Put it on a button'],
      undefined,
    ]);
  });
});
