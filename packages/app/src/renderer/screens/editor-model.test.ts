import { describe, expect, it } from 'vitest';
import type { Finding, Scheme } from '@helmarray/core';
import { DEFAULT_TURBO_INTERVAL } from '@helmarray/core';
import {
  HISTORY_LIMIT,
  KEPT_REASON,
  acceptFinding,
  actionAt,
  assign,
  canRedo,
  canUndo,
  clear,
  commit,
  fixFor,
  historyShortcut,
  isAcceptable,
  move,
  redo,
  setLatch,
  setTurbo,
  startHistory,
  unacceptFinding,
  undo,
} from './editor-model';
import type { Slot } from './editor-model';
import { deepFreeze, game, keysScheme, padScheme, plan } from './editor-fixture';

const slot = (mode: string, control: string, press: Slot['press'] = 'tap'): Slot => ({
  mode,
  control,
  press,
});
const frozen = (): Scheme => deepFreeze(keysScheme());

describe('assign', () => {
  it('puts an action on a free button, in the current mode only', () => {
    const next = assign(frozen(), slot('ship', 'L.index_2'), 'gear');
    expect(next.map['ship']?.['L.index_2']).toEqual({ tap: 'gear' });
    expect(next.map['srv']).toEqual(keysScheme().map['srv']);
  });

  it('replaces what the slot held; the old action is simply unplaced', () => {
    const next = assign(frozen(), slot('ship', 'L.index_1'), 'galaxy');
    expect(actionAt(next, slot('ship', 'L.index_1'))).toBe('galaxy');
    expect(JSON.stringify(next.map['ship'])).not.toContain('boost');
  });

  it('is a move: the action leaves the slot it was on in this mode', () => {
    const next = assign(frozen(), slot('ship', 'R.index_2'), 'boost');
    expect(actionAt(next, slot('ship', 'R.index_2'))).toBe('boost');
    expect(next.map['ship']?.['L.index_1']).toBeUndefined();
  });

  it('puts an action on a long press or a double tap without touching the tap', () => {
    const a = assign(frozen(), slot('ship', 'L.index_1', 'long'), 'galaxy');
    const b = assign(a, slot('ship', 'L.index_1', 'double'), 'gear');
    expect(b.map['ship']?.['L.index_1']).toEqual({ tap: 'boost', long: 'galaxy', double: 'gear' });
  });

  it('keeps a press per mode: the same button holds different actions in each', () => {
    const next = assign(frozen(), slot('srv', 'L.middle_1'), 'lights');
    expect(next.map['srv']?.['L.middle_1']).toEqual({ tap: 'lights' });
    expect(next.map['ship']?.['L.middle_1']).toEqual({ tap: 'fsd' });
  });

  it('creates a mode that has no map yet', () => {
    const scheme = frozen();
    const rest = Object.fromEntries(Object.entries(scheme.map).filter(([mode]) => mode !== 'srv'));
    const bare = deepFreeze({ ...scheme, map: rest });
    expect(assign(bare, slot('srv', 'L.index_1'), 'jump').map['srv']).toEqual({
      'L.index_1': { tap: 'jump' },
    });
  });

  it('returns the same scheme when nothing changes', () => {
    const scheme = frozen();
    expect(assign(scheme, slot('ship', 'L.index_1'), 'boost')).toBe(scheme);
  });

  it('refuses the stick: it has directions, not presses', () => {
    const scheme = frozen();
    expect(assign(scheme, slot('ship', 'L.stick'), 'boost')).toBe(scheme);
    expect(assign(scheme, slot('ship', 'R.stick'), 'boost')).toBe(scheme);
  });

  it('never touches the ledger: a key once given stays given', () => {
    const ledger = { 'L.index_1': { tap: { kind: 'key', code: 'Insert' } } } as const;
    const scheme = deepFreeze({ ...keysScheme(), ledger });
    const next = clear(
      assign(scheme, slot('ship', 'L.index_2'), 'boost'),
      slot('ship', 'L.index_2'),
    );
    expect(next.ledger).toBe(scheme.ledger);
  });
});

