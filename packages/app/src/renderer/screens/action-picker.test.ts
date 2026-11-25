import { describe, expect, it } from 'vitest';
import type { Game, Press, Scheme } from '@helmarray/core';
import { AZERONS_ONLY, gameKeysPreset, helldivers2 } from '@helmarray/core';
import { assign, setKeyLabel } from './editor-model';
import { editorView } from './editor-view';
import {
  matchRank,
  PICKER_START,
  nextRole,
  openPicker,
  pickerReducer,
  pickerKey,
  pickerSource,
  pickerView,
  stepActive,
} from './action-picker';
import type { PickerSource, RoleFilter } from './action-picker';
import { HOSTILE_IDS, game, keysScheme, plan } from './editor-fixture';

/** The picker's source for a control selected in a mode, at a press. */
const sourceOf = (
  scheme: Scheme,
  selected: string,
  mode = 'ship',
  press: Press = 'tap',
  g: Game = game,
): PickerSource => {
  const v = editorView({ scheme, game: g, plan: plan(scheme, g), mode, selected, press });
  const source = pickerSource(v, scheme, g, mode);
  if (source === null) throw new Error('no picker for this control');
  return source;
};
const names = (source: PickerSource, query = '', role: RoleFilter = 'all') =>
  pickerView(source, query, role, null).rows.map((r) => r.name);
const titled = (source: PickerSource, query = '', role: RoleFilter = 'all') =>
  pickerView(source, query, role, null).groups.map((g) => [g.title, g.rows.map((r) => r.name)]);
/** The game with Landing gear's role taken away: an action just added has none (#98). */
const roleless: Game = {
  ...game,
  actions: game.actions.map((a) =>
    a.id === 'gear' ? { id: a.id, name: a.name, mode: a.mode, required: a.required } : a,
  ),
};
const MOVES = ['Move forward', 'Move back', 'Strafe left', 'Strafe right'];
const withKeyboard = (scheme: Scheme): Scheme => ({
  ...scheme,
  devices: { ...AZERONS_ONLY, keyboard: true, mouse: true },
});

describe('matchRank: how well a search matches a name', () => {
  it('matches the whole name before its start, a word start, then anywhere', () => {
    expect([
      matchRank('frame shift drive', 'Frame shift drive'),
      matchRank('fra', 'Frame shift drive'),
      matchRank('dri', 'Frame shift drive'),
      matchRank('ift', 'Frame shift drive'),
    ]).toEqual([0, 1, 2, 3]);
  });

  it('ignores case', () => {
    expect([matchRank('BOOST', 'boost'), matchRank('gal', 'Galaxy map')]).toEqual([0, 1]);
  });

  it('takes partial words in any order, each matching some word', () => {
    expect([
      matchRank('fra dri', 'Frame shift drive'),
      matchRank('drive fra', 'Frame shift drive'),
      matchRank('sh  dr', 'Frame shift drive'),
    ]).toEqual([2, 2, 2]);
  });

  it('matches words split by punctuation, and words found inside others', () => {
    expect([
      matchRank('sys', 'Pips: SYS'),
      matchRank('hift riv', 'Frame shift drive'),
      matchRank('srv', 'Fire (SRV)'),
    ]).toEqual([2, 3, 2]);
  });

  it('finds nothing when one word is not there', () => {
    expect([matchRank('fra jump', 'Frame shift drive'), matchRank('zz', 'Boost')]).toEqual([
      null,
      null,
    ]);
  });

  it('matches everything for an empty search, or one of spaces', () => {
    expect([matchRank('', 'Boost'), matchRank('   ', 'Boost')]).toEqual([0, 0]);
  });

  it('matches a search of punctuation alone by the characters themselves', () => {
    expect([matchRank('%', 'Throttle 100%'), matchRank('%', 'Boost')]).toEqual([3, null]);
  });
});

