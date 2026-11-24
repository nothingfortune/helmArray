// The Editor's Apply button: how many changes it would apply, or that it is applied. Pure.

import type { AppState } from '../../shared/api';

export interface ApplyButton {
  /** "Apply 3", "Applied", or "Apply" when there is no count to give. */
  label: string;
  /** Applied: drawn muted, as the canvas does; it still opens the drawer. */
  done: boolean;
}

/**
 * The button for the scheme the Editor has open. Its count is the pill's own (`sync.changes`), so
 * the two always agree, and it is only given for the scheme the pill is about: the active one.
 */
export function applyButton(state: AppState | null, schemeId: string): ApplyButton {
  if (state === null || state.activeSchemeId !== schemeId) return { label: 'Apply', done: false };
  const changes = state.sync.changes ?? 0;
  if (changes > 0) return { label: `Apply ${changes}`, done: false };
  if (state.sync.tone === 'ok') return { label: 'Applied', done: true };
  return { label: 'Apply', done: false };
}
