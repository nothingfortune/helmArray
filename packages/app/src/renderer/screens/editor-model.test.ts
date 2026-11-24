import { afterEach, describe, expect, it } from 'vitest';
import type { Finding, Game, Scheme, SetupDevices } from '@helmarray/core';
import {
  AZERONS_ONLY,
  BUILT_IN_DEVICES,
  CYBORG2_LEFT,
  CYBORG2_RIGHT,
  DEFAULT_TURBO_INTERVAL,
  PAD_CONTROLS,
  helldivers2,
  inSetup,
  own,
  padSignalOf,
  setupOf,
  resolve,
  xboxControllerPreset,
} from '@helmarray/core';
import {
  HISTORY_LIMIT,
  KEPT_REASON,
  KEY_LABEL_LIMIT,
  followLabels,
  keyLabelOf,
  setKeyLabel,
  acceptFinding,
  adoptLedger,
  actionAt,
  assign,
  canRedo,
  canUndo,
  chooseAzerons,
  chooseController,
  chooseKeyboard,
  clear,
  commit,
  drop,
  fixFor,
  historyAction,
  hasDevices,
  historyShortcut,
  isAcceptable,
  isTextEntry,
  move,
  isStick,
  redo,
  renameScheme,
  setDevices,
  setLatch,
  setOutput,
  setPadControl,
  setTurbo,
  shownAction,
  shownPresses,
  startHistory,
  unacceptFinding,
  undo,
} from './editor-model';
import type { Slot } from './editor-model';
import {
  deepFreeze,
  game,
  hostileGame,
  hostileOneMode,
  keysScheme,
  padGame,
  padScheme,
  plan,
} from './editor-fixture';

const slot = (mode: string, control: string, press: Slot['press'] = 'tap'): Slot => ({
  mode,
  control,
  press,
});
const frozen = (): Scheme => deepFreeze(keysScheme());

describe('assign', () => {
  it('puts an action on a free button, in the current mode only', () => {
    const next = assign(frozen(), slot('ship', 'L.index_2'), 'gear', game);
    expect(next.map['ship']?.['L.index_2']).toEqual({ tap: 'gear' });
    expect(next.map['srv']).toEqual(keysScheme().map['srv']);
  });

  it('replaces what the slot held; the old action is simply unplaced', () => {
    const next = assign(frozen(), slot('ship', 'L.index_1'), 'galaxy', game);
    expect(actionAt(next, slot('ship', 'L.index_1'))).toBe('galaxy');
    expect(JSON.stringify(next.map['ship'])).not.toContain('boost');
  });

  it('is a move: the action leaves the slot it was on in this mode', () => {
    const next = assign(frozen(), slot('ship', 'R.index_2'), 'boost', game);
    expect(actionAt(next, slot('ship', 'R.index_2'))).toBe('boost');
    expect(next.map['ship']?.['L.index_1']).toBeUndefined();
  });

  it('puts an action on a long press or a double tap without touching the tap', () => {
    const a = assign(frozen(), slot('ship', 'L.index_1', 'long'), 'galaxy', game);
    const b = assign(a, slot('ship', 'L.index_1', 'double'), 'gear', game);
    expect(b.map['ship']?.['L.index_1']).toEqual({ tap: 'boost', long: 'galaxy', double: 'gear' });
  });

  it('keeps a press per mode: the same button holds different actions in each', () => {
    const next = assign(frozen(), slot('srv', 'L.middle_1'), 'lights', game);
    expect(next.map['srv']?.['L.middle_1']).toEqual({ tap: 'lights' });
    expect(next.map['ship']?.['L.middle_1']).toEqual({ tap: 'fsd' });
  });

  it('creates a mode that has no map yet', () => {
    const scheme = frozen();
    const rest = Object.fromEntries(Object.entries(scheme.map).filter(([mode]) => mode !== 'srv'));
    const bare = deepFreeze({ ...scheme, map: rest });
    expect(assign(bare, slot('srv', 'L.index_1'), 'jump', game).map['srv']).toEqual({
      'L.index_1': { tap: 'jump' },
    });
  });

  it('returns the same scheme when nothing changes', () => {
    const scheme = frozen();
    expect(assign(scheme, slot('ship', 'L.index_1'), 'boost', game)).toBe(scheme);
  });

  it('refuses the stick: it has directions, not presses', () => {
    const scheme = frozen();
    expect(assign(scheme, slot('ship', 'L.stick'), 'boost', game)).toBe(scheme);
    expect(assign(scheme, slot('ship', 'R.stick'), 'boost', game)).toBe(scheme);
  });

  it('never touches the ledger: a key once given stays given', () => {
    const ledger = { 'L.index_1': { tap: { kind: 'key', code: 'Insert' } } } as const;
    const scheme = deepFreeze({ ...keysScheme(), ledger });
    const next = clear(
      assign(scheme, slot('ship', 'L.index_2'), 'boost', game),
      slot('ship', 'L.index_2'),
    );
    expect(next.ledger).toBe(scheme.ledger);
  });
});

describe('a press the control can’t send', () => {
  it('is refused on an Azeron button with controller output, and on a key', () => {
    const pad = deepFreeze(padScheme());
    const kbm = deepFreeze({
      ...keysScheme(),
      devices: { ...AZERONS_ONLY, keyboard: true, mouse: true },
    });
    expect([
      assign(pad, slot('ship', 'L.index_1', 'long'), 'gear', padGame) === pad,
      assign(pad, slot('ship', 'L.index_1', 'double'), 'gear', padGame) === pad,
      assign(kbm, slot('ship', 'key.J', 'long'), 'gear', game) === kbm,
      assign(kbm, slot('ship', 'L.index_1', 'long'), 'gear', game).map['ship']?.['L.index_1'],
    ]).toEqual([true, true, true, { tap: 'boost', long: 'gear' }]);
  });

  it('is refused on a control of a device the setup doesn’t have (an undo can take it away)', () => {
    const scheme = frozen();
    expect([
      assign(scheme, slot('ship', 'key.J', 'tap'), 'gear', game) === scheme,
      assign(
        { ...scheme, devices: { ...AZERONS_ONLY, azerons: 'left' } },
        slot('ship', 'R.index_2'),
        'gear',
        game,
      ).map['ship']?.['R.index_2'],
    ]).toEqual([true, undefined]);
  });

  it('is never moved onto: the action stays where it was', () => {
    const pad = deepFreeze(padScheme());
    expect(move(pad, slot('ship', 'L.index_1'), slot('ship', 'L.index_2', 'long'), padGame)).toBe(
      pad,
    );
  });
});

describe('drop: an action dropped on a button', () => {
  it('from the list goes on the tap', () => {
    const next = drop(frozen(), 'ship', 'L.index_2', 'gear', undefined, game);
    expect(next.map['ship']?.['L.index_2']).toEqual({ tap: 'gear' });
  });

  it('dragged off a long press, moves from that long press to the tap', () => {
    const scheme = deepFreeze(
      assign(keysScheme(), slot('ship', 'L.index_2', 'long'), 'gear', game),
    );
    const next = drop(
      scheme,
      'ship',
      'L.index_3',
      'gear',
      { control: 'L.index_2', press: 'long' },
      game,
    );
    expect([next.map['ship']?.['L.index_2'], next.map['ship']?.['L.index_3']]).toEqual([
      undefined,
      { tap: 'gear' },
    ]);
  });

  it('dragged off a double tap the same way', () => {
    const scheme = deepFreeze(
      assign(keysScheme(), slot('ship', 'L.index_2', 'double'), 'gear', game),
    );
    const next = drop(
      scheme,
      'ship',
      'L.index_3',
      'gear',
      { control: 'L.index_2', press: 'double' },
      game,
    );
    expect(next.map['ship']?.['L.index_3']).toEqual({ tap: 'gear' });
  });

  it('refuses the stick and an action of another mode', () => {
    const scheme = frozen();
    expect([
      drop(scheme, 'ship', 'L.stick', 'gear', undefined, game) === scheme,
      drop(scheme, 'ship', 'L.index_2', 'jump', undefined, game) === scheme,
    ]).toEqual([true, true]);
  });
});

describe('clear', () => {
  it('takes one press off and leaves the others', () => {
    const withLong = assign(frozen(), slot('ship', 'L.index_1', 'long'), 'galaxy', game);
    const next = clear(withLong, slot('ship', 'L.index_1', 'long'));
    expect(next.map['ship']?.['L.index_1']).toEqual({ tap: 'boost' });
  });

  it('drops a button left with no press, so nothing is left behind', () => {
    const next = clear(frozen(), slot('ship', 'L.index_1'));
    expect('L.index_1' in (next.map['ship'] ?? {})).toBe(false);
  });

  it('only touches the current mode', () => {
    const next = clear(frozen(), slot('ship', 'L.index_1'));
    expect(next.map['srv']?.['L.index_1']).toEqual({ tap: 'jump' });
  });

  it('returns the same scheme for a slot that is already empty', () => {
    const scheme = frozen();
    expect(clear(scheme, slot('ship', 'L.index_5'))).toBe(scheme);
    expect(clear(scheme, slot('ship', 'L.index_1', 'long'))).toBe(scheme);
    expect(clear(scheme, slot('nowhere', 'L.index_1'))).toBe(scheme);
  });
});

describe('move', () => {
  it('moves an action to another button and leaves the first empty', () => {
    const next = move(frozen(), slot('ship', 'L.index_1'), slot('ship', 'L.index_3'), game);
    expect(next.map['ship']?.['L.index_3']).toEqual({ tap: 'boost' });
    expect(next.map['ship']?.['L.index_1']).toBeUndefined();
  });

  it('moves between presses of one button', () => {
    const next = move(frozen(), slot('ship', 'L.index_1'), slot('ship', 'L.index_1', 'long'), game);
    expect(next.map['ship']?.['L.index_1']).toEqual({ long: 'boost' });
  });

  it('drops what was on the target', () => {
    const next = move(frozen(), slot('ship', 'L.index_1'), slot('ship', 'L.middle_1'), game);
    expect(next.map['ship']?.['L.middle_1']).toEqual({ tap: 'boost' });
    expect(JSON.stringify(next.map['ship'])).not.toContain('fsd');
  });

  it('does nothing from an empty slot, onto itself, across modes or onto the stick', () => {
    const scheme = frozen();
    expect(move(scheme, slot('ship', 'L.index_5'), slot('ship', 'L.index_3'), game)).toBe(scheme);
    expect(move(scheme, slot('ship', 'L.index_1'), slot('ship', 'L.index_1'), game)).toBe(scheme);
    expect(move(scheme, slot('ship', 'L.index_1'), slot('srv', 'L.index_3'), game)).toBe(scheme);
    expect(move(scheme, slot('ship', 'L.index_1'), slot('ship', 'L.stick'), game)).toBe(scheme);
  });
});

