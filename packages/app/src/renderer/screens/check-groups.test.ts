// Repeated findings, grouped by role: "4 movement actions aren't on a button".
import { describe, expect, it } from 'vitest';
import type { Scheme } from '@helmarray/core';
import { BUILT_IN_DEVICES, blankKeysScheme, helldivers2, resolve } from '@helmarray/core';
import { groupChecks } from './check-groups';
import type { CheckItem } from './check-groups';
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
