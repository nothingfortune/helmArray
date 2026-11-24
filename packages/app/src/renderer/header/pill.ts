// What the sync pill says, and whether it is a button. Pure.

import type { SyncPill } from '../../shared/api';

export interface PillView {
  text: string;
  /** A button that opens Apply for the scheme the units are compared with. */
  fix: boolean;
}

/**
 * A unit that differs is something to act on, and the way to act is Apply: the pill becomes a
 * button ("Right unit differs · Fix") when there is a scheme to open Apply for. Every other state
 * is only words.
 */
export function pillView(sync: SyncPill, canFix: boolean): PillView {
  const fix = sync.tone === 'error' && canFix;
  return { text: fix ? `${sync.label} · Fix` : sync.label, fix };
}