describe('turbo and latch', () => {
  it('turns turbo on at the unit default rate and off again, leaving nothing behind', () => {
    const on = setTurbo(frozen(), 'R.index_1', true);
    expect(on.behaviour['R.index_1']).toEqual({ turbo: { interval: DEFAULT_TURBO_INTERVAL } });
    const off = setTurbo(on, 'R.index_1', false);
    expect('R.index_1' in off.behaviour).toBe(false);
  });

  it('keeps a turbo rate the player already set', () => {
    const scheme = deepFreeze({
      ...keysScheme(),
      behaviour: { 'R.index_1': { turbo: { interval: 50 } } },
    });
    expect(setTurbo(scheme, 'R.index_1', true)).toBe(scheme);
  });

  it('turns latch on and off', () => {
    const on = setLatch(frozen(), 'L.index_1', true);
    expect(on.behaviour['L.index_1']).toEqual({ latch: true });
    expect('L.index_1' in setLatch(on, 'L.index_1', false).behaviour).toBe(false);
  });

  it('keeps one setting when the other changes', () => {
    const both = setLatch(setTurbo(frozen(), 'L.index_1', true), 'L.index_1', true);
    const next = setTurbo(both, 'L.index_1', false);
    expect(next.behaviour['L.index_1']).toEqual({ latch: true });
  });

  it('returns the same scheme when the setting is already so', () => {
    const scheme = frozen();
    expect(setLatch(scheme, 'L.index_1', false)).toBe(scheme);
    expect(setTurbo(scheme, 'L.index_1', false)).toBe(scheme);
  });

  it('leaves the stick behaviour alone', () => {
    const scheme = deepFreeze(padScheme());
    expect(setLatch(scheme, 'L.stick', true)).toBe(scheme);
    expect(setTurbo(scheme, 'L.stick', true)).toBe(scheme);
  });
});

describe('accepted findings', () => {
  const hold: Finding = {
    rule: 'hold-on-movement',
    severity: 'warning',
    control: 'L.index_1',
    message: 'x',
  };
  const missing: Finding = {
    rule: 'missing-required',
    severity: 'error',
    action: 'fsd',
    mode: 'ship',
    message: 'x',
  };

  it('adds a finding about a control with its control and a reason', () => {
    expect(acceptFinding(frozen(), hold).accepted).toEqual([
      { rule: 'hold-on-movement', control: 'L.index_1', reason: KEPT_REASON },
    ]);
  });

  it('names the action, and no control, for a finding about an action', () => {
    expect(acceptFinding(frozen(), missing).accepted).toEqual([
      { rule: 'missing-required', action: 'fsd', reason: KEPT_REASON },
    ]);
  });

  it('is matched by the checks on the next run, so the finding comes back marked', () => {
    const latched = setLatch(keysScheme(), 'L.index_1', true);
    const found = plan(latched).findings.find((f) => f.rule === 'hold-on-movement');
    expect(found?.accepted).toBeUndefined();
    const kept = acceptFinding(latched, found as Finding);
    expect(plan(kept).findings.find((f) => f.rule === 'hold-on-movement')?.accepted).toBe(
      KEPT_REASON,
    );
  });

  it('does not add one twice', () => {
    const once = acceptFinding(frozen(), hold);
    expect(acceptFinding(once, hold)).toBe(once);
  });

  it('flags a kept finding again', () => {
    const kept = acceptFinding(frozen(), hold);
    expect(unacceptFinding(kept, hold).accepted).toEqual([]);
    const scheme = frozen();
    expect(unacceptFinding(scheme, hold)).toBe(scheme);
  });

  it("only keeps what the checks found, never the resolver's own findings", () => {
    const resolver: Finding = { rule: 'pool-spent', severity: 'error', message: 'x' };
    const scheme = frozen();
    expect(isAcceptable(resolver)).toBe(false);
    expect(isAcceptable(hold)).toBe(true);
    expect(acceptFinding(scheme, resolver)).toBe(scheme);
  });
});

describe('fixes', () => {
  const find = (scheme: Scheme, rule: string) => plan(scheme).findings.find((f) => f.rule === rule);
  const fixed = (scheme: Scheme, rule: string): { before: Finding; after: Scheme } => {
    const before = find(scheme, rule);
    if (!before) throw new Error(`no ${rule} finding to fix`);
    const fix = fixFor(before, scheme, game, plan(scheme));
    if (!fix) throw new Error(`no fix for ${rule}`);
    return { before, after: fix.apply(scheme) };
  };

  it('latch on a movement button: turn latch off', () => {
    const scheme = deepFreeze(setLatch(keysScheme(), 'L.index_1', true));
    const { after } = fixed(scheme, 'hold-on-movement');
    expect(find(after, 'hold-on-movement')).toBeUndefined();
  });

  it('a long press on a combat button: remove the long press, in every mode', () => {
    const scheme = deepFreeze(
      assign(keysScheme(), slot('ship', 'R.index_1', 'long'), 'hardpoints', game),
    );
    const before = find(scheme, 'combat-tap-delayed') as Finding;
    const fix = fixFor(before, scheme, game, plan(scheme));
    expect(fix?.label).toBe('Remove long press');
    const after = (fix as NonNullable<typeof fix>).apply(scheme);
    expect(find(after, 'combat-tap-delayed')).toBeUndefined();
    expect(after.map['ship']?.['R.index_1']).toEqual({ tap: 'fire' });
  });

  it('names both presses when both are there', () => {
    let scheme = assign(keysScheme(), slot('ship', 'R.index_1', 'long'), 'hardpoints', game);
    scheme = assign(scheme, slot('ship', 'R.index_1', 'double'), 'gear', game);
    const before = find(scheme, 'combat-tap-delayed') as Finding;
    expect(fixFor(before, scheme, game, plan(scheme))?.label).toBe(
      'Remove long press and double tap',
    );
  });

  it('a menu action on a combat button: take the menu action off', () => {
    const scheme = deepFreeze(
      assign(keysScheme(), slot('ship', 'R.index_1', 'long'), 'galaxy', game),
    );
    const before = find(scheme, 'menu-with-combat') as Finding;
    const fix = fixFor(before, scheme, game, plan(scheme));
    expect(fix?.label).toBe('Take Galaxy map off');
    const after = (fix as NonNullable<typeof fix>).apply(scheme);
    expect(find(after, 'menu-with-combat')).toBeUndefined();
    expect(after.map['ship']?.['R.index_1']).toEqual({ tap: 'fire' });
  });

  it('an action on a press that sends nothing: take it off', () => {
    // The editor no longer puts one there; a scheme saved before can still have it.
    const scheme = deepFreeze({
      ...padScheme(),
      map: {
        ...padScheme().map,
        ship: { ...padScheme().map['ship'], 'L.index_1': { tap: 'boost', long: 'galaxy' } },
      },
    });
    const { after } = fixed(scheme, 'sends-nothing');
    expect(find(after, 'sends-nothing')).toBeUndefined();
    expect(after.map['ship']?.['L.index_1']).toEqual({ tap: 'boost' });
  });

  it('offers nothing where the player must choose', () => {
    const scheme = keysScheme();
    const missing = {
      rule: 'missing-required',
      severity: 'error',
      action: 'fsd',
      message: 'x',
    } as const;
    const collision = {
      rule: 'key-collision',
      severity: 'error',
      control: 'L.stick',
      message: 'x',
    } as const;
    expect(fixFor(missing, scheme, game, plan(scheme))).toBeUndefined();
    expect(fixFor(collision, scheme, game, plan(scheme))).toBeUndefined();
  });
});