describe('pickerSource: what the picker offers for the selected press', () => {
  it('is null with nothing selected, or a stick selected', () => {
    const scheme = keysScheme();
    const none = editorView({ scheme, game, plan: plan(scheme), mode: 'ship' });
    const stick = editorView({
      scheme,
      game,
      plan: plan(scheme),
      mode: 'ship',
      selected: 'L.stick',
    });
    expect([
      pickerSource(none, scheme, game, 'ship'),
      pickerSource(stick, scheme, game, 'ship'),
    ]).toEqual([null, null]);
  });

  it('puts the actions on no button first, then those on another button with where', () => {
    // Ship: Boost on L index 1, FSD on L middle 1, Fire on R index 1; L index 2 selected, empty.
    expect(titled(sourceOf(keysScheme(), 'L.index_2'))).toEqual([
      ['Not on a button', ['Galaxy map', 'Hardpoints', 'Landing gear', 'Silent running']],
      ['Already on a button · picking moves it here', ['Boost', 'Fire', 'Frame shift drive']],
    ]);
  });

  it('says where each placed one is', () => {
    const rows = pickerView(sourceOf(keysScheme(), 'L.index_2'), '', 'all', null).rows;
    expect(rows.filter((r) => r.group === 'placed').map((r) => r.where)).toEqual([
      'Left · Index 1',
      'Right · Index 1',
      'Left · Middle 1',
    ]);
  });

  it('leaves out the action already on the press being chosen', () => {
    // L index 1 holds Boost on its tap: picking Boost there would change nothing.
    expect(names(sourceOf(keysScheme(), 'L.index_1'))).not.toContain('Boost');
  });

  it('offers the action on another press of the same button, to move it here', () => {
    const scheme = assign(
      keysScheme(),
      { mode: 'ship', control: 'L.index_1', press: 'long' },
      'galaxy',
      game,
    );
    const rows = pickerView(sourceOf(scheme, 'L.index_1'), 'gal', 'all', null).rows;
    expect(rows.map((r) => [r.name, r.group, r.where])).toEqual([
      ['Galaxy map', 'placed', 'Long on this button'],
    ]);
  });

  it('offers the tap’s action from the long press, to move it there', () => {
    const rows = pickerView(
      sourceOf(keysScheme(), 'L.index_1', 'ship', 'long'),
      'boo',
      'all',
      null,
    ).rows;
    expect(rows.map((r) => [r.name, r.where])).toEqual([['Boost', 'Tap on this button']]);
  });

  it('lists every action of the mode once, but the one already here', () => {
    const source = sourceOf(keysScheme(), 'L.index_1');
    const listed = source.candidates.map((c) => c.id).sort();
    const inMode = game.actions
      .filter((a) => a.mode === 'ship' && a.id !== 'boost')
      .map((a) => a.id);
    expect(listed).toEqual(inMode.sort());
  });

  it('offers the mode shown: SRV’s actions in SRV', () => {
    expect(names(sourceOf(keysScheme(), 'L.index_2', 'srv'))).toEqual([
      'SRV lights',
      'Fire (SRV)',
      'Jump',
    ]);
  });

  it('keeps a stick’s actions apart: picking one puts it here too, it moves nothing', () => {
    const scheme = gameKeysPreset(helldivers2);
    const rows = pickerView(
      sourceOf(scheme, 'L.index_1', 'default', 'tap', helldivers2),
      '',
      'all',
      null,
    );
    const stick = rows.groups.find((g) => g.id === 'stick');
    expect([stick?.title, stick?.rows.map((r) => [r.name, r.where])]).toEqual([
      'On the stick · picking puts it here too',
      MOVES.map((n) => [n, 'Left · Stick']),
    ]);
  });
});

describe('the words: the selected control’s own', () => {
  it('a key on the keyboard', () => {
    const titles = titled(sourceOf(withKeyboard(keysScheme()), 'key.Q')).map(([t]) => t);
    expect(titles).toEqual(['Not on a key', 'Already on a key · picking moves it here']);
  });

  it('a mouse button', () => {
    const titles = titled(sourceOf(withKeyboard(keysScheme()), 'mouse.middle')).map(([t]) => t);
    expect(titles[0]).toBe('Not on a mouse button');
  });

  it('a unit’s button', () => {
    expect(titled(sourceOf(keysScheme(), 'L.index_2'))[0]?.[0]).toBe('Not on a button');
  });
});

