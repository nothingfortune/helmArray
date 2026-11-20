import type { Verdict } from '@helmarray/azeron';
import { describe, expect, it } from 'vitest';
import { pendingChanges, syncDetail, syncState, type HandSync } from './sync-state';

const clean: Verdict = { differences: [], unchecked: [] };
const differing: Verdict = {
  differences: [{ id: 3, what: 'tap keys', meant: '[4]', stored: '[5]' }],
  unchecked: [],
};
const unreadable: Verdict = { differences: [], unchecked: [{ id: 9, raw: new Uint8Array([1]) }] };

const matching: HandSync = { connected: true, verdict: clean };
const away: HandSync = { connected: false, verdict: null };
const unread: HandSync = { connected: true, verdict: null };
const wrong: HandSync = { connected: true, verdict: differing };

describe('syncState, for a unit the setup does not use', () => {
  const unused = (sync: HandSync): HandSync => ({ ...sync, used: false });

  it('does not judge what it holds, however it differs', () => {
    expect(syncState({ left: matching, right: unused(wrong), pendingChanges: 0 }).kind).toBe(
      'in-sync',
    );
  });

  it('does not ask for it to be connected or read', () => {
    expect([
      syncState({ left: matching, right: unused(away), pendingChanges: 0 }).kind,
      syncState({ left: matching, right: unused(unread), pendingChanges: 0 }).kind,
    ]).toEqual(['in-sync', 'in-sync']);
  });

  it('still judges the unit the setup does use', () => {
    expect(syncState({ left: away, right: unused(matching), pendingChanges: 0 }).label).toBe(
      'Left unit not connected',
    );
  });
});

describe('syncState', () => {
  it('is in sync only when both units are connected, read, matching and nothing is pending', () => {
    expect(syncState({ left: matching, right: matching, pendingChanges: 0 })).toEqual({
      kind: 'in-sync',
      label: 'In sync',
      tone: 'ok',
    });
  });

  it('says how many changes are not applied, in the singular for one', () => {
    const one = syncState({ left: matching, right: matching, pendingChanges: 1 });
    expect(one).toMatchObject({ kind: 'not-applied', count: 1, label: '1 change not applied' });
    expect(one.tone).toBe('warning');
    const many = syncState({ left: matching, right: matching, pendingChanges: 12 });
    expect(many).toMatchObject({ count: 12, label: '12 changes not applied', tone: 'warning' });
  });

  it('names the one unit that differs', () => {
    expect(syncState({ left: matching, right: wrong, pendingChanges: 0 })).toEqual({
      kind: 'differs',
      hands: ['right'],
      label: 'Right unit differs',
      tone: 'error',
    });
    expect(syncState({ left: wrong, right: matching, pendingChanges: 0 })).toMatchObject({
      hands: ['left'],
      label: 'Left unit differs',
    });
  });

  it('says the units differ when both do', () => {
    expect(syncState({ left: wrong, right: wrong, pendingChanges: 0 })).toMatchObject({
      kind: 'differs',
      hands: ['left', 'right'],
      label: 'Units differ',
      tone: 'error',
    });
  });

  it('counts a record that could not be read back as a difference, never as in sync', () => {
    const state = syncState({
      left: matching,
      right: { connected: true, verdict: unreadable },
      pendingChanges: 0,
    });
    expect(state).toMatchObject({ kind: 'differs', hands: ['right'] });
  });

  it('puts a unit that differs above pending changes', () => {
    expect(syncState({ left: wrong, right: matching, pendingChanges: 4 })).toMatchObject({
      kind: 'differs',
      label: 'Left unit differs',
    });
  });

  it('puts pending changes above a unit that is away or unread', () => {
    expect(syncState({ left: matching, right: away, pendingChanges: 2 })).toMatchObject({
      kind: 'not-applied',
      count: 2,
    });
    expect(syncState({ left: unread, right: unread, pendingChanges: 2 })).toMatchObject({
      kind: 'not-applied',
    });
  });

  it('never says in sync about a unit that is not connected', () => {
    expect(syncState({ left: matching, right: away, pendingChanges: 0 })).toEqual({
      kind: 'unknown',
      reason: 'not-connected',
      hands: ['right'],
      label: 'Right unit not connected',
      tone: 'warning',
    });
    expect(syncState({ left: away, right: away, pendingChanges: 0 })).toMatchObject({
      reason: 'not-connected',
      hands: ['left', 'right'],
      label: 'Units not connected',
    });
  });

  it('ignores what a disconnected unit last held, which is stale', () => {
    const stale: HandSync = { connected: false, verdict: differing };
    expect(syncState({ left: matching, right: stale, pendingChanges: 0 })).toMatchObject({
      kind: 'unknown',
      reason: 'not-connected',
    });
  });

  it('is unknown, not in sync, while a unit is unread or nothing was applied', () => {
    expect(syncState({ left: matching, right: unread, pendingChanges: 0 })).toEqual({
      kind: 'unknown',
      reason: 'not-read',
      hands: ['right'],
      label: 'Not checked yet',
      tone: 'warning',
    });
  });

  it('says a disconnected unit before an unread one', () => {
    expect(syncState({ left: unread, right: away, pendingChanges: 0 })).toMatchObject({
      reason: 'not-connected',
    });
  });

  it.each([-3, Number.NaN, 0.4])('treats %s pending changes as none', (pendingChanges) => {
    expect(syncState({ left: matching, right: matching, pendingChanges }).kind).toBe('in-sync');
  });
});

describe('syncState with nothing applied', () => {
  it('says nothing has been applied, when both units are there and nothing is pending', () => {
    expect(
      syncState({ left: unread, right: unread, pendingChanges: 0, nothingApplied: true }),
    ).toEqual({
      kind: 'unknown',
      reason: 'nothing-applied',
      hands: ['left', 'right'],
      label: 'Nothing applied yet',
      tone: 'warning',
    });
  });

  it('puts a unit that is not connected, and edits waiting, before it', () => {
    expect(
      syncState({ left: unread, right: away, pendingChanges: 0, nothingApplied: true }).label,
    ).toBe('Right unit not connected');
    expect(
      syncState({ left: unread, right: unread, pendingChanges: 4, nothingApplied: true }).label,
    ).toBe('4 changes not applied');
  });
});

describe('syncDetail', () => {
  it('says which unit and how many inputs, counting an input once', () => {
    const both: Verdict = {
      differences: [
        { id: 3, what: 'tap keys', meant: '[4]', stored: '[5]' },
        { id: 3, what: 'turbo', meant: '0', stored: '1' },
      ],
      unchecked: [{ id: 9, raw: new Uint8Array([1]) }],
    };
    expect(
      syncDetail({
        left: matching,
        right: { connected: true, verdict: both },
        pendingChanges: 0,
      }),
    ).toBe('Right unit: 2 inputs not as applied.');
    expect(syncDetail({ left: wrong, right: matching, pendingChanges: 0 })).toBe(
      'Left unit: 1 input not as applied.',
    );
  });

  it('has nothing to say when no unit differs, or the one that does is not connected', () => {
    expect(syncDetail({ left: matching, right: matching, pendingChanges: 3 })).toBeUndefined();
    expect(
      syncDetail({
        left: matching,
        right: { connected: false, verdict: differing },
        pendingChanges: 0,
      }),
    ).toBeUndefined();
  });
});

describe('pendingChanges', () => {
  it('counts one change for a scheme that did not resolve', () => {
    expect(pendingChanges(null, null)).toBe(1);
  });
});