describe('history', () => {
  const a = frozen();
  const b = assign(a, slot('ship', 'L.index_2'), 'gear', game);
  const c = assign(b, slot('ship', 'L.index_3'), 'silent', game);

  it('starts with nothing to undo or redo', () => {
    const h = startHistory(a);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('undoes and redoes edits in order', () => {
    const h = commit(commit(startHistory(a), b), c);
    expect(h.present).toBe(c);
    const u1 = undo(h);
    expect(u1.present).toBe(b);
    const u2 = undo(u1);
    expect(u2.present).toBe(a);
    expect(canUndo(u2)).toBe(false);
    expect(redo(u2).present).toBe(b);
    expect(redo(redo(u2)).present).toBe(c);
    expect(canRedo(redo(redo(u2)))).toBe(false);
  });

  it('forgets the redo stack when a new edit follows an undo', () => {
    const h = undo(commit(commit(startHistory(a), b), c));
    const d = assign(b, slot('ship', 'L.index_4'), 'hardpoints', game);
    const next = commit(h, d);
    expect(next.future).toEqual([]);
    expect(next.past).toEqual([a, b]);
    expect(canRedo(next)).toBe(false);
  });

  it('counts a no-op as no edit: same history, nothing to undo', () => {
    const h = startHistory(a);
    expect(commit(h, a)).toBe(h);
    expect(commit(h, assign(a, slot('ship', 'L.index_1'), 'boost', game))).toBe(h);
  });

  it('is kept per history object: undoing one never changes another', () => {
    const one = commit(startHistory(a), b);
    const two = commit(startHistory(a), c);
    undo(one);
    expect(two.present).toBe(c);
    expect(one.present).toBe(b);
  });

  it('keeps only the last HISTORY_LIMIT edits', () => {
    let h = startHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = commit(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(10);
    expect(h.present).toBe(HISTORY_LIMIT + 10);
  });
});

describe('no edit mutates its input', () => {
  it('survives a deeply frozen scheme through every edit', () => {
    const scheme = deepFreeze(padScheme());
    const finding: Finding = {
      rule: 'sends-nothing',
      severity: 'error',
      control: 'L.index_1',
      mode: 'ship',
      message: 'x',
    };
    expect(() => {
      let s = assign(scheme, slot('ship', 'L.index_2'), 'gear', game);
      s = assign(s, slot('ship', 'L.index_1', 'long'), 'galaxy', game);
      s = move(s, slot('ship', 'L.index_2'), slot('ship', 'L.index_3'), game);
      s = clear(s, slot('ship', 'L.index_3'));
      s = setTurbo(s, 'L.index_1', true);
      s = setLatch(s, 'L.index_1', true);
      s = acceptFinding(s, finding);
      unacceptFinding(s, finding);
    }).not.toThrow();
    expect(scheme).toEqual(padScheme());
  });
});

describe('historyShortcut', () => {
  const press = (
    key: string,
    mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {},
  ) => historyShortcut({ key, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

  it('undoes on Ctrl+Z, whatever the case the browser reports', () => {
    expect(press('z', { ctrlKey: true })).toBe('undo');
    expect(press('Z', { ctrlKey: true })).toBe('undo');
    expect(press('z', { metaKey: true })).toBe('undo');
  });

  it('redoes on Ctrl+Shift+Z, which reports a capital Z, and on Ctrl+Y', () => {
    expect(press('Z', { ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(press('z', { ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(press('y', { ctrlKey: true })).toBe('redo');
  });

  it('ignores everything else', () => {
    expect(press('z')).toBeNull();
    expect(press('a', { ctrlKey: true })).toBeNull();
    expect(press('z', { ctrlKey: true, altKey: true })).toBeNull();
    expect(press('y', { ctrlKey: true, shiftKey: true })).toBeNull();
  });
});

describe('adoptLedger', () => {
  const given = { 'L.index_1': { tap: { kind: 'key', code: 'Home' } } } as Scheme['ledger'];
  const with_ = (s: Scheme, ledger: Scheme['ledger']): Scheme => ({ ...s, ledger });

  it('gives the present, the past and the future the keys that were dealt, and changes no edit', () => {
    const a = with_(padScheme(), {});
    const b = { ...a, name: 'B' };
    const c = { ...a, name: 'C' };
    const next = adoptLedger({ past: [a], present: b, future: [c] }, given);
    expect(next.past[0]).toEqual({ ...a, ledger: given });
    expect(next.present).toEqual({ ...b, ledger: given });
    expect(next.future[0]).toEqual({ ...c, ledger: given });
    // Undo does not hand the older, keyless scheme back.
    expect(undo(next).present.ledger).toEqual(given);
  });

  it('is the same history when every scheme already has them: nothing to render, nothing to save', () => {
    const h = startHistory(with_(padScheme(), given));
    expect(adoptLedger(h, structuredClone(given))).toBe(h);
  });

  it('does not share the ledger it is given', () => {
    const next = adoptLedger(startHistory(with_(padScheme(), {})), given);
    expect(next.present.ledger).not.toBe(given);
  });
});

describe('historyAction', () => {
  const key = { key: 'z', ctrlKey: true, metaKey: false, shiftKey: false };

  it('is the shortcut while the editor owns the keyboard', () => {
    expect(historyAction(key, true)).toBe('undo');
    expect(historyAction({ ...key, key: 'y' }, true)).toBe('redo');
  });

  it('is nothing while something is over the editor, whatever the keys', () => {
    expect(historyAction(key, false)).toBeNull();
    expect(historyAction({ ...key, key: 'y' }, false)).toBeNull();
    expect(historyAction({ ...key, shiftKey: true }, false)).toBeNull();
  });
});

describe('isTextEntry', () => {
  it('is true where typing means something', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTextEntry({ tagName: 'input' })).toBe(true);
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'SELECT' })).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('is false on a ticked checkbox or a button, so undo still works after a click there', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextEntry({ tagName: 'INPUT', type: 'radio' })).toBe(false);
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextEntry({ tagName: 'DIV' })).toBe(false);
  });
});

describe('controller output: the pad rule', () => {
  const pinSends = (scheme: Scheme, control: string, g: Game = padGame) => {
    const p = plan(scheme, g);
    return [...(p.units.left?.pins ?? []), ...(p.units.right?.pins ?? [])].find(
      (x) => x.control === control,
    )?.presses.tap;
  };
  /** What the game's controller bindings put an action on, in a mode. */
  const boundTo = (scheme: Scheme, action: string, mode = 'ship', g: Game = padGame) =>
    plan(scheme, g)
      .gameBindings.filter((b) => b.set === 'controller' && b.mode === mode && b.action === action)
      .map((b) => b.signal);
  const pad = (control: string) => ({ kind: 'pad', control });
  const base = () => deepFreeze(padScheme());
  const withController = (scheme: Scheme): Scheme =>
    deepFreeze({ ...scheme, devices: { ...scheme.devices, controller: true } });

  it('rule 1: the button keeps its Xbox control, and the game binding follows the action', () => {
    // Left index 1 sends RB; Hardpoints ships on Y.
    const next = assign(base(), slot('ship', 'L.index_1'), 'hardpoints', padGame);
    expect([
      next.padMap['L.index_1'],
      pinSends(next, 'L.index_1'),
      boundTo(next, 'hardpoints'),
    ]).toEqual(['RB', pad('RB'), [pad('RB')]]);
  });

  it('rule 1: what was on the button is unplaced, and the game takes it off the control', () => {
    const next = assign(base(), slot('ship', 'L.index_1'), 'hardpoints', padGame);
    expect([actionAt(next, slot('ship', 'L.index_1')), boundTo(next, 'boost')]).toEqual([
      'hardpoints',
      [null],
    ]);
  });

  it('rule 1: displaces the action of another Azeron button sending the same control', () => {
    const twice: Scheme = deepFreeze({
      ...padScheme(),
      padMap: { ...padScheme().padMap, 'L.index_3': 'RB' },
      map: {
        ...padScheme().map,
        ship: { ...padScheme().map['ship'], 'L.index_3': { tap: 'silent' } },
      },
    });
    const next = assign(twice, slot('ship', 'L.index_1'), 'hardpoints', padGame);
    expect([
      next.map['ship']?.['L.index_3'],
      plan(next, padGame).findings.filter((f) => f.rule === 'key-collision'),
    ]).toEqual([undefined, []]);
  });

  it("rule 1: displaces the controller's own button sending the same control, which then shows the action", () => {
    const scheme = withController({
      ...padScheme(),
      map: {
        ...padScheme().map,
        ship: { ...padScheme().map['ship'], 'pad.RB': { tap: 'galaxy' } },
      },
    });
    const next = assign(scheme, slot('ship', 'L.index_1'), 'hardpoints', padGame);
    expect([
      next.map['ship']?.['pad.RB'],
      shownAction(next, 'ship', 'pad.RB')?.id,
      plan(next, padGame).findings.filter((f) => f.rule === 'key-collision'),
    ]).toEqual([undefined, 'hardpoints', []]);
  });

  it("rule 1: an action put on the controller's button is shown on the Azeron button sending it", () => {
    const next = assign(withController(padScheme()), slot('ship', 'pad.RB'), 'hardpoints', padGame);
    expect([
      shownAction(next, 'ship', 'L.index_1')?.id,
      next.map['ship']?.['L.index_1'],
      boundTo(next, 'hardpoints'),
    ]).toEqual(['hardpoints', undefined, [pad('RB')]]);
  });

  it('rule 2: another action replacing a stick’s action on a button gets a control of its own, not the stick’s', () => {
    // The button sends the left stick's up for Move forward; then Reload takes its place.
    const preset = deepFreeze(xboxControllerPreset(helldivers2));
    const forward = assign(preset, slot('default', 'L.middle_2'), 'move_forward', helldivers2);
    const next = assign(forward, slot('default', 'L.middle_2'), 'reload', helldivers2);
    const p = plan(next, helldivers2);
    expect([
      next.padMap['L.middle_2'],
      p.gameBindings
        .filter((b) => b.signal?.kind === 'pad' && b.signal.control === 'LS_UP')
        .map((b) => b.action),
      p.findings,
    ]).toEqual(['Y', ['move_forward'], []]);
  });

  it('rule 3: clearing a stick’s action off a button gives the stick’s direction back', () => {
    const preset = deepFreeze(xboxControllerPreset(helldivers2));
    const forward = assign(preset, slot('default', 'L.middle_2'), 'move_forward', helldivers2);
    const next = clear(forward, slot('default', 'L.middle_2'));
    expect('L.middle_2' in next.padMap).toBe(false);
  });

  it('rule 2: an action a stick sends for makes the button send the same stick direction, as with keys', () => {
    // Helldivers 2's left stick sends Move forward (up). Left middle 2 sends Y with nothing on it.
    const preset = deepFreeze(xboxControllerPreset(helldivers2));
    const next = assign(preset, slot('default', 'L.middle_2'), 'move_forward', helldivers2);
    const p = plan(next, helldivers2);
    expect([
      next.padMap['L.middle_2'],
      p.findings,
      p.gameBindings.find((b) => b.action === 'move_forward')?.signal,
    ]).toEqual(['LS_UP', [], pad('LS_UP')]);
  });

  it('rule 2: a button sending nothing gets the control the game ships the action on, when free', () => {
    const next = assign(base(), slot('ship', 'L.index_4'), 'hardpoints', padGame);
    expect([next.padMap['L.index_4'], boundTo(next, 'hardpoints')]).toEqual(['Y', [pad('Y')]]);
  });

  it('rule 2: else the first free control, never one a button with an action already sends', () => {
    // A (Lite's FSD, on L.middle_1) and RB, RT are taken; B is the first free one.
    const next = assign(base(), slot('ship', 'L.index_4'), 'gear', padGame);
    expect([next.padMap['L.index_4'], plan(next, padGame).findings]).toEqual(['B', []]);
  });

  it('rule 2: takes a control from a button that sends it with nothing on it', () => {
    const idle: Scheme = deepFreeze({
      ...padScheme(),
      padMap: { ...padScheme().padMap, 'L.index_2': 'Y' },
    });
    const next = assign(idle, slot('ship', 'L.index_4'), 'hardpoints', padGame);
    expect([next.padMap['L.index_4'], 'L.index_2' in next.padMap]).toEqual(['Y', false]);
  });

  it('rule 2: with no control free the button sends nothing, and core says so: the directions the sticks send are never free', () => {
    const controls = PAD_CONTROLS.filter((c) => !/^[LR]S_/.test(c));
    const g: Game = {
      id: 'many',
      name: 'Many',
      modes: [{ id: 'm', name: 'M' }],
      actions: [...controls, 'last'].map((id) => ({
        id: `a_${id}`,
        name: id,
        mode: 'm',
        role: 'ability' as const,
        required: false,
      })),
    };
    const positions = CYBORG2_LEFT.positions
      .filter((p) => p.name !== 'stick')
      .map((p) => `L.${p.name}`);
    const full: Scheme = deepFreeze({
      ...padScheme(),
      gameId: 'many',
      padMap: Object.fromEntries(controls.map((c, i) => [positions[i], c])),
      map: { m: Object.fromEntries(controls.map((c, i) => [positions[i], { tap: `a_${c}` }])) },
    });
    const free = `R.${CYBORG2_LEFT.positions[0]?.name ?? ''}`;
    const next = assign(full, { mode: 'm', control: free, press: 'tap' }, 'a_last', g);
    expect([
      free in next.padMap,
      plan(next, g)
        .findings.filter((f) => f.rule === 'sends-nothing')
        .map((f) => f.control),
    ]).toEqual([false, [free]]);
  });

  it('rule 3: clearing takes the action off, and a button left with nothing stops sending', () => {
    // Right index 1 carries Fire in the ship and nothing in the SRV.
    const next = clear(base(), slot('ship', 'R.index_1'));
    expect([
      next.map['ship']?.['R.index_1'],
      'R.index_1' in next.padMap,
      pinSends(next, 'R.index_1'),
    ]).toEqual([undefined, false, undefined]);
  });

  it('rule 3: a button still carrying an action in another mode keeps its control', () => {
    // Left index 1: Boost in the ship, Jump in the SRV.
    const next = clear(base(), slot('ship', 'L.index_1'));
    expect([next.map['ship']?.['L.index_1'], next.padMap['L.index_1']]).toEqual([undefined, 'RB']);
  });

  it("rule 3: clearing the controller's button takes the action off the Azeron button sending it too", () => {
    const scheme = withController(padScheme());
    const next = clear(scheme, slot('ship', 'pad.RT'));
    expect([shownAction(next, 'ship', 'pad.RT'), next.map['ship']?.['R.index_1']]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('rule 4: moving clears the source and assigns the target', () => {
    const next = move(base(), slot('ship', 'R.index_1'), slot('ship', 'L.index_4'), padGame);
    // Fire ships on RT; R.index_1 sent it and, emptied, gave it up: RT is free for the target.
    expect([next.padMap['L.index_4'], 'R.index_1' in next.padMap, boundTo(next, 'fire')]).toEqual([
      'RT',
      false,
      [pad('RT')],
    ]);
  });

  it('touches no pad map with key output, nor for a press other than the tap', () => {
    const keys = assign(deepFreeze(keysScheme()), slot('ship', 'L.index_3'), 'hardpoints', padGame);
    expect(keys.padMap).toEqual({});
    const long = assign(base(), slot('ship', 'L.index_3', 'long'), 'hardpoints', padGame);
    expect('L.index_3' in long.padMap).toBe(false);
  });

  it('returns the same scheme when the action is already there', () => {
    const scheme = base();
    expect(assign(scheme, slot('ship', 'L.index_1'), 'boost', padGame)).toBe(scheme);
  });

  it('undo and redo carry the pad map with the map', () => {
    const start = base();
    const edited = assign(start, slot('ship', 'L.index_3'), 'hardpoints', padGame);
    const h = commit(startHistory(start), edited);
    expect([undo(h).present.padMap, redo(undo(h)).present.padMap['L.index_3']]).toEqual([
      padScheme().padMap,
      'Y',
    ]);
  });
});

describe('one control per binding set', () => {
  it('moves an action within its binding set only: on the mouse and on a controller button at once', () => {
    const scheme: Scheme = deepFreeze({
      ...padScheme(),
      devices: { ...AZERONS_ONLY, mouse: true },
      map: { ship: { 'mouse.left': { tap: 'fire' }, 'R.index_1': { tap: 'fire' } } },
    });
    const next = assign(scheme, slot('ship', 'L.index_4'), 'fire', padGame);
    expect([
      next.map['ship']?.['mouse.left'],
      next.map['ship']?.['R.index_1'],
      next.map['ship']?.['L.index_4'],
    ]).toEqual([{ tap: 'fire' }, undefined, { tap: 'fire' }]);
  });
});

describe('setDevices', () => {
  const both = deepFreeze(xboxControllerPreset(helldivers2));
  const leftAndMouse = { ...AZERONS_ONLY, azerons: 'left' as const };

  it('the left Azeron brings the mouse, whatever it is told', () => {
    expect(setDevices(both, leftAndMouse, helldivers2).devices).toEqual({
      azerons: 'left',
      keyboard: false,
      mouse: true,
      controller: false,
    });
  });

  it('takes the actions off the right unit, which the setup no longer has', () => {
    const next = setDevices(both, leftAndMouse, helldivers2);
    expect(Object.keys(next.map['default'] ?? {}).filter((c) => c.startsWith('R.'))).toEqual([]);
  });

  it('starts the mouse from what the game ships: Fire and Aim on its buttons, beside the unit', () => {
    const next = setDevices(both, leftAndMouse, helldivers2);
    expect([
      next.map['default']?.['mouse.left'],
      next.map['default']?.['mouse.right'],
      next.map['default']?.['L.index_2'],
    ]).toEqual([{ tap: 'fire_primary' }, { tap: 'aim' }, { tap: 'fire_primary' }]);
  });

  it('keeps the game binding of every action the mouse ships on, so the mouse does what it did', () => {
    const p = plan(setDevices(both, leftAndMouse, helldivers2), helldivers2);
    expect(
      p.gameBindings
        .filter((b) => b.set === 'keyboard' && b.signal?.kind === 'mouse')
        .map((b) => [b.action, b.signal]),
    ).toEqual([
      ['fire_primary', { kind: 'mouse', button: 'left' }],
      ['aim', { kind: 'mouse', button: 'right' }],
    ]);
  });

  it('adds a controller with nothing new where the Azerons already send what the game ships', () => {
    const next = setDevices(both, { ...AZERONS_ONLY, controller: true }, helldivers2);
    expect([
      Object.keys(next.map['default'] ?? {}).filter((c) => c.startsWith('pad.')),
      shownAction(next, 'default', 'pad.X')?.id,
    ]).toEqual([[], 'reload']);
  });

  it('returns the same scheme for the same devices', () => {
    expect(setDevices(both, AZERONS_ONLY, helldivers2)).toBe(both);
  });
});

describe('isStick', () => {
  it('is true for each unit stick and both controller sticks, and for nothing else', () => {
    expect(
      [
        'L.stick',
        'R.stick',
        'pad.left_stick',
        'pad.right_stick',
        'L.stick_press',
        'pad.LS',
        'key.S',
      ].filter(isStick),
    ).toEqual(['L.stick', 'R.stick', 'pad.left_stick', 'pad.right_stick']);
  });

  it('keeps an action off a controller stick: it has directions, not presses', () => {
    const scheme = deepFreeze({ ...padScheme(), devices: { ...AZERONS_ONLY, controller: true } });
    expect(assign(scheme, slot('ship', 'pad.left_stick'), 'gear', padGame)).toBe(scheme);
  });
});

describe('setOutput: what the Azerons send', () => {
  const hd = deepFreeze(xboxControllerPreset(helldivers2));
  const errors = (scheme: Scheme, g: Game) =>
    resolve(scheme, g, BUILT_IN_DEVICES)
      .findings.filter((f) => f.rule === 'key-collision' || f.rule === 'pad-bound-twice')
      .map((f) => `${f.rule} ${f.control ?? ''}`);

  it('keys to controller: each button keeps its action and sends the Xbox control the game ships it on', () => {
    const next = setOutput(frozen(), 'pad', padGame);
    expect([next.output, next.padMap, next.map['ship'], next.map['srv']]).toEqual([
      'pad',
      { 'L.index_1': 'RB', 'L.middle_1': 'A', 'R.index_1': 'RT' },
      { 'L.index_1': { tap: 'boost' }, 'L.middle_1': { tap: 'fsd' }, 'R.index_1': { tap: 'fire' } },
      { 'L.index_1': { tap: 'jump' } },
    ]);
  });

  it('keys to controller: a long press or a double tap comes off, since an Xbox button only taps', () => {
    const scheme = deepFreeze(
      assign(keysScheme(), slot('ship', 'L.index_1', 'long'), 'gear', game),
    );
    expect(setOutput(scheme, 'pad', padGame).map['ship']?.['L.index_1']).toEqual({ tap: 'boost' });
  });

  it('keys to controller: each stick becomes its hand’s Xbox stick, and keeps its tuning', () => {
    const scheme = deepFreeze({
      ...keysScheme(),
      behaviour: { 'L.stick': { stick: { mode: 'mouse' as const, deadzone: 12 } } },
    });
    const next = setOutput(scheme, 'pad', padGame);
    expect([next.behaviour['L.stick'], next.behaviour['R.stick']]).toEqual([
      { stick: { mode: 'pad-left', deadzone: 12 } },
      { stick: { mode: 'pad-right' } },
    ]);
  });

  it('controller to keys: the buttons keep their actions, and send no Xbox control', () => {
    const next = setOutput(deepFreeze(padScheme()), 'keys', padGame);
    expect([next.output, next.padMap, next.map]).toEqual(['keys', {}, padScheme().map]);
  });

  it('controller to keys: a stick sends the keys the game ships its directions’ actions on, else moves the mouse', () => {
    const next = setOutput(hd, 'keys', helldivers2);
    expect([next.behaviour['L.stick'], next.behaviour['R.stick']]).toEqual([
      {
        stick: {
          mode: 'keys',
          directions: {
            up: { kind: 'key', code: 'W' },
            down: { kind: 'key', code: 'S' },
            left: { kind: 'key', code: 'A' },
            right: { kind: 'key', code: 'D' },
          },
        },
      },
      { stick: { mode: 'mouse' } },
    ]);
  });

  it('there and back on Helldivers 2 leaves no action on two controls, nor two on one', () => {
    const keys = setOutput(hd, 'keys', helldivers2);
    const back = setOutput(keys, 'pad', helldivers2);
    expect([errors(keys, helldivers2), errors(back, helldivers2)]).toEqual([[], []]);
  });

  it('leaves the controller’s own buttons as they are', () => {
    const scheme = deepFreeze({
      ...padScheme(),
      devices: { ...AZERONS_ONLY, controller: true },
      map: { ship: { 'pad.Y': { tap: 'hardpoints' }, 'L.index_1': { tap: 'boost' } } },
    });
    expect(setOutput(scheme, 'keys', padGame).map['ship']?.['pad.Y']).toEqual({
      tap: 'hardpoints',
    });
  });

  it('controller to keys with a controller in the setup: its buttons keep doing what they did', () => {
    const both = setDevices(hd, { ...AZERONS_ONLY, controller: true }, helldivers2);
    // The controller's X shows Reload only by the Azeron button sending X: no entry of its own.
    expect([both.map['default']?.['pad.X'], shownAction(both, 'default', 'pad.X')?.id]).toEqual([
      undefined,
      'reload',
    ]);
    const keys = setOutput(both, 'keys', helldivers2);
    const rows = plan(keys, helldivers2).gameBindings.filter(
      (b) => b.set === 'controller' && b.action === 'reload',
    );
    expect([
      shownAction(keys, 'default', 'pad.X')?.id,
      keys.map['default']?.['L.middle_1'],
      rows.map((b) => b.signal),
    ]).toEqual(['reload', { tap: 'reload' }, [{ kind: 'pad', control: 'X' }]]);
  });

  it('keys to controller: a button whose action the controller already has joins its control', () => {
    const scheme = deepFreeze({
      ...keysScheme(),
      devices: { ...AZERONS_ONLY, controller: true },
      map: { ship: { 'pad.Y': { tap: 'hardpoints' }, 'L.index_1': { tap: 'hardpoints' } } },
    });
    const next = setOutput(scheme, 'pad', padGame);
    expect([next.padMap['L.index_1'], next.map['ship']?.['pad.Y']]).toEqual([
      'Y',
      { tap: 'hardpoints' },
    ]);
  });

  it('returns the same scheme for the output it already has', () => {
    expect(setOutput(hd, 'pad', helldivers2)).toBe(hd);
  });
});

describe('setPadControl: which Xbox control a button sends', () => {
  const base = () => deepFreeze(padScheme());
  const boundTo = (scheme: Scheme, action: string, g: Game = padGame) =>
    plan(scheme, g)
      .gameBindings.filter(
        (b) => b.set === 'controller' && b.mode === 'ship' && b.action === action,
      )
      .map((b) => b.signal);

  it('sends the control chosen, and its action goes with it: the game binds the action there', () => {
    const next = setPadControl(base(), 'L.index_1', 'X', padGame);
    expect([next.padMap['L.index_1'], boundTo(next, 'boost')]).toEqual([
      'X',
      [{ kind: 'pad', control: 'X' }],
    ]);
  });

  it('a button already sending it takes the old control in exchange, with its own action', () => {
    // Left middle 1 sends A, with Frame shift drive.
    const next = setPadControl(base(), 'L.index_1', 'A', padGame);
    expect([
      next.padMap['L.index_1'],
      next.padMap['L.middle_1'],
      next.map['ship']?.['L.index_1'],
      next.map['ship']?.['L.middle_1'],
      boundTo(next, 'fsd'),
    ]).toEqual(['A', 'RB', { tap: 'boost' }, { tap: 'fsd' }, [{ kind: 'pad', control: 'RB' }]]);
  });

  it('what the controller’s own button had on that control comes off it', () => {
    const scheme = deepFreeze({
      ...padScheme(),
      devices: { ...AZERONS_ONLY, controller: true },
      map: { ship: { 'pad.X': { tap: 'hardpoints' }, 'L.index_1': { tap: 'boost' } } },
    });
    const next = setPadControl(scheme, 'L.index_1', 'X', padGame);
    expect([next.map['ship']?.['pad.X'], shownAction(next, 'ship', 'pad.X')?.id]).toEqual([
      undefined,
      'boost',
    ]);
  });

  it('an empty button sends the control chosen, and shows what is on it', () => {
    const next = setPadControl(base(), 'L.index_4', 'A', padGame);
    expect([next.padMap['L.index_4'], shownAction(next, 'ship', 'L.index_4')?.id]).toEqual([
      'A',
      'fsd',
    ]);
  });

  it('a button that sent nothing, with an action, takes the control over: what was on it comes off', () => {
    // Left index 4 carries Landing gear and sends nothing; Left middle 1 sends A, with FSD.
    const next = setPadControl(
      deepFreeze({
        ...padScheme(),
        map: { ship: { 'L.index_4': { tap: 'gear' }, 'L.middle_1': { tap: 'fsd' } } },
      }),
      'L.index_4',
      'A',
      padGame,
    );
    expect([
      next.padMap['L.index_4'],
      next.padMap['L.middle_1'],
      next.map['ship']?.['L.middle_1'],
      shownAction(next, 'ship', 'L.middle_1')?.id,
    ]).toEqual(['A', 'A', undefined, 'gear']);
  });

  it('never a direction a stick of the setup sends', () => {
    const scheme = base();
    expect(setPadControl(scheme, 'L.index_1', 'LS_UP', padGame)).toBe(scheme);
  });

  it('refuses with key output, on the stick, on a key, and on a unit the setup doesn’t use', () => {
    const keys = frozen();
    const pad = base();
    const leftOnly = deepFreeze({
      ...padScheme(),
      devices: { ...AZERONS_ONLY, azerons: 'left' as const },
    });
    expect([
      setPadControl(keys, 'L.index_1', 'X', padGame) === keys,
      setPadControl(pad, 'L.stick', 'X', padGame) === pad,
      setPadControl(pad, 'key.J', 'X', padGame) === pad,
      setPadControl(leftOnly, 'R.index_1', 'X', padGame) === leftOnly,
    ]).toEqual([true, true, true, true]);
  });

  it('keeps a button carrying a stick’s action on the stick’s direction', () => {
    // Move forward dropped on a button makes it send the left stick's up.
    const hd = deepFreeze(
      assign(
        xboxControllerPreset(helldivers2),
        slot('default', 'L.index_4'),
        'move_forward',
        helldivers2,
      ),
    );
    expect(hd.padMap['L.index_4']).toBe('LS_UP');
    expect(setPadControl(hd, 'L.index_4', 'Y', helldivers2)).toBe(hd);
  });

  it('returns the same scheme for the control it already sends', () => {
    const scheme = base();
    expect(setPadControl(scheme, 'L.index_1', 'RB', padGame)).toBe(scheme);
  });
});

describe.each([
  ['Helldivers 2', helldivers2, 'default'],
  ['a game with hostile ids, in a mode named __proto__', hostileOneMode, '__proto__'],
] as const)(
  'controller output: what every control shows is what the game does, on %s',
  (_name, g, mode) => {
    // Helldivers 2 from the Xbox controller preset, edited by a long run of drags, clears, moves,
    // chosen Xbox controls and switches of what the Azerons send. After every edit, on every Xbox control something of the setup sends, the action the
    // controls sending it show is the one the game's controller bindings put on it, and no other
    // (bar the game's own second uses of one button, such as Climb on a held A next to Interact).
    // A stick sends the moves: an action a stick sends for is the stick's, not a button's.
    // The moves too: a stick sends for them, and a button they are dropped on sends the stick's
    // direction until another action takes their place.
    const actions = g.actions.map((a) => a.id);
    const buttons = [
      ...CYBORG2_LEFT.positions.filter((p) => p.name !== 'stick').map((p) => `L.${p.name}`),
      ...CYBORG2_RIGHT.positions.filter((p) => p.name !== 'stick').map((p) => `R.${p.name}`),
    ];
    const pads = PAD_CONTROLS.filter((c) => !/^[LR]S_/.test(c)).map((c) => `pad.${c}`);

    /** Deterministic: the same run every time. */
    function* steps(seed: number, count: number, controls: readonly string[]) {
      let x = seed;
      const next = (n: number) => {
        x = (x * 1103515245 + 12345) % 2147483648;
        return Math.floor(x / 65536) % n;
      };
      for (let i = 0; i < count; i++) {
        // Mostly drags, clears and moves; now and then a button's Xbox control is chosen, or what
        // the Azerons send is switched.
        const kind = next(12);
        const control = controls[next(controls.length)] ?? '';
        const other = controls[next(controls.length)] ?? '';
        const action = actions[next(actions.length)] ?? '';
        const pad = PAD_CONTROLS[next(PAD_CONTROLS.length)] ?? 'A';
        yield { kind, control, other, action, pad };
      }
    }

    function faults(scheme: Scheme): string[] {
      const p = plan(scheme, g);
      const out: string[] = [];
      // The editor itself never puts two actions on one Xbox control, nor one action on two.
      const bad = p.findings.filter(
        (f) => f.rule === 'key-collision' || f.rule === 'pad-bound-twice',
      );
      if (bad.length > 0) out.push(`findings: ${bad.map((f) => f.rule).join(', ')}`);
      // What is wrong is never silent: an error names a control sending the Xbox control.
      const flagged = (pc: string) =>
        p.findings.some(
          (f) =>
            f.severity === 'error' &&
            f.control !== undefined &&
            (padSignalOf(scheme, f.control) === pc ||
              p.bindings.some(
                (b) =>
                  b.control === f.control && b.signal.kind === 'pad' && b.signal.control === pc,
              )),
        );
      const nativeOf = (action: string) => g.actions.find((a) => a.id === action)?.native?.pad;
      // No live Xbox control binds two actions, bar the game's own second uses of one control.
      for (const pc of new Set(
        p.gameBindings.flatMap((b) => (b.signal?.kind === 'pad' ? [b.signal.control] : [])),
      )) {
        const on = p.gameBindings
          .filter((b) => b.signal?.kind === 'pad' && b.signal.control === pc)
          .map((b) => b.action);
        const moved = on.filter((a) => nativeOf(a) !== pc);
        if ((moved.length > 1 || (moved.length === 1 && on.length > 1)) && !flagged(pc)) {
          out.push(`${pc}: binds ${on.join(', ')}, and nothing says so`);
        }
      }
      const controls = [...buttons, ...pads].filter((c) => padSignalOf(scheme, c) !== undefined);
      for (const pc of new Set(controls.map((c) => padSignalOf(scheme, c)))) {
        const senders = controls.filter((c) => padSignalOf(scheme, c) === pc);
        const shown = new Set(senders.map((c) => shownAction(scheme, mode, c)?.id ?? null));
        if (shown.size > 1) out.push(`${pc}: shown differently on ${senders.join(', ')}`);
        const one = [...shown][0] ?? null;
        const shownNative = one === null ? undefined : nativeOf(one);
        const bound = p.gameBindings
          .filter(
            (b) => b.set === 'controller' && b.signal?.kind === 'pad' && b.signal.control === pc,
          )
          .map((b) => b.action)
          .filter((a) => a === one || nativeOf(a) !== shownNative);
        const want = one === null ? [] : [one];
        if (JSON.stringify(bound) !== JSON.stringify(want) && !flagged(String(pc))) {
          out.push(`${pc}: shows ${String(one)}, the game does ${bound.join(', ') || 'nothing'}`);
        }
      }
      return out;
    }

    it.each([
      ['both Azerons', AZERONS_ONLY, buttons],
      [
        'both Azerons and the controller',
        { ...AZERONS_ONLY, controller: true },
        [...buttons, ...pads],
      ],
      [
        'the controller only',
        { ...AZERONS_ONLY, azerons: 'none' as const, controller: true },
        pads,
      ],
    ])('holds through 300 edits with %s', (_, devices, controls) => {
      let scheme: Scheme = { ...xboxControllerPreset(g), devices };
      if (devices.azerons === 'none')
        scheme = { ...scheme, padMap: {}, map: Object.fromEntries([[mode, {}]]) };
      const found: string[] = [];
      let n = 0;
      for (const step of steps(7 + controls.length, 300, controls)) {
        n++;
        const at = { mode: mode, control: step.control, press: 'tap' as const };
        scheme =
          step.kind < 4
            ? assign(scheme, at, step.action, g)
            : step.kind < 7
              ? clear(scheme, at)
              : step.kind < 10
                ? move(scheme, at, { ...at, control: step.other }, g)
                : step.kind === 10
                  ? setPadControl(scheme, step.control, step.pad, g)
                  : setOutput(scheme, scheme.output === 'pad' ? 'keys' : 'pad', g);
        for (const fault of faults(scheme)) found.push(`after edit ${n}: ${fault}`);
      }
      expect(found).toEqual([]);
    });
  },
);

describe('the sends-nothing fix on a fixed control', () => {
  it('keeps a working tap and takes off only the press that sends nothing', () => {
    const scheme = deepFreeze({
      ...keysScheme(),
      devices: { ...AZERONS_ONLY, keyboard: true },
      map: { ...keysScheme().map, ship: { 'key.J': { tap: 'fsd', long: 'galaxy' } } },
    });
    const before = plan(scheme).findings.find((f) => f.rule === 'sends-nothing');
    expect(before?.control).toBe('key.J');
    const fix = fixFor(before as Finding, scheme, game, plan(scheme));
    const after = (fix as NonNullable<typeof fix>).apply(scheme);
    expect(after.map['ship']?.['key.J']).toEqual({ tap: 'fsd' });
    expect(plan(after).findings.find((f) => f.rule === 'sends-nothing')).toBeUndefined();
  });

  it('takes everything off a control none of the devices has', () => {
    const scheme = deepFreeze({
      ...keysScheme(),
      map: { ...keysScheme().map, ship: { 'nope.1': { tap: 'fsd', long: 'galaxy' } } },
    });
    const before = plan(scheme).findings.filter((f) => f.rule === 'sends-nothing');
    expect(before).toHaveLength(2);
    const fix = fixFor(before[0] as Finding, scheme, game, plan(scheme));
    const after = (fix as NonNullable<typeof fix>).apply(scheme);
    expect(after.map['ship']?.['nope.1']).toBeUndefined();
  });
});

describe('a control or mode named like an Object property', () => {
  afterEach(() => {
    // A failing run writes onto Object itself; leave nothing behind.
    Reflect.deleteProperty(Object, 'tap');
  });

  it('assign puts an action on a button named constructor, and never on Object', () => {
    const next = assign(frozen(), slot('ship', 'constructor'), 'gear', game);
    expect({
      placed: actionAt(next, slot('ship', 'constructor')),
      onObject: Object.hasOwn(Object, 'tap'),
    }).toEqual({ placed: 'gear', onObject: false });
  });

  it('assign keeps a control the scheme file names __proto__ as an entry of its own', () => {
    const scheme = keysScheme();
    scheme.map['ship'] = JSON.parse('{"__proto__": {"tap": "lights"}}') as Scheme['map'][string];
    const next = assign(scheme, slot('ship', 'L.index_2'), 'gear', game);
    expect(Object.keys(next.map['ship'] ?? {})).toEqual(['__proto__', 'L.index_2']);
  });

  it('clear takes an action off a button named constructor, as that entry', () => {
    const placed = assign(frozen(), slot('ship', 'constructor'), 'gear', game);
    expect(actionAt(clear(placed, slot('ship', 'constructor')), slot('ship', 'constructor'))).toBe(
      undefined,
    );
  });
});

describe('a switch of output or devices keeps what every control shows', () => {
  const hdBoth = () =>
    deepFreeze(
      setDevices(
        xboxControllerPreset(helldivers2),
        { ...AZERONS_ONLY, controller: true },
        helldivers2,
      ),
    );
  const at = (control: string) => ({ mode: 'default', control, press: 'tap' as const });

  it('controller to keys: an Azeron button showing the controller’s action keeps it', () => {
    // Codex's case: Reload put on the controller's X, which Left middle 1 also sends.
    const scheme = assign(hdBoth(), at('pad.X'), 'reload', helldivers2);
    expect(shownPresses(scheme, 'default', 'L.middle_1')).toEqual({ tap: 'reload' });
    const keys = setOutput(scheme, 'keys', helldivers2);
    expect([
      shownPresses(keys, 'default', 'L.middle_1'),
      shownPresses(keys, 'default', 'pad.X'),
    ]).toEqual([{ tap: 'reload' }, { tap: 'reload' }]);
  });

  it('controller to keys: a long press or a double tap stays, since keys have them', () => {
    const scheme = deepFreeze({
      ...padScheme(),
      map: { ship: { 'L.index_1': { tap: 'boost', long: 'gear', double: 'galaxy' } } },
    });
    expect(setOutput(scheme, 'keys', padGame).map['ship']?.['L.index_1']).toEqual({
      tap: 'boost',
      long: 'gear',
      double: 'galaxy',
    });
  });

  it('taking the controller away: an Azeron button showing its action keeps it', () => {
    const scheme = assign(hdBoth(), at('pad.X'), 'reload', helldivers2);
    const gone = setDevices(scheme, AZERONS_ONLY, helldivers2);
    expect(shownPresses(gone, 'default', 'L.middle_1')).toEqual({ tap: 'reload' });
  });

  it('taking the Azerons away: a controller button showing an Azeron’s action keeps it', () => {
    const scheme = hdBoth();
    expect(shownPresses(scheme, 'default', 'pad.X')).toEqual({ tap: 'reload' });
    const gone = setDevices(
      scheme,
      { azerons: 'none', keyboard: false, mouse: false, controller: true },
      helldivers2,
    );
    expect(shownPresses(gone, 'default', 'pad.X')).toEqual({ tap: 'reload' });
  });

  it('taking the right unit away: a controller button showing its action keeps it', () => {
    // Melee is on the right stick press, which sends RS.
    const scheme = hdBoth();
    const left = setDevices(
      scheme,
      { azerons: 'left', keyboard: false, mouse: true, controller: true },
      helldivers2,
    );
    expect([
      shownPresses(scheme, 'default', 'pad.RS'),
      shownPresses(left, 'default', 'pad.RS'),
    ]).toEqual([{ tap: 'melee' }, { tap: 'melee' }]);
  });

  it('shownPresses: a control’s own presses, and on the tap what its Xbox control does', () => {
    const scheme = assign(hdBoth(), at('pad.X'), 'reload', helldivers2);
    expect([
      shownPresses(scheme, 'default', 'L.middle_1'),
      shownPresses(scheme, 'default', 'L.pinky_5'),
      shownPresses(
        { ...padScheme(), map: { ship: { 'L.index_1': { long: 'gear' } } } },
        'ship',
        'L.index_1',
      ),
    ]).toEqual([{ tap: 'reload' }, {}, { long: 'gear' }]);
  });

  it('controller to keys with the keyboard in the setup: the keyboard keeps every key it had', () => {
    // Codex's first case: Reload is on R and on the Azeron button sending X.
    const scheme = deepFreeze(
      setDevices(
        xboxControllerPreset(helldivers2),
        { ...AZERONS_ONLY, keyboard: true, mouse: true },
        helldivers2,
      ),
    );
    expect(shownPresses(scheme, 'default', 'key.R')).toEqual({ tap: 'reload' });
    const keys = setOutput(scheme, 'keys', helldivers2);
    expect([
      shownPresses(keys, 'default', 'key.R'),
      shownPresses(keys, 'default', 'L.middle_1'),
    ]).toEqual([{ tap: 'reload' }, { tap: 'reload' }]);
  });

  it('controller to keys: two buttons sending one Xbox control both keep its action', () => {
    // Codex's second case: the empty left pinky 5 is set to send X, so it shows Reload too.
    const scheme = deepFreeze(
      setPadControl(xboxControllerPreset(helldivers2), 'L.pinky_5', 'X', helldivers2),
    );
    expect(shownPresses(scheme, 'default', 'L.pinky_5')).toEqual({ tap: 'reload' });
    const keys = setOutput(scheme, 'keys', helldivers2);
    expect([
      shownPresses(keys, 'default', 'L.middle_1'),
      shownPresses(keys, 'default', 'L.pinky_5'),
    ]).toEqual([{ tap: 'reload' }, { tap: 'reload' }]);
  });

  it('one action on several keys after a switch is kept on all: the keyboard set takes several', () => {
    const scheme = setPadControl(xboxControllerPreset(helldivers2), 'L.pinky_5', 'X', helldivers2);
    const keys = setOutput(
      setDevices(scheme, { ...AZERONS_ONLY, keyboard: true, mouse: true }, helldivers2),
      'keys',
      helldivers2,
    );
    const p = plan(keys, helldivers2);
    expect([
      ['L.middle_1', 'L.pinky_5', 'key.R'].map((c) => shownPresses(keys, 'default', c).tap),
      p.findings.filter((f) => f.severity === 'error').map((f) => f.rule),
    ]).toEqual([['reload', 'reload', 'reload'], []]);
  });

  it('one action on several Azeron buttons, switched to a controller, puts them on one Xbox control', () => {
    // The controller set takes one control per action: the buttons join, and nothing is flagged.
    const there = setPadControl(xboxControllerPreset(helldivers2), 'L.pinky_5', 'X', helldivers2);
    const back = setOutput(setOutput(there, 'keys', helldivers2), 'pad', helldivers2);
    const p = plan(back, helldivers2);
    expect([
      back.padMap['L.middle_1'] === back.padMap['L.pinky_5'],
      shownPresses(back, 'default', 'L.pinky_5').tap,
      p.findings.filter((f) => f.rule === 'pad-bound-twice' || f.rule === 'key-collision'),
    ]).toEqual([true, 'reload', []]);
  });

  // A long run of edits, with switches of output and of devices among them. After each switch,
  // every control the setup keeps shows what it showed: no action is lost or changed, on any
  // press. Two things a switch may do: a control that showed nothing may come to show an action
  // (it now sends the same Xbox control as a button that has one), and an Azeron button switched
  // to a controller drops its long press and double tap, which a controller button hasn't got.
  const DEVICES: SetupDevices[] = [
    { azerons: 'both', keyboard: false, mouse: false, controller: false },
    { azerons: 'both', keyboard: false, mouse: false, controller: true },
    { azerons: 'both', keyboard: true, mouse: true, controller: true },
    { azerons: 'left', keyboard: false, mouse: true, controller: true },
    { azerons: 'left', keyboard: true, mouse: true, controller: false },
    { azerons: 'none', keyboard: true, mouse: true, controller: true },
    { azerons: 'none', keyboard: false, mouse: false, controller: true },
  ];
  const everyControl = [
    ...CYBORG2_LEFT.positions.filter((p) => p.name !== 'stick').map((p) => `L.${p.name}`),
    ...CYBORG2_RIGHT.positions.filter((p) => p.name !== 'stick').map((p) => `R.${p.name}`),
    ...BUILT_IN_DEVICES.flatMap((d) => d.controls)
      .filter((c) => c.sends !== undefined && !c.id.startsWith('pedal.'))
      .map((c) => c.id),
  ];

  const azeron = (control: string) => control.startsWith('L.') || control.startsWith('R.');
  const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

  /**
   * What a switch may not do to a control the setup keeps. A device switch, and a switch of the
   * Azerons' output for every control but theirs: show exactly what it showed. The one thing an
   * output switch to a controller may do to the controller is give an empty button an action: an
   * Azeron button now sends that Xbox control too, and every Xbox control is the controller's.
   * The Azerons themselves: to keys, exactly what they showed; to a controller, the same tap, and
   * no long press or double tap, which a controller button hasn't got.
   */
  /**
   * What a switch may do to a control the setup keeps, and nothing else:
   * - a device switch, and an output switch for the keyboard and the mouse: nothing at all;
   * - an output switch to keys: nothing at all, to any control;
   * - an output switch to a controller: an Azeron button loses its long press and double tap, which a
   *   controller button hasn't got, and nothing else, in any mode; a controller button empty in
   *   every mode may come to show an action (an Azeron group now sends its control), and one that
   *   shows anything in any mode changes in none.
   */
  function faultsOf(
    before: Scheme,
    after: Scheme,
    outputSwitch: boolean,
    modes: readonly string[],
  ): string[] {
    const was = setupOf(before.devices);
    const now = setupOf(after.devices);
    const out: string[] = [];
    for (const control of everyControl) {
      if (!inSetup(was, control) || !inSetup(now, control)) continue;
      const a = modes.map((mode) => shownPresses(before, mode, control));
      const b = modes.map((mode) => shownPresses(after, mode, control));
      const say = () => `${control}: ${JSON.stringify(a)} became ${JSON.stringify(b)}`;
      const toPad = outputSwitch && after.output === 'pad';
      if (toPad && azeron(control)) {
        const kept = a.map((p) => (p.tap === undefined ? {} : { tap: p.tap }));
        if (!same(kept, b)) out.push(say());
      } else if (toPad && control.startsWith('pad.')) {
        const empty = a.every((p) => Object.keys(p).length === 0);
        if (!empty && !same(a, b)) out.push(say());
      } else if (!same(a, b)) out.push(say());
    }
    return out;
  }

  it('keeps every hostile mode and its actions through every switch, as entries of their own', () => {
    const start = xboxControllerPreset(hostileGame);
    const faults: string[] = [];
    const check = (label: string, before: Scheme, after: Scheme, outputSwitch: boolean) => {
      for (const mode of ['__proto__', 'constructor']) {
        if (!Object.hasOwn(after.map, mode)) faults.push(`${label}: mode ${mode} is gone`);
      }
      faults.push(
        ...faultsOf(before, after, outputSwitch, ['__proto__', 'constructor']).map(
          (f) => `${label}: ${f}`,
        ),
      );
    };
    // The preset puts actions in both modes, the renamed ones among them: Reload, renamed
    // `constructor`, on the button sending X, in the mode named `__proto__`.
    expect([
      Object.keys(own(start.map, 'constructor') ?? {}).length > 0,
      Object.values(own(start.map, '__proto__') ?? {}).some((p) => p.tap === 'constructor'),
    ]).toEqual([true, true]);
    const keys = setOutput(start, 'keys', hostileGame);
    check('to keys', start, keys, true);
    check('back to a controller', keys, setOutput(keys, 'pad', hostileGame), true);
    for (const devices of DEVICES)
      check(JSON.stringify(devices), start, setDevices(start, devices, hostileGame), false);
    expect(faults).toEqual([]);
  });

  it.each([
    [11, helldivers2],
    [23, helldivers2],
    [37, helldivers2],
    // Modes and actions named __proto__, constructor, toString, hasOwnProperty.
    [11, hostileGame],
    [23, hostileGame],
    [5, hostileGame],
    [41, hostileGame],
    // Two modes and buttons chosen to send one Xbox control: the shapes a join can get wrong.
    [7, padGame],
    [19, padGame],
    [31, padGame],
  ] as const)('holds through 200 edits with switches among them (seed %i, %o)', (seed, g) => {
    const modes = g.modes.map((m) => m.id);
    let x = seed;
    const next = (n: number) => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return Math.floor(x / 65536) % n;
    };
    const actions = g.actions.map((a) => a.id);
    let scheme: Scheme = xboxControllerPreset(g);
    const found: string[] = [];
    for (let i = 1; i <= 200; i++) {
      const kind = next(11);
      const control = everyControl[next(everyControl.length)] ?? '';
      const press = (['tap', 'tap', 'long', 'double'] as const)[next(4)] ?? 'tap';
      const action = actions[next(actions.length)] ?? '';
      const mode = g.actions.find((a) => a.id === action)?.mode ?? 'default';
      if (kind < 5) scheme = assign(scheme, { mode, control, press }, action, g);
      else if (kind < 7) scheme = clear(scheme, { mode, control, press });
      else if (kind === 9)
        // A button set to send another's Xbox control: two buttons with one action, which a switch
        // to keys keeps on both.
        scheme = setPadControl(scheme, control, PAD_CONTROLS[next(16)] ?? 'A', g);
      else {
        const before = scheme;
        scheme =
          kind === 7 || kind === 10
            ? setOutput(scheme, scheme.output === 'pad' ? 'keys' : 'pad', g)
            : setDevices(scheme, DEVICES[next(DEVICES.length)] ?? AZERONS_ONLY, g);
        for (const fault of faultsOf(before, scheme, kind === 7 || kind === 10, modes))
          found.push(`after edit ${i}: ${fault}`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe('a switch comes out the same whatever order the scheme lists its modes and controls in', () => {
  /** The same scheme, its modes, controls and pad map listed in another order. */
  function shuffled(scheme: Scheme, seed: number): Scheme {
    let x = seed;
    const next = (n: number) => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return Math.floor(x / 65536) % n;
    };
    const mix = <T>(list: T[]): T[] => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = next(i + 1);
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    };
    return {
      ...scheme,
      padMap: Object.fromEntries(mix(Object.entries(scheme.padMap))),
      map: Object.fromEntries(
        mix(Object.entries(scheme.map)).map(([mode, byControl]) => [
          mode,
          Object.fromEntries(mix(Object.entries(byControl))),
        ]),
      ),
    };
  }
  const CONTROLS = [
    ...CYBORG2_LEFT.positions.map((p) => `L.${p.name}`),
    ...CYBORG2_RIGHT.positions.map((p) => `R.${p.name}`),
    ...BUILT_IN_DEVICES.flatMap((d) => d.controls).map((c) => c.id),
  ];
  const layout = (scheme: Scheme, g: Game) =>
    JSON.stringify(g.modes.map((m) => CONTROLS.map((c) => [c, shownPresses(scheme, m.id, c)])));
  const switches = (g: Game): [string, (s: Scheme) => Scheme][] => [
    ['to the other output', (s) => setOutput(s, s.output === 'pad' ? 'keys' : 'pad', g)],
    ['to keys and back', (s) => setOutput(setOutput(s, 'keys', g), 'pad', g)],
    [
      'to the left Azeron and the controller',
      (s) => setDevices(s, { azerons: 'left', keyboard: false, mouse: true, controller: true }, g),
    ],
    [
      'to the controller and the keyboard only',
      (s) => setDevices(s, { azerons: 'none', keyboard: true, mouse: true, controller: true }, g),
    ],
  ];
  /** Schemes with buttons that share actions in some modes and not others. */
  const start = (g: Game, seed: number): Scheme => {
    let x = seed;
    const next = (n: number) => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return Math.floor(x / 65536) % n;
    };
    let scheme: Scheme = {
      ...xboxControllerPreset(g),
      devices: { ...AZERONS_ONLY, controller: true },
    };
    const buttons = CYBORG2_LEFT.positions
      .filter((p) => p.name !== 'stick')
      .map((p) => `L.${p.name}`);
    for (let i = 0; i < 40; i++) {
      const control = buttons[next(buttons.length)] ?? 'L.index_1';
      const action = g.actions[next(g.actions.length)];
      if (action === undefined) continue;
      scheme =
        i % 4 === 3
          ? setPadControl(scheme, control, PAD_CONTROLS[next(16)] ?? 'A', g)
          : assign(scheme, { mode: action.mode, control, press: 'tap' }, action.id, g);
    }
    // With keys, buttons that shared an Xbox control share its actions; more edits then make them
    // differ in some modes and not others.
    scheme = setOutput(scheme, 'keys', g);
    for (let i = 0; i < 12; i++) {
      const control = buttons[next(buttons.length)] ?? 'L.index_1';
      const action = g.actions[next(g.actions.length)];
      if (action !== undefined)
        scheme = assign(scheme, { mode: action.mode, control, press: 'tap' }, action.id, g);
    }
    return scheme;
  };

  it.each([
    [helldivers2, 3],
    [hostileGame, 5],
    [hostileGame, 9],
    [padGame, 13],
    [padGame, 21],
  ] as const)('on %o (seed %i), for every switch', (g, seed) => {
    const scheme = start(g, seed);
    const faults: string[] = [];
    for (const [name, run] of switches(g)) {
      const want = layout(run(scheme), g);
      for (const order of [1, 2, 3, 4, 5]) {
        if (layout(run(shuffled(scheme, order)), g) !== want)
          faults.push(`${name}, order ${order}`);
      }
    }
    expect(faults).toEqual([]);
  });
});

describe('switching to a controller: buttons share an Xbox control only when they agree in every mode', () => {
  const threeModes: Game = {
    ...padGame,
    modes: [...padGame.modes, { id: 'foot', name: 'On foot' }],
    actions: [
      ...padGame.actions,
      { id: 'sprint', name: 'Sprint', mode: 'foot', role: 'movement', required: false },
    ],
  };
  const keysWith = (map: Scheme['map']): Scheme => deepFreeze({ ...keysScheme(), map });
  const ROWS: [
    name: string,
    g: Game,
    map: Scheme['map'],
    shared: [string, string][],
    apart: [string, string][],
  ][] = [
    [
      // Codex's case: Boost on both in Ship, Jump only on middle 1 in SRV.
      'Boost on two buttons in Ship, Jump on one of them in SRV',
      padGame,
      {
        ship: { 'L.index_1': { tap: 'boost' }, 'L.middle_1': { tap: 'boost' } },
        srv: { 'L.middle_1': { tap: 'jump' } },
      },
      [],
      [['L.index_1', 'L.middle_1']],
    ],
    [
      'the same, listed the other way round',
      padGame,
      {
        srv: { 'L.middle_1': { tap: 'jump' } },
        ship: { 'L.middle_1': { tap: 'boost' }, 'L.index_1': { tap: 'boost' } },
      },
      [],
      [['L.index_1', 'L.middle_1']],
    ],
    [
      'two buttons the same in both modes',
      padGame,
      {
        ship: { 'L.index_1': { tap: 'boost' }, 'L.middle_1': { tap: 'boost' } },
        srv: { 'L.index_1': { tap: 'jump' }, 'L.middle_1': { tap: 'jump' } },
      },
      [['L.index_1', 'L.middle_1']],
      [],
    ],
    [
      'three modes: three buttons agreeing in one mode each, two in all three',
      threeModes,
      {
        ship: {
          'L.index_1': { tap: 'boost' },
          'L.middle_1': { tap: 'boost' },
          'L.ring_1': { tap: 'boost' },
          'L.pinky_1': { tap: 'boost' },
        },
        srv: {
          'L.middle_1': { tap: 'jump' },
          'L.ring_1': { tap: 'jump' },
          'L.pinky_1': { tap: 'jump' },
        },
        foot: { 'L.ring_1': { tap: 'sprint' }, 'L.pinky_1': { tap: 'sprint' } },
      },
      [['L.ring_1', 'L.pinky_1']],
      [
        ['L.index_1', 'L.middle_1'],
        ['L.middle_1', 'L.ring_1'],
        ['L.index_1', 'L.ring_1'],
      ],
    ],
  ];

  it('two groups whose actions each ship on the left stick’s up, in different modes, don’t share it', () => {
    // Elite's shape: Forward in the ship and Forward on foot, both on the left stick's up.
    const g: Game = {
      ...padGame,
      actions: [
        ...padGame.actions,
        {
          id: 'fwd_ship',
          name: 'Forward',
          mode: 'ship',
          role: 'movement',
          required: false,
          native: { pad: 'LS_UP' },
        },
        {
          id: 'fwd_srv',
          name: 'Drive',
          mode: 'srv',
          role: 'movement',
          required: false,
          native: { pad: 'LS_UP' },
        },
      ],
    };
    const scheme = keysWith({
      ship: { 'L.index_1': { tap: 'fwd_ship' } },
      srv: { 'L.middle_1': { tap: 'fwd_srv' } },
    });
    const pad = setOutput(scheme, 'pad', g);
    expect([
      pad.padMap['L.index_1'] === pad.padMap['L.middle_1'],
      shownPresses(pad, 'srv', 'L.index_1'),
      shownPresses(pad, 'ship', 'L.middle_1'),
    ]).toEqual([false, {}, {}]);
  });

  it.each(ROWS)('%s', (_name, g, map, shared, apart) => {
    const scheme = keysWith(map);
    const pad = setOutput(scheme, 'pad', g);
    const shown = (s: Scheme) =>
      g.modes.map((m) =>
        Object.keys(map[m.id] ?? {})
          .concat(...Object.values(map).map((r) => Object.keys(r)))
          .map((c) => [c, shownPresses(s, m.id, c)]),
      );
    expect({
      layout: JSON.stringify(shown(pad)),
      shared: shared.map(
        ([a, b]) => pad.padMap[a] !== undefined && pad.padMap[a] === pad.padMap[b],
      ),
      apart: apart.map(([a, b]) => pad.padMap[a] !== pad.padMap[b]),
    }).toEqual({
      layout: JSON.stringify(shown(scheme)),
      shared: shared.map(() => true),
      apart: apart.map(() => true),
    });
  });
});

describe('the device chooser', () => {
  const both = { ...AZERONS_ONLY };

  it('the left Azeron brings the mouse; both or none keep it only with the keyboard', () => {
    expect([
      chooseAzerons(both, 'left'),
      chooseAzerons(chooseAzerons(both, 'left'), 'both').mouse,
      chooseAzerons(chooseKeyboard(both, true), 'none'),
    ]).toEqual([
      { azerons: 'left', keyboard: false, mouse: true, controller: false },
      false,
      { azerons: 'none', keyboard: true, mouse: true, controller: false },
    ]);
  });

  it('the keyboard comes with the mouse, and the mouse stays with the left Azeron', () => {
    expect([
      chooseKeyboard(both, true),
      chooseKeyboard(chooseKeyboard(both, true), false).mouse,
      chooseKeyboard(chooseAzerons(both, 'left'), false).mouse,
    ]).toEqual([{ azerons: 'both', keyboard: true, mouse: true, controller: false }, false, true]);
  });

  it('adds and takes away the controller', () => {
    expect([chooseController(both, true).controller, chooseController(both, false)]).toEqual([
      true,
      both,
    ]);
  });

  it('knows a setup with nothing in it', () => {
    expect([
      hasDevices(both),
      hasDevices(chooseAzerons(both, 'none')),
      hasDevices(chooseController(chooseAzerons(both, 'none'), true)),
    ]).toEqual([true, false, true]);
  });
});

describe('renameScheme', () => {
  it('takes the name trimmed, and keeps the old one for an empty name or the same one', () => {
    const scheme = frozen();
    expect([
      renameScheme(scheme, '  Desk  ').name,
      renameScheme(scheme, '   ') === scheme,
      renameScheme(scheme, 'Main') === scheme,
      renameScheme(scheme, 'x'.repeat(60)).name.length,
    ]).toEqual(['Desk', true, true, 40]);
  });
});

describe('key labels', () => {
  const labelled = (labels: NonNullable<Scheme['keyLabels']>): Scheme =>
    deepFreeze({ ...keysScheme(), keyLabels: labels });

  it('sets a key label on a control showing an action, trimmed, in that mode only', () => {
    const next = setKeyLabel(frozen(), 'ship', 'L.middle_1', '  FSD  ');
    expect([keyLabelOf(next, 'ship', 'L.middle_1'), keyLabelOf(next, 'srv', 'L.middle_1')]).toEqual(
      ['FSD', undefined],
    );
  });

  it('takes no key label on a control showing nothing, or on a scheme that has none yet', () => {
    const scheme = frozen();
    expect([
      setKeyLabel(scheme, 'ship', 'L.index_5', 'Go') === scheme,
      keyLabelOf(scheme, 'ship', 'L.index_1'),
    ]).toEqual([true, undefined]);
  });

  it('cuts a key label at its limit, and removes it when it is blank', () => {
    const long = setKeyLabel(frozen(), 'ship', 'L.middle_1', 'x'.repeat(40));
    const removed = setKeyLabel(long, 'ship', 'L.middle_1', '   ');
    expect([
      keyLabelOf(long, 'ship', 'L.middle_1')?.length,
      keyLabelOf(removed, 'ship', 'L.middle_1'),
    ]).toEqual([KEY_LABEL_LIMIT, undefined]);
    expect(removed.keyLabels).toEqual({ ship: {} });
  });

  it('returns the same scheme for the label it already has', () => {
    const scheme = labelled({ ship: { 'L.middle_1': 'FSD' } });
    expect([
      setKeyLabel(scheme, 'ship', 'L.middle_1', 'FSD') === scheme,
      setKeyLabel(scheme, 'ship', 'L.index_1', '') === scheme,
    ]).toEqual([true, true]);
  });

  it('reads only a label that is text', () => {
    const odd = deepFreeze({
      ...keysScheme(),
      keyLabels: { ship: { 'L.middle_1': 7 } },
    } as unknown as Scheme);
    expect(keyLabelOf(odd, 'ship', 'L.middle_1')).toBeUndefined();
  });

  it('reads a control or mode named like an Object property as itself', () => {
    expect(keyLabelOf(frozen(), 'constructor', 'toString')).toBeUndefined();
  });
});

describe('followLabels: a key label goes with its action', () => {
  const labelled = (): Scheme =>
    deepFreeze({
      ...keysScheme(),
      keyLabels: { ship: { 'L.middle_1': 'FSD' }, srv: { 'L.index_1': 'Hop' } },
    });
  const after = (fn: (s: Scheme) => Scheme): Scheme => {
    const before = labelled();
    return followLabels(before, fn(before));
  };

  it('stays while the control shows the same action', () => {
    expect(after((s) => assign(s, slot('ship', 'L.index_2'), 'gear', game)).keyLabels).toEqual(
      labelled().keyLabels,
    );
  });

  it('moves with an action moved to another control', () => {
    const moved = after((s) =>
      drop(s, 'ship', 'R.middle_2', 'fsd', { control: 'L.middle_1', press: 'tap' }, game),
    );
    expect(moved.keyLabels).toEqual({ ship: { 'R.middle_2': 'FSD' }, srv: { 'L.index_1': 'Hop' } });
  });

  it('moves with an action put on another control from the list', () => {
    const moved = after((s) => assign(s, slot('ship', 'L.index_3'), 'fsd', game));
    expect(moved.keyLabels?.['ship']).toEqual({ 'L.index_3': 'FSD' });
  });

  it('goes when the control is given another action', () => {
    const replaced = after((s) => assign(s, slot('ship', 'L.middle_1'), 'galaxy', game));
    expect(replaced.keyLabels?.['ship']).toEqual({});
  });

  it('goes when the action is cleared', () => {
    expect(after((s) => clear(s, slot('ship', 'L.middle_1'))).keyLabels?.['ship']).toEqual({});
  });

  it('on a move onto a labelled button, drops the label there and brings the moved one', () => {
    const both = deepFreeze({
      ...keysScheme(),
      keyLabels: { ship: { 'L.middle_1': 'FSD', 'L.index_1': 'Go' } },
    });
    // Boost moves onto the frame shift drive's button: FSD is dropped, Go goes with Boost.
    const next = followLabels(
      both,
      drop(both, 'ship', 'L.middle_1', 'boost', { control: 'L.index_1', press: 'tap' }, game),
    );
    expect(next.keyLabels?.['ship']).toEqual({ 'L.middle_1': 'Go' });
  });

  it('returns the edit itself when it changes no label', () => {
    const before = labelled();
    const next = assign(before, slot('ship', 'L.index_2'), 'gear', game);
    expect(followLabels(before, next)).toBe(next);
  });

  it('returns the edit itself for a scheme with no labels', () => {
    const before = frozen();
    const next = assign(before, slot('ship', 'L.index_2'), 'gear', game);
    expect(followLabels(before, next)).toBe(next);
  });

  it('keeps a label just set', () => {
    const before = labelled();
    const next = setKeyLabel(before, 'ship', 'L.index_1', 'Go');
    expect(followLabels(before, next)).toBe(next);
  });
});

describe('followLabels: a label left on a control showing nothing', () => {
  it('is not given to the next action put there', () => {
    const stale = deepFreeze({ ...keysScheme(), keyLabels: { ship: { 'L.index_4': 'Old' } } });
    const next = followLabels(stale, assign(stale, slot('ship', 'L.index_4'), 'gear', game));
    expect(next.keyLabels).toEqual({ ship: {} });
  });
});