describe('pickerView: the search and the role filter', () => {
  const source = () => sourceOf(keysScheme(), 'L.index_2');

  it('filters by name across both groups, best match first in each', () => {
    // "s": Silent running starts with it, Hardpoints ends with it; Frame shift drive has a word
    // starting with it, Boost has it inside.
    expect(titled(source(), 's')).toEqual([
      ['Not on a button', ['Silent running', 'Hardpoints']],
      ['Already on a button · picking moves it here', ['Frame shift drive', 'Boost']],
    ]);
  });

  it('ranks the name’s start, then a word’s, then inside a word', () => {
    expect(names(source(), 'g')).toEqual(['Galaxy map', 'Landing gear', 'Silent running']);
  });

  it('ranks a word start above a match inside, and keeps the game’s order between equals', () => {
    // Silent running comes after Hardpoints and Landing gear in the game.
    expect(names(source(), 'r')).toEqual([
      'Silent running',
      'Hardpoints',
      'Landing gear',
      'Fire',
      'Frame shift drive',
    ]);
  });

  it('matches the key label the player gave the action', () => {
    const scheme = setKeyLabel(keysScheme(), 'ship', 'L.middle_1', 'Jump!');
    const rows = pickerView(sourceOf(scheme, 'L.index_2'), 'jum', 'all', null).rows;
    expect(rows.map((r) => [r.name, r.label])).toEqual([['Frame shift drive', 'Jump!']]);
  });

  it('ranks a name match above a key label match of the same strength', () => {
    // Boost comes before Fire in the game; its label only starts with the search, Fire's name too.
    const scheme = setKeyLabel(keysScheme(), 'ship', 'L.index_1', 'Firestorm');
    expect(names(sourceOf(scheme, 'L.index_2'), 'fir')).toEqual(['Fire', 'Boost']);
  });

  it('filters by role', () => {
    expect(names(source(), '', 'combat')).toEqual(['Hardpoints', 'Fire']);
  });

  it('filters by role and search together', () => {
    expect(names(source(), 'fi', 'combat')).toEqual(['Fire']);
  });

  it('offers All, each role, and No role only when an action has none', () => {
    const plain = pickerView(source(), '', 'all', null).filters.map((f) => f.name);
    const withNone = pickerView(
      sourceOf(keysScheme(), 'L.index_2', 'ship', 'tap', roleless),
      '',
      'none',
      null,
    );
    expect([plain, withNone.filters.map((f) => f.name), withNone.rows.map((r) => r.name)]).toEqual([
      ['All', 'Combat', 'Movement', 'Ability', 'Travel', 'Menu'],
      ['All', 'Combat', 'Movement', 'Ability', 'Travel', 'Menu', 'No role'],
      ['Landing gear'],
    ]);
  });

  it('marks the filter in use as pressed', () => {
    const filters = pickerView(source(), '', 'travel', null).filters;
    expect(filters.filter((f) => f.pressed).map((f) => f.id)).toEqual(['travel']);
  });

  it('counts each group, and what is shown of all', () => {
    const all = pickerView(source(), '', 'all', null);
    const some = pickerView(source(), 's', 'all', 'Ship');
    expect([all.groups.map((g) => g.rows.length), all.count, some.count]).toEqual([
      [4, 3],
      '7 actions',
      '4 of 7 Ship actions',
    ]);
  });

  it('says so when nothing matches, and offers no group', () => {
    const none = pickerView(source(), 'zzz', 'all', null);
    const noneInRole = pickerView(source(), 'boo', 'menu', null);
    expect([none.groups, none.empty, noneInRole.empty]).toEqual([
      [],
      'Nothing matches “zzz”.',
      'Nothing matches “boo” in Menu.',
    ]);
  });

  it('says so when a role has nothing, with no search', () => {
    const only = sourceOf(keysScheme(), 'L.index_2', 'srv', 'tap', roleless);
    expect([
      pickerView(only, '', 'travel', null).empty,
      pickerView(only, '', 'none', null).empty,
    ]).toEqual(['No Travel actions here.', 'No actions without a role here.']);
  });

  it('has no empty line while something is shown', () => {
    expect(pickerView(source(), '', 'all', null).empty).toBeNull();
  });

  it('names the mode in the search field, for a game with modes', () => {
    expect([
      pickerView(source(), '', 'all', 'Ship').placeholder,
      pickerView(source(), '', 'all', null).placeholder,
    ]).toEqual(['Search Ship actions', 'Search actions']);
  });

  it('keeps hostile action ids and key labels as entries', () => {
    const hostile: Game = {
      ...game,
      actions: game.actions.map((a, i) => ({ ...a, id: HOSTILE_IDS[i] ?? a.id })),
    };
    const scheme: Scheme = {
      ...keysScheme(),
      map: { ship: { 'L.index_1': { tap: '__proto__' } }, srv: {} },
      keyLabels: { ship: { 'L.index_1': 'Proto' } },
    };
    const rows = pickerView(
      sourceOf(scheme, 'L.index_2', 'ship', 'tap', hostile),
      'proto',
      'all',
      null,
    ).rows;
    expect(rows.map((r) => [r.id, r.label])).toEqual([['__proto__', 'Proto']]);
  });
});

