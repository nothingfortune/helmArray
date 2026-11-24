import { describe, expect, it } from 'vitest';
import type { SyncPill } from '../../shared/api';
import { pillView } from './pill';

const pill = (over: Partial<SyncPill> = {}): SyncPill => ({
  label: 'In sync',
  tone: 'ok',
  ...over,
});

describe('pillView', () => {
  it('makes a unit that differs a button that opens Apply, in the canvas words', () => {
    expect(pillView(pill({ label: 'Right unit differs', tone: 'error' }), true)).toEqual({
      text: 'Right unit differs · Fix',
      fix: true,
    });
  });

  it('keeps every other state a plain pill', () => {
    const states: SyncPill[] = [
      pill(),
      pill({ label: '3 changes not applied', tone: 'warning', changes: 3 }),
      pill({ label: 'Azeron app is open', tone: 'warning' }),
      pill({ label: 'Not checked yet', tone: 'plain' }),
    ];
    expect(states.map((s) => pillView(s, true).fix)).toEqual([false, false, false, false]);
  });

  it('is no button when there is no scheme to open Apply for', () => {
    expect(pillView(pill({ label: 'Units differ', tone: 'error' }), false)).toEqual({
      text: 'Units differ',
      fix: false,
    });
  });
});
