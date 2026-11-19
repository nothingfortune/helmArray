import type { SyncPill as SyncPillState } from '../../shared/api';

/** What the units hold against what was applied. Always visible; read, never assumed. */
export function SyncPill({ sync }: { sync: SyncPillState }) {
  return (
    <span className={`pill tone-${sync.tone}`}>
      <span className={`dot tone-${sync.tone}`} aria-hidden="true" />
      {sync.label}
    </span>
  );
}