describe('stepActive: the arrow keys through the results', () => {
  it('moves down and up, and stops at the ends', () => {
    expect([
      stepActive(0, 'ArrowDown', 3),
      stepActive(2, 'ArrowDown', 3),
      stepActive(1, 'ArrowUp', 3),
      stepActive(0, 'ArrowUp', 3),
    ]).toEqual([1, 2, 0, 0]);
  });

  it('leaves other keys alone: Home and End move in the search field', () => {
    expect([
      stepActive(1, 'a', 3),
      stepActive(1, 'Enter', 3),
      stepActive(1, 'Home', 3),
      stepActive(1, 'End', 3),
    ]).toEqual([null, null, null, null]);
  });

  it('stays at 0 with no results', () => {
    expect([stepActive(0, 'ArrowDown', 0), stepActive(0, 'ArrowUp', 0)]).toEqual([0, 0]);
  });
});

describe('pickerKey: what a key does in the picker', () => {
  it('Esc closes it from anywhere in it', () => {
    expect([pickerKey('Escape', true, 0, 3), pickerKey('Escape', false, 0, 3)]).toEqual([
      { kind: 'close' },
      { kind: 'close' },
    ]);
  });

  it('Enter picks the one shown, from the search', () => {
    expect(pickerKey('Enter', true, 1, 3)).toEqual({ kind: 'pick' });
  });

  it('Enter picks nothing when nothing is shown', () => {
    expect(pickerKey('Enter', true, 0, 0)).toBeNull();
  });

  it('the arrows move from the search', () => {
    expect([pickerKey('ArrowDown', true, 1, 3), pickerKey('ArrowUp', true, 1, 3)]).toEqual([
      { kind: 'move', to: 2 },
      { kind: 'move', to: 0 },
    ]);
  });

  it('leaves Enter and the arrows to a chip or Close with the focus', () => {
    expect([pickerKey('Enter', false, 0, 3), pickerKey('ArrowDown', false, 0, 3)]).toEqual([
      null,
      null,
    ]);
  });

  it('leaves typing alone', () => {
    expect(pickerKey('a', true, 0, 3)).toBeNull();
  });
});

describe('nextRole: a chip pressed', () => {
  it('picks its role', () => {
    expect(nextRole('all', 'combat')).toBe('combat');
  });

  it('pressed again, shows every role', () => {
    expect([nextRole('combat', 'combat'), nextRole('none', 'none')]).toEqual(['all', 'all']);
  });

  it('All stays All', () => {
    expect(nextRole('all', 'all')).toBe('all');
  });
});

describe('openPicker: whether the picker shows', () => {
  const now = {
    inspector: true,
    selected: 'L.index_2',
    panel: 'L.index_2',
    target: 'tap' as Press,
  };
  const picking = { control: 'L.index_2', press: 'tap' as Press };

  it('shows while its control and press are the ones selected', () => {
    expect(openPicker(picking, now)).toBe(picking);
  });

  it('is shut with nothing asked for', () => {
    expect(openPicker(null, now)).toBeNull();
  });

  it('shuts when the selection moves, the press changes, the panel goes or is hidden', () => {
    expect([
      openPicker(picking, { ...now, selected: 'L.index_3', panel: 'L.index_3' }),
      openPicker(picking, { ...now, target: 'long' }),
      openPicker(picking, { ...now, panel: undefined }),
      openPicker(picking, { ...now, inspector: false }),
    ]).toEqual([null, null, null, null]);
  });
});

describe('pickerReducer: the search, the role and the result shown', () => {
  it('starts with no search, every role, the first result', () => {
    expect(PICKER_START).toEqual({ query: '', role: 'all', active: 0 });
  });

  it('a search typed goes back to the first result', () => {
    expect(pickerReducer({ ...PICKER_START, active: 3 }, { type: 'query', text: 'gal' })).toEqual({
      query: 'gal',
      role: 'all',
      active: 0,
    });
  });

  it('a chip sets its role, or every role when pressed again, and goes back to the first', () => {
    const combat = pickerReducer({ ...PICKER_START, active: 2 }, { type: 'role', chip: 'combat' });
    expect([combat, pickerReducer(combat, { type: 'role', chip: 'combat' })]).toEqual([
      { query: '', role: 'combat', active: 0 },
      { query: '', role: 'all', active: 0 },
    ]);
  });

  it('an arrow moves to the result it gives', () => {
    expect(pickerReducer({ ...PICKER_START, query: 'g' }, { type: 'move', to: 2 })).toEqual({
      query: 'g',
      role: 'all',
      active: 2,
    });
  });
});
