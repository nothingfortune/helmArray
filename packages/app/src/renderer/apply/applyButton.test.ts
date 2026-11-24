import { describe, expect, it } from 'vitest';
import type { AppState, SyncPill } from '../../shared/api';
import { applyButton } from './applyButton';

const state = (sync: SyncPill, activeSchemeId: string | null = 's1'): AppState => ({
  devices: [],
  sync,
  writeBlock: null,
  question: null,
  activeGameId: 'g',
  activeSchemeId,
  onUnits: { left: null, right: null },
});

describe("the Editor's Apply button", () => {
  it('counts the changes not applied, as the pill does', () => {
    const s = state({ label: '3 changes not applied', tone: 'warning', changes: 3 });
    expect(applyButton(s, 's1')).toEqual({ label: 'Apply 3', done: false });
  });

  it('keeps the count while the Azeron app is open and the pill says that instead', () => {
    const s = state({ label: 'Azeron app is open', tone: 'warning', changes: 2 });
    expect(applyButton(s, 's1').label).toBe('Apply 2');
  });

  it('says Applied, muted, once the units and the game hold the scheme', () => {
    expect(applyButton(state({ label: 'In sync', tone: 'ok' }), 's1')).toEqual({
      label: 'Applied',
      done: true,
    });
  });

  it('says Apply when nothing is known to count, or the scheme is not the one compared', () => {
    expect([
      applyButton(state({ label: 'Not checked yet', tone: 'plain' }), 's1'),
      applyButton(state({ label: '3 changes not applied', tone: 'warning', changes: 3 }), 's2'),
      applyButton(null, 's1'),
    ]).toEqual([
      { label: 'Apply', done: false },
      { label: 'Apply', done: false },
      { label: 'Apply', done: false },
    ]);
  });
});