describe('clear', () => {
  it('takes one press off and leaves the others', () => {
    const withLong = assign(frozen(), slot('ship', 'L.index_1', 'long'), 'galaxy');
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
    const next = move(frozen(), slot('ship', 'L.index_1'), slot('ship', 'L.index_3'));
    expect(next.map['ship']?.['L.index_3']).toEqual({ tap: 'boost' });
    expect(next.map['ship']?.['L.index_1']).toBeUndefined();
  });

  it('moves between presses of one button', () => {
    const next = move(frozen(), slot('ship', 'L.index_1'), slot('ship', 'L.index_1', 'long'));
    expect(next.map['ship']?.['L.index_1']).toEqual({ long: 'boost' });
  });

  it('drops what was on the target', () => {
    const next = move(frozen(), slot('ship', 'L.index_1'), slot('ship', 'L.middle_1'));
    expect(next.map['ship']?.['L.middle_1']).toEqual({ tap: 'boost' });
    expect(JSON.stringify(next.map['ship'])).not.toContain('fsd');
  });

  it('does nothing from an empty slot, onto itself, across modes or onto the stick', () => {
    const scheme = frozen();
    expect(move(scheme, slot('ship', 'L.index_5'), slot('ship', 'L.index_3'))).toBe(scheme);
    expect(move(scheme, slot('ship', 'L.index_1'), slot('ship', 'L.index_1'))).toBe(scheme);
    expect(move(scheme, slot('ship', 'L.index_1'), slot('srv', 'L.index_3'))).toBe(scheme);
    expect(move(scheme, slot('ship', 'L.index_1'), slot('ship', 'L.stick'))).toBe(scheme);
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
      assign(keysScheme(), slot('ship', 'R.index_1', 'long'), 'hardpoints'),
    );
    const before = find(scheme, 'combat-tap-delayed') as Finding;
    const fix = fixFor(before, scheme, game, plan(scheme));
    expect(fix?.label).toBe('Remove long press');
    const after = (fix as NonNullable<typeof fix>).apply(scheme);
    expect(find(after, 'combat-tap-delayed')).toBeUndefined();
    expect(after.map['ship']?.['R.index_1']).toEqual({ tap: 'fire' });
  });

  it('names both presses when both are there', () => {
    let scheme = assign(keysScheme(), slot('ship', 'R.index_1', 'long'), 'hardpoints');
    scheme = assign(scheme, slot('ship', 'R.index_1', 'double'), 'gear');
    const before = find(scheme, 'combat-tap-delayed') as Finding;
    expect(fixFor(before, scheme, game, plan(scheme))?.label).toBe(
      'Remove long press and double tap',
    );
  });

  it('a menu action on a combat button: take the menu action off', () => {
    const scheme = deepFreeze(assign(keysScheme(), slot('ship', 'R.index_1', 'long'), 'galaxy'));
    const before = find(scheme, 'menu-with-combat') as Finding;
    const fix = fixFor(before, scheme, game, plan(scheme));
    expect(fix?.label).toBe('Take Galaxy map off');
    const after = (fix as NonNullable<typeof fix>).apply(scheme);
    expect(find(after, 'menu-with-combat')).toBeUndefined();
    expect(after.map['ship']?.['R.index_1']).toEqual({ tap: 'fire' });
  });

  it('an action on a press that sends nothing: take it off', () => {
    const scheme = deepFreeze(assign(padScheme(), slot('ship', 'L.index_1', 'long'), 'galaxy'));
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
  const b = assign(a, slot('ship', 'L.index_2'), 'gear');
  const c = assign(b, slot('ship', 'L.index_3'), 'silent');

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
    const d = assign(b, slot('ship', 'L.index_4'), 'hardpoints');
    const next = commit(h, d);
    expect(next.future).toEqual([]);
    expect(next.past).toEqual([a, b]);
    expect(canRedo(next)).toBe(false);
  });

  it('counts a no-op as no edit: same history, nothing to undo', () => {
    const h = startHistory(a);
    expect(commit(h, a)).toBe(h);
    expect(commit(h, assign(a, slot('ship', 'L.index_1'), 'boost'))).toBe(h);
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
      let s = assign(scheme, slot('ship', 'L.index_2'), 'gear');
      s = assign(s, slot('ship', 'L.index_1', 'long'), 'galaxy');
      s = move(s, slot('ship', 'L.index_2'), slot('ship', 'L.index_3'));
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
