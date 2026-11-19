// What the sync pill says. It is read from the units, never inferred: the input is what each
// unit was last seen to hold, compared against the layout last applied to it.
//
// Precedence, strongest first:
//   1. differs      A connected unit holds something other than what was applied (a
//                   difference, or a record the app can't read back, which counts as one:
//                   never "in sync" about something not checked). Outranks pending changes,
//                   because it says the units aren't what the person thinks they are.
//   2. not-applied  Edits in the editor haven't been applied. True whatever the units show.
//   3. unknown      Nothing above, but the pill can't promise anything: a unit isn't
//                   connected, or hasn't been read against an applied layout. A disconnected
//                   unit can't be in sync, and what it last held is stale, so it is ignored
//                   in step 1.
//   4. in-sync      Both units connected, both read, both match, nothing pending.

import type { Verdict } from '@helmarray/azeron';
import type { Hand } from '@helmarray/core';

export interface HandSync {
  connected: boolean;
  /**
   * `verify()` of what the unit holds against the last applied layout, or null when nothing
   * has been applied yet or the unit hasn't been read.
   */
  verdict: Verdict | null;
}

export interface SyncInput {
  left: HandSync;
  right: HandSync;
  /** Edits in the editor not yet applied. */
  pendingChanges: number;
}

export type SyncTone = 'ok' | 'warning' | 'error';

export type SyncKind =
  | { kind: 'in-sync' }
  | { kind: 'not-applied'; count: number }
  | { kind: 'differs'; hands: Hand[] }
  | { kind: 'unknown'; reason: 'not-connected' | 'not-read'; hands: Hand[] };

export type SyncState = SyncKind & { label: string; tone: SyncTone };

const HANDS: Hand[] = ['left', 'right'];
const name = (hand: Hand | undefined) => (hand === 'right' ? 'Right' : 'Left');

const differs = (unit: HandSync) =>
  unit.connected &&
  unit.verdict !== null &&
  (unit.verdict.differences.length > 0 || unit.verdict.unchecked.length > 0);

export function syncState(input: SyncInput): SyncState {
  const differing = HANDS.filter((hand) => differs(input[hand]));
  if (differing.length > 0) {
    return {
      kind: 'differs',
      hands: differing,
      label: differing.length === 2 ? 'Units differ' : `${name(differing[0])} unit differs`,
      tone: 'error',
    };
  }

  const count = Number.isFinite(input.pendingChanges) ? Math.trunc(input.pendingChanges) : 0;
  if (count > 0) {
    return {
      kind: 'not-applied',
      count,
      label: count === 1 ? '1 change not applied' : `${count} changes not applied`,
      tone: 'warning',
    };
  }

  const away = HANDS.filter((hand) => !input[hand].connected);
  if (away.length > 0) {
    return {
      kind: 'unknown',
      reason: 'not-connected',
      hands: away,
      label: away.length === 2 ? 'Units not connected' : `${name(away[0])} unit not connected`,
      tone: 'warning',
    };
  }
  const unread = HANDS.filter((hand) => input[hand].verdict === null);
  if (unread.length > 0) {
    return {
      kind: 'unknown',
      reason: 'not-read',
      hands: unread,
      label: 'Not checked yet',
      tone: 'warning',
    };
  }

  return { kind: 'in-sync', label: 'In sync', tone: 'ok' };
}
